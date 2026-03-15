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
 *     buildPreviewPage: Function,
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
    buildPreviewPage,
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

  /**
   * Build an absolute URL for a generated screen file.
   * When the configured baseUrl points to localhost (i.e. BYOS_BASE_URL was not
   * set), fall back to the Host header of the incoming request so the TRMNL
   * device always receives a URL it can actually reach.
   * @param {string} filename
   * @param {import('fastify').FastifyRequest} [request]
   * @returns {string}
   */
  function screenUrl(filename, request) {
    let base = (byosConfig?.baseUrl ?? `http://localhost:${serverConfig?.port ?? 3001}`)
      .replace(/\/$/, '');
    if (request && /^https?:\/\/localhost(:\d+)?$/.test(base)) {
      const proto = request.protocol ?? 'http';
      base = `${proto}://${request.headers.host}`;
    }
    return `${base}/screens/${filename}`;
  }

  // ─── State ─────────────────────────────────────────────────────────────────

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
      image_url:   dashboardReady ? screenUrl(DASHBOARD_FILE, request) : screenUrl(SETUP_FILE, request),
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
      if (!refreshRunning) buildDashboard().catch(err => fastify.log.error({ err }, 'Dashboard build failed'));
      return reply.send({
        filename:          SETUP_FILE,
        image_url:         screenUrl(SETUP_FILE, request),
        image_url_timeout: 0,
        refresh_rate:      60,
        reset_firmware:    false,
        update_firmware:   false,
      });
    }

    return reply.send({
      filename:          DASHBOARD_FILE,
      image_url:         screenUrl(DASHBOARD_FILE, request),
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

  fastify.get('/api/metrics', async (request, reply) => {
    try {
      const data = await fetchAllMetrics();
      return reply.send(data);
    } catch (err) {
      fastify.log.error({ err }, 'Metrics fetch failed');
      return reply.code(503).send({ error: err.message });
    }
  });

  /**
   * Render dashboard on demand in a specific output format.
   * Runs the full pipeline (fetch → screenshot → convert) and returns the image.
   *
   * GET /api/render/bmp  — 1-bit monochrome BMP3  (TRMNL Standard/Developer)
   * GET /api/render/png  — 4-level grayscale PNG   (TRMNL OG)
   */
  fastify.get('/api/render/:format', async (request, reply) => {
    const { format } = request.params;
    const formatBitDepth = { bmp: 1, png: 2 };
    const fmtBitDepth = formatBitDepth[format];

    if (fmtBitDepth === undefined) {
      return reply.code(400).send({ error: `Unsupported format "${format}". Supported: bmp, png` });
    }

    const rawPath  = resolve(screensDir, `render_${format}_raw.png`);
    const outPath  = resolve(screensDir, `render_${format}.${format}`);
    const mimeType = format === 'bmp' ? 'image/bmp' : 'image/png';

    try {
      fastify.log.info(`Render: generating ${format} (bitDepth=${fmtBitDepth})…`);
      const data = await fetchAllMetrics();
      const html = renderDashboard(data, { bitDepth: fmtBitDepth });
      await screenshotHtml(html, rawPath);
      await toDisplayImage(rawPath, outPath, fmtBitDepth);
      fastify.log.info(`Render: ${format} ready ✓`);
      return reply
        .header('Content-Type', mimeType)
        .header('Cache-Control', 'no-store')
        .header('Content-Disposition', `inline; filename="dashboard.${format}"`)
        .send(createReadStream(outPath));
    } catch (err) {
      fastify.log.error({ err }, `Render ${format} failed`);
      return reply.code(503).send({ error: err.message });
    }
  });

  fastify.get('/preview', async (request, reply) => {
    return reply.type('text/html').send(buildPreviewPage(vesselConfig.name));
  });

  // Serves the exact HTML that gets sent to Chromium — open in browser at 800×480 zoom to verify.
  fastify.get('/preview/raw', async (request, reply) => {
    try {
      const data = await fetchAllMetrics();
      const html = await renderDashboard(data);
      return reply.type('text/html').send(html);
    } catch (err) {
      fastify.log.error({ err }, 'preview/raw failed');
      return reply.code(500).send({ error: err.message });
    }
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
    buildDashboard().catch(err => fastify.log.error({ err }, 'Initial dashboard build failed'));

    _interval = setInterval(
      () => buildDashboard().catch(err => fastify.log.error({ err }, 'Scheduled dashboard build failed')),
      displayConfig.refreshIntervalSeconds * 1000
    );
  }

  /** Stop the refresh interval — call this to clean up after tests. */
  function dispose() {
    if (_interval) { clearInterval(_interval); _interval = null; }
  }

  return { fastify, initialize, dispose, buildDashboard, buildSetupScreen };
}
