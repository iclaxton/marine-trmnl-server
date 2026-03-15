/**
 * app.js — Fastify application factory.
 *
 * All dependencies (InfluxDB, renderer, screenshot, converter, device store)
 * are injected so that integration tests can substitute mocks without needing
 * any special mock library or Node 22+ features.
 *
 * Usage (production):
 *   import { createApp } from './app.js';
 *   const { fastify, initialize, dispose } = createApp({ deps, paths, cfg });
 *
 * Usage (tests):
 *   const { fastify } = createApp({ deps: mockDeps, paths: tmpPaths, cfg: testCfg,
 *                                    initialState: { dashboardReady: true } });
 *   const res = await fastify.inject({ method: 'GET', url: '/health' });
 */

import Fastify from 'fastify';
import { createReadStream, mkdirSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * @param {{
 *   deps: {
 *     fetchAllMetrics: Function,
 *     renderDashboard: Function,
 *     renderSetupScreen: Function,
 *     screenshotHtml: Function,
 *     toDisplayImage: Function,
 *     displayExtension: Function,
 *     checkImageMagick: Function,
 *     devices: { getOrCreate, get, updateTelemetry, updateCapabilities?, list },
 *   },
 *   paths: {
 *     screensDir: string,
 *     DASHBOARD_RAW: string,
 *     DASHBOARD_DISPLAY: string,
 *     SETUP_RAW: string,
 *     SETUP_DISPLAY: string,
 *   },
 *   cfg: {
 *     byosConfig: object,
 *     serverConfig: object,
 *     displayConfig: object,
 *     vesselConfig: object,
 *   },
 *   initialState?: {
 *     cachedHtml?: string|null,
 *     dashboardReady?: boolean,
 *     lastRefreshAt?: Date|null,
 *     lastError?: string|null,
 *   }
 * }} options
 */
export function createApp({ deps, paths, cfg, initialState = {} } = {}) {
  const {
    fetchAllMetrics,
    renderDashboard,
    renderSetupScreen,
    screenshotHtml,
    toDisplayImage,
    displayExtension,
    checkImageMagick,
    devices,
  } = deps;

  const {
    screensDir,
    DASHBOARD_RAW,
    DASHBOARD_DISPLAY,
    SETUP_RAW,
    SETUP_DISPLAY,
  } = paths;

  const { byosConfig, serverConfig, displayConfig, vesselConfig } = cfg;

  // Bit depth drives the entire image pipeline and file naming
  const bitDepth = displayConfig.bitDepth ?? 1;
  const ext = (typeof displayExtension === 'function')
    ? displayExtension(bitDepth)
    : (bitDepth >= 2 ? '.png' : '.bmp');
  const DASHBOARD_FILE = `dashboard${ext}`;
  const SETUP_FILE     = `setup${ext}`;

  function screenUrl(filename) {
    const base = (byosConfig?.baseUrl ?? `http://localhost:${serverConfig?.port ?? 3001}`)
      .replace(/\/$/, '');
    return `${base}/screens/${filename}`;
  }

  // ─── State ─────────────────────────────────────────────────────────────────

  let cachedHtml     = initialState.cachedHtml     ?? null;
  let dashboardReady = initialState.dashboardReady ?? false;
  let lastRefreshAt  = initialState.lastRefreshAt  ?? null;
  let lastError      = initialState.lastError      ?? null;
  let refreshRunning = false;

  // ─── Fastify ───────────────────────────────────────────────────────────────

  const fastify = Fastify({
    logger: {
      level: 'info',
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
    },
  });

  // ─── Pipeline ──────────────────────────────────────────────────────────────

  async function buildDashboard() {
    if (refreshRunning) return;
    refreshRunning = true;
    try {
      fastify.log.info('Refresh: fetching metrics…');
      const data = await fetchAllMetrics();
      const html = renderDashboard(data, { bitDepth });
      cachedHtml = html;

      fastify.log.info('Refresh: taking screenshot…');
      await screenshotHtml(html, DASHBOARD_RAW);

      fastify.log.info(`Refresh: converting to ${bitDepth}-bit display image…`);
      await toDisplayImage(DASHBOARD_RAW, DASHBOARD_DISPLAY, bitDepth);

      dashboardReady = true;
      lastRefreshAt  = new Date();
      lastError      = null;
      fastify.log.info('Refresh: complete ✓');
    } catch (err) {
      lastError = err.message;
      fastify.log.error({ err }, 'Refresh failed');
    } finally {
      refreshRunning = false;
    }
  }

  async function buildSetupScreen() {
    if (existsSync(SETUP_DISPLAY)) return;
    try {
      fastify.log.info(`Generating setup${ext}…`);
      const html = renderSetupScreen({ bitDepth });
      await screenshotHtml(html, SETUP_RAW);
      await toDisplayImage(SETUP_RAW, SETUP_DISPLAY, bitDepth);
      fastify.log.info(`setup${ext} ready ✓`);
    } catch (err) {
      fastify.log.error({ err }, `Failed to generate setup${ext}`);
    }
  }

  // ─── Routes ────────────────────────────────────────────────────────────────

  fastify.get('/screens/:filename', async (request, reply) => {
    const { filename } = request.params;

    if (filename.includes('/') || filename.includes('..')) {
      return reply.code(400).send({ error: 'Invalid filename' });
    }

    const filePath = resolve(screensDir, filename);
    // Guard must include the separator to prevent '/screens' matching '/screens-evil/...'
    if (!filePath.startsWith(screensDir + '/')) return reply.code(403).send({ error: 'Forbidden' });
    if (!existsSync(filePath))                  return reply.code(404).send({ error: 'Not found' });

    const mimeType = extname(filename).toLowerCase() === '.bmp' ? 'image/bmp' : 'image/png';

    return reply
      .header('Content-Type', mimeType)
      .header('Cache-Control', 'no-cache')
      .send(createReadStream(filePath));
  });

  /**
   * Extract and store hardware capabilities reported via firmware headers.
   * Called on both /api/setup and /api/display.
   */
  function captureCapabilities(mac, request) {
    if (!devices.updateCapabilities) return;
    const userAgent = request.headers['user_agent']
      ?? request.headers['user-agent']
      ?? null;
    const width  = request.headers['width']  ? Number(request.headers['width'])  : null;
    const height = request.headers['height'] ? Number(request.headers['height']) : null;
    devices.updateCapabilities(mac, { bitDepth, width, height, userAgent });
  }

  fastify.get('/api/setup', async (request, reply) => {
    const mac = (request.headers['id'] ?? '').trim().toUpperCase();
    if (!mac) return reply.code(400).send({ error: 'Missing ID header (device MAC address)' });

    const device = devices.getOrCreate(mac);
    captureCapabilities(mac, request);
    fastify.log.info({ mac, friendlyId: device.friendlyId }, 'Device setup');

    return reply.send({
      api_key:     device.apiKey,
      friendly_id: device.friendlyId,
      image_url:   dashboardReady ? screenUrl(DASHBOARD_FILE) : screenUrl(SETUP_FILE),
      message:     `Welcome aboard ${vesselConfig.name}`,
    });
  });

  fastify.get('/api/display', async (request, reply) => {
    const mac = (request.headers['id'] ?? '').trim().toUpperCase();
    if (!mac) return reply.code(400).send({ error: 'Missing ID header (device MAC address)' });

    devices.getOrCreate(mac);
    captureCapabilities(mac, request);
    devices.updateTelemetry(mac, {
      battery:  request.headers['battery_voltage'] ?? null,
      wifi:     request.headers['rssi']            ?? null,
      firmware: request.headers['fw_version']      ?? null,
    });

    if (!dashboardReady) {
      if (!refreshRunning) buildDashboard().catch(() => {});
      return reply.send({
        filename:          SETUP_FILE,
        image_url:         screenUrl(SETUP_FILE),
        image_url_timeout: 0,
        refresh_rate:      60,
        reset_firmware:    false,
        update_firmware:   false,
      });
    }

    return reply.send({
      filename:          DASHBOARD_FILE,
      image_url:         screenUrl(DASHBOARD_FILE),
      image_url_timeout: 0,
      refresh_rate:      displayConfig.refreshIntervalSeconds,
      reset_firmware:    false,
      update_firmware:   false,
    });
  });

  fastify.post('/api/log', async (request, reply) => {
    const mac  = (request.headers['id'] ?? '').trim().toUpperCase();
    const body = request.body ?? {};

    fastify.log.info({ mac, log: body }, 'Device log');

    if (mac) {
      const logs  = Array.isArray(body.logs) ? body.logs : [body];
      const entry = logs.at(-1) ?? {};
      devices.updateTelemetry(mac, {
        battery:  entry.battery_voltage  ?? null,
        wifi:     entry.wifi_signal      ?? null,
        firmware: entry.firmware_version ?? null,
      });
    }

    return reply.code(204).send();
  });

  fastify.get('/preview', async (request, reply) => {
    if ('refresh' in request.query || !cachedHtml) {
      await buildDashboard();
    }

    if (!cachedHtml) {
      return reply.code(503).type('text/plain').send(
        `Dashboard not yet available.\n${lastError ?? 'No data fetched yet.'}`
      );
    }

    return reply.type('text/html').send(cachedHtml);
  });

  fastify.get('/health', async (request, reply) => {
    const secondsSince = lastRefreshAt
      ? Math.round((Date.now() - lastRefreshAt) / 1000)
      : null;

    return {
      status:          dashboardReady ? 'ok' : 'initialising',
      vessel:          vesselConfig.name,
      dashboardReady,
      bitDepth,
      lastRefreshAt:   lastRefreshAt?.toISOString() ?? null,
      nextRefreshIn:   secondsSince !== null
        ? `${Math.max(0, displayConfig.refreshIntervalSeconds - secondsSince)}s`
        : 'pending',
      lastError:       lastError ?? null,
      refreshInterval: `${displayConfig.refreshIntervalSeconds}s`,
      devices:         devices.list().length,
      screensDir,
    };
  });

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  let _interval = null;

  /**
   * Start the background pipeline: verify ImageMagick, generate setup.bmp,
   * kick off first dashboard build, and schedule recurring refreshes.
   */
  async function initialize() {
    mkdirSync(screensDir, { recursive: true });

    const imCmd = await checkImageMagick();
    fastify.log.info(`ImageMagick "${imCmd}" ✓`);

    await buildSetupScreen();
    buildDashboard().catch(() => {});

    _interval = setInterval(
      () => buildDashboard().catch(() => {}),
      displayConfig.refreshIntervalSeconds * 1000
    );
  }

  /** Stop the refresh interval — call this to clean up after tests. */
  function dispose() {
    if (_interval) { clearInterval(_interval); _interval = null; }
  }

  return { fastify, initialize, dispose, buildDashboard, buildSetupScreen };
}
