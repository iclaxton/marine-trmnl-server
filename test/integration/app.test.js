/**
 * Integration tests — BYOS API routes (src/app.js via createApp)
 *
 * All dependencies (InfluxDB, Puppeteer, ImageMagick) are replaced with mocks.
 * Tests use Fastify's built-in injection (no real HTTP socket needed).
 *
 * Run with: node --test test/integration/app.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp }         from '../../src/app.js';
import { createDeviceStore } from '../../src/devices.js';

// ─── Shared test infrastructure ───────────────────────────────────────────────

/** Build a temporary screens directory and return the paths object. */
function makeTmpPaths() {
  const screensDir = mkdtempSync(join(tmpdir(), 'trmnl-screens-'));
  // Default bitDepth = 1 → .bmp; mirrors the default in createApp when displayConfig.bitDepth is absent
  return {
    screensDir,
    DASHBOARD_RAW:     join(screensDir, 'dashboard_raw.png'),
    DASHBOARD_DISPLAY: join(screensDir, 'dashboard.bmp'),
    SETUP_RAW:         join(screensDir, 'setup_raw.png'),
    SETUP_DISPLAY:     join(screensDir, 'setup.bmp'),
  };
}

/** Minimal test config — mirrors the shape of real config objects. */
function makeTestCfg() {
  return {
    byosConfig:     { baseUrl: 'http://test.local:3001' },
    serverConfig:   { port: 3001, host: '127.0.0.1' },
    displayConfig:  { refreshIntervalSeconds: 900, theme: 'light', units: 'metric' },
    vesselConfig:   { name: 'TESTHEBE' },
  };
}

/**
 * Build a full mock deps object.
 * @param {string}     devicesDir       — temp dir for the device store
 * @param {object}     [overrides={}]   — override individual dep functions
 */
function makeMockDeps(devicesDir, overrides = {}) {
  return {
    fetchAllMetrics: async () => ({
      _window: '15m',
      wind: null, navigation: null, depth: null,
      battery: null, environment: null,
    }),
    renderDashboard:  () => '<html>mock-dashboard</html>',
    renderSetupScreen: () => '<html>mock-setup</html>',
    buildPreviewPage: (vesselName) => `<!DOCTYPE html><html><head><title>${vesselName}</title></head><body data-preview>Loading…</body></html>`,

    screenshotHtml:   async () => {},
    // write a minimal dummy file to the output path so /screens/ can serve it
    toDisplayImage: async (_inputPng, outputPath) => {
      writeFileSync(outputPath, Buffer.alloc(54, 0));
    },
    displayExtension: (bd) => bd >= 2 ? '.png' : '.bmp',
    checkImageMagick: async () => 'magick',
    devices: createDeviceStore(devicesDir, 'TEST'),
    ...overrides,
  };
}

// ─── /health ─────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  let fastify, dispose, tmpPaths, devDir;

  before(() => {
    tmpPaths = makeTmpPaths();
    devDir   = mkdtempSync(join(tmpdir(), 'trmnl-devs-'));
    ({ fastify, dispose } = createApp({
      deps:         makeMockDeps(devDir),
      paths:        tmpPaths,
      cfg:          makeTestCfg(),
      initialState: { dashboardReady: true, lastRefreshAt: new Date() },
    }));
  });

  after(async () => {
    dispose();
    await fastify.close();
    rmSync(tmpPaths.screensDir, { recursive: true, force: true });
    rmSync(devDir,              { recursive: true, force: true });
  });

  test('returns HTTP 200', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
  });

  test('reports status "ok" when dashboard is ready', async () => {
    const body = JSON.parse((await fastify.inject({ method: 'GET', url: '/health' })).body);
    assert.equal(body.status, 'ok');
  });

  test('returns vessel name', async () => {
    const body = JSON.parse((await fastify.inject({ method: 'GET', url: '/health' })).body);
    assert.equal(body.vessel, 'TESTHEBE');
  });

  test('includes refreshInterval', async () => {
    const body = JSON.parse((await fastify.inject({ method: 'GET', url: '/health' })).body);
    assert.equal(body.refreshInterval, '900s');
  });

  test('reports status "initialising" when dashboard not ready', async () => {
    const tmpP2  = makeTmpPaths();
    const devDir2 = mkdtempSync(join(tmpdir(), 'trmnl-devs2-'));
    const { fastify: f2, dispose: d2 } = createApp({
      deps:  makeMockDeps(devDir2),
      paths: tmpP2,
      cfg:   makeTestCfg(),
      initialState: { dashboardReady: false },
    });
    const body = JSON.parse((await f2.inject({ method: 'GET', url: '/health' })).body);
    assert.equal(body.status, 'initialising');
    d2();
    await f2.close();
    rmSync(tmpP2.screensDir, { recursive: true, force: true });
    rmSync(devDir2,           { recursive: true, force: true });
  });
});

// ─── /api/setup ──────────────────────────────────────────────────────────────

describe('GET /api/setup', () => {
  let fastify, dispose, tmpPaths, devDir;

  before(() => {
    tmpPaths = makeTmpPaths();
    devDir   = mkdtempSync(join(tmpdir(), 'trmnl-devs-'));
    ({ fastify, dispose } = createApp({
      deps:  makeMockDeps(devDir),
      paths: tmpPaths,
      cfg:   makeTestCfg(),
    }));
  });

  after(async () => {
    dispose();
    await fastify.close();
    rmSync(tmpPaths.screensDir, { recursive: true, force: true });
    rmSync(devDir,              { recursive: true, force: true });
  });

  test('returns 400 when ID header is missing', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/setup' });
    assert.equal(res.statusCode, 400);
  });

  test('returns 200 with required BYOS fields', async () => {
    const res = await fastify.inject({
      method:  'GET',
      url:     '/api/setup',
      headers: { id: 'AA:BB:CC:DD:EE:FF' },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.api_key,     'should have api_key');
    assert.ok(body.friendly_id, 'should have friendly_id');
    assert.ok(body.image_url,   'should have image_url');
    assert.ok(body.message,     'should have message');
  });

  test('returns setup.bmp URL when dashboard not ready', async () => {
    const res = await fastify.inject({
      method:  'GET',
      url:     '/api/setup',
      headers: { id: 'AA:BB:CC:DD:EE:01' },
    });
    const { image_url } = JSON.parse(res.body);
    assert.ok(image_url.endsWith('/screens/setup.bmp'), `Expected setup.bmp URL but got: ${image_url}`);
  });

  test('message includes vessel name', async () => {
    const res = await fastify.inject({
      method:  'GET',
      url:     '/api/setup',
      headers: { id: 'AA:BB:CC:DD:EE:02' },
    });
    const { message } = JSON.parse(res.body);
    assert.ok(message.includes('TESTHEBE'), `Expected "TESTHEBE" in message but got: ${message}`);
  });

  test('is idempotent — same api_key on repeated calls', async () => {
    const req = { method: 'GET', url: '/api/setup', headers: { id: 'AA:BB:CC:DD:EE:EE' } };
    const r1 = JSON.parse((await fastify.inject(req)).body);
    const r2 = JSON.parse((await fastify.inject(req)).body);
    assert.equal(r1.api_key,     r2.api_key);
    assert.equal(r1.friendly_id, r2.friendly_id);
  });

  test('MAC header is normalised to upper-case', async () => {
    const lower = await fastify.inject({ method: 'GET', url: '/api/setup', headers: { id: 'aa:bb:cc:00:00:01' } });
    const upper = await fastify.inject({ method: 'GET', url: '/api/setup', headers: { id: 'AA:BB:CC:00:00:01' } });
    const b1 = JSON.parse(lower.body);
    const b2 = JSON.parse(upper.body);
    assert.equal(b1.api_key, b2.api_key);
  });

  test('returns dashboard.bmp URL when dashboard is ready', async () => {
    const tmpP2  = makeTmpPaths();
    const devDir2 = mkdtempSync(join(tmpdir(), 'trmnl-devs2-'));
    const { fastify: f2, dispose: d2 } = createApp({
      deps:         makeMockDeps(devDir2),
      paths:        tmpP2,
      cfg:          makeTestCfg(),
      initialState: { dashboardReady: true },
    });
    const res = await f2.inject({ method: 'GET', url: '/api/setup', headers: { id: 'AA:00:00:00:00:FF' } });
    const { image_url } = JSON.parse(res.body);
    assert.ok(image_url.endsWith('/screens/dashboard.bmp'), `Expected dashboard.bmp URL but got: ${image_url}`);
    d2();
    await f2.close();
    rmSync(tmpP2.screensDir, { recursive: true, force: true });
    rmSync(devDir2,           { recursive: true, force: true });
  });
});

// ─── /api/display ─────────────────────────────────────────────────────────────

describe('GET /api/display', () => {
  let fastify, dispose, tmpPaths, devDir;

  before(() => {
    tmpPaths = makeTmpPaths();
    devDir   = mkdtempSync(join(tmpdir(), 'trmnl-devs-'));
    ({ fastify, dispose } = createApp({
      deps:         makeMockDeps(devDir),
      paths:        tmpPaths,
      cfg:          makeTestCfg(),
      initialState: { dashboardReady: true },
    }));
  });

  after(async () => {
    dispose();
    await fastify.close();
    rmSync(tmpPaths.screensDir, { recursive: true, force: true });
    rmSync(devDir,              { recursive: true, force: true });
  });

  test('returns 400 when ID header is missing', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/display' });
    assert.equal(res.statusCode, 400);
  });

  test('returns all required BYOS display fields', async () => {
    const res = await fastify.inject({
      method:  'GET',
      url:     '/api/display',
      headers: { id: 'AA:BB:CC:DD:EE:FF' },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok('filename'          in body, 'missing filename');
    assert.ok('image_url'         in body, 'missing image_url');
    assert.ok('image_url_timeout' in body, 'missing image_url_timeout');
    assert.ok('refresh_rate'      in body, 'missing refresh_rate');
    assert.ok('reset_firmware'    in body, 'missing reset_firmware');
    assert.ok('update_firmware'   in body, 'missing update_firmware');
  });

  test('image_url_timeout is 0', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/display', headers: { id: 'AA:BB:00:00:00:01' } });
    assert.equal(JSON.parse(res.body).image_url_timeout, 0);
  });

  test('reset_firmware and update_firmware are false', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/display', headers: { id: 'AA:BB:00:00:00:02' } });
    const body = JSON.parse(res.body);
    assert.equal(body.reset_firmware,  false);
    assert.equal(body.update_firmware, false);
  });

  test('returns dashboard.bmp when dashboardReady=true', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/display', headers: { id: 'AA:BB:00:00:00:03' } });
    const body = JSON.parse(res.body);
    assert.equal(body.filename, 'dashboard.bmp');
    assert.ok(body.image_url.endsWith('/screens/dashboard.bmp'));
  });

  test('refresh_rate matches configured interval (900s)', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/display', headers: { id: 'AA:BB:00:00:00:04' } });
    assert.equal(JSON.parse(res.body).refresh_rate, 900);
  });

  test('returns setup.bmp with refresh_rate=60 when not ready', async () => {
    const tmpP2  = makeTmpPaths();
    const devDir2 = mkdtempSync(join(tmpdir(), 'trmnl-devs2-'));
    const { fastify: f2, dispose: d2 } = createApp({
      deps:         makeMockDeps(devDir2),
      paths:        tmpP2,
      cfg:          makeTestCfg(),
      initialState: { dashboardReady: false },
    });
    const res = await f2.inject({ method: 'GET', url: '/api/display', headers: { id: 'AA:00:00:00:00:01' } });
    const body = JSON.parse(res.body);
    assert.equal(body.filename,     'setup.bmp');
    assert.equal(body.refresh_rate, 60);
    assert.ok(body.image_url.endsWith('/screens/setup.bmp'));
    d2();
    await f2.close();
    rmSync(tmpP2.screensDir, { recursive: true, force: true });
    rmSync(devDir2,           { recursive: true, force: true });
  });

  test('auto-provisions unknown devices (no prior /api/setup call)', async () => {
    const res = await fastify.inject({
      method:  'GET',
      url:     '/api/display',
      headers: { id: 'FF:FF:FF:FF:FF:01' },
    });
    assert.equal(res.statusCode, 200, 'should not 400 unknown device');
  });
});

// ─── /api/log ─────────────────────────────────────────────────────────────────

describe('POST /api/log', () => {
  let fastify, dispose, tmpPaths, devDir;

  before(() => {
    tmpPaths = makeTmpPaths();
    devDir   = mkdtempSync(join(tmpdir(), 'trmnl-devs-'));
    ({ fastify, dispose } = createApp({
      deps:  makeMockDeps(devDir),
      paths: tmpPaths,
      cfg:   makeTestCfg(),
    }));
  });

  after(async () => {
    dispose();
    await fastify.close();
    rmSync(tmpPaths.screensDir, { recursive: true, force: true });
    rmSync(devDir,              { recursive: true, force: true });
  });

  test('returns HTTP 204 No Content', async () => {
    const res = await fastify.inject({
      method:  'POST',
      url:     '/api/log',
      headers: { id: 'AA:BB:CC:DD:EE:FF', 'content-type': 'application/json' },
      payload: JSON.stringify({ logs: [{ battery_voltage: '12.4', wifi_signal: '-60', firmware_version: '1.2.3' }] }),
    });
    assert.equal(res.statusCode, 204);
    assert.equal(res.body, '');
  });

  test('returns 204 with no ID header (graceful)', async () => {
    const res = await fastify.inject({
      method:  'POST',
      url:     '/api/log',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ message: 'test' }),
    });
    assert.equal(res.statusCode, 204);
  });

  test('stores telemetry on existing device', async () => {
    // First register via setup
    await fastify.inject({ method: 'GET', url: '/api/setup', headers: { id: 'AA:BB:CC:00:00:99' } });

    // Then log
    await fastify.inject({
      method:  'POST',
      url:     '/api/log',
      headers: { id: 'AA:BB:CC:00:00:99', 'content-type': 'application/json' },
      payload: JSON.stringify({ logs: [{ battery_voltage: '12.8', wifi_signal: '-55', firmware_version: '2.0.0' }] }),
    });

    // Verify via health that devices count increased
    const health = JSON.parse((await fastify.inject({ method: 'GET', url: '/health' })).body);
    assert.ok(health.devices >= 1);
  });
});

// ─── /screens/:filename ───────────────────────────────────────────────────────

describe('GET /screens/:filename', () => {
  let fastify, dispose, tmpPaths, devDir;

  before(() => {
    tmpPaths = makeTmpPaths();
    devDir   = mkdtempSync(join(tmpdir(), 'trmnl-devs-'));

    // Pre-create dummy image files for serving
    writeFileSync(tmpPaths.DASHBOARD_DISPLAY, Buffer.alloc(54, 0));
    writeFileSync(tmpPaths.DASHBOARD_RAW,     Buffer.alloc(8,  0x89)); // PNG magic-ish

    ({ fastify, dispose } = createApp({
      deps:  makeMockDeps(devDir),
      paths: tmpPaths,
      cfg:   makeTestCfg(),
    }));
  });

  after(async () => {
    dispose();
    await fastify.close();
    rmSync(tmpPaths.screensDir, { recursive: true, force: true });
    rmSync(devDir,              { recursive: true, force: true });
  });

  test('returns 404 for non-existent file', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/screens/nonexistent.bmp' });
    assert.equal(res.statusCode, 404);
  });

  test('returns 400 for path traversal attempt (..)', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/screens/..%2Fetc%2Fpasswd' });
    assert.equal(res.statusCode, 400);
  });

  test('returns 200 with image/bmp for .bmp file', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/screens/dashboard.bmp' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type'].includes('image/bmp'));
  });

  test('returns 200 with image/png for .png file', async () => {
    // dashboard_raw.png is the Puppeteer intermediate screenshot (always PNG regardless of bit depth)
    const res = await fastify.inject({ method: 'GET', url: '/screens/dashboard_raw.png' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type'].includes('image/png'));
  });

  test('includes no-cache header', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/screens/dashboard.bmp' });
    assert.equal(res.headers['cache-control'], 'no-cache');
  });
});

// ─── /preview ─────────────────────────────────────────────────────────────────

describe('GET /preview', () => {
  let fastify, dispose, tmpPaths, devDir;

  before(() => {
    tmpPaths = makeTmpPaths();
    devDir   = mkdtempSync(join(tmpdir(), 'trmnl-devs-'));
    ({ fastify, dispose } = createApp({
      deps:  makeMockDeps(devDir),
      paths: tmpPaths,
      cfg:   makeTestCfg(),
    }));
  });

  after(async () => {
    dispose();
    await fastify.close();
    rmSync(tmpPaths.screensDir, { recursive: true, force: true });
    rmSync(devDir,              { recursive: true, force: true });
  });

  test('returns HTTP 200', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/preview' });
    assert.equal(res.statusCode, 200);
  });

  test('responds with text/html content-type', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/preview' });
    assert.ok(res.headers['content-type'].includes('text/html'));
  });

  test('HTML contains vessel name in <title>', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/preview' });
    assert.ok(res.body.includes('TESTHEBE'));
  });

  test('returns 200 regardless of dashboard ready state', async () => {
    const tmpP   = makeTmpPaths();
    const devDir2 = mkdtempSync(join(tmpdir(), 'trmnl-devs2-'));
    const { fastify: f2, dispose: d2 } = createApp({
      deps:         makeMockDeps(devDir2),
      paths:        tmpP,
      cfg:          makeTestCfg(),
      initialState: { dashboardReady: false },
    });
    const res = await f2.inject({ method: 'GET', url: '/preview' });
    assert.equal(res.statusCode, 200);
    d2();
    await f2.close();
    rmSync(tmpP.screensDir, { recursive: true, force: true });
    rmSync(devDir2,          { recursive: true, force: true });
  });
});

// ─── /api/metrics ─────────────────────────────────────────────────────────────

describe('GET /api/metrics', () => {
  let fastify, dispose, tmpPaths, devDir;

  before(() => {
    tmpPaths = makeTmpPaths();
    devDir   = mkdtempSync(join(tmpdir(), 'trmnl-devs-'));
    ({ fastify, dispose } = createApp({
      deps:  makeMockDeps(devDir),
      paths: tmpPaths,
      cfg:   makeTestCfg(),
    }));
  });

  after(async () => {
    dispose();
    await fastify.close();
    rmSync(tmpPaths.screensDir, { recursive: true, force: true });
    rmSync(devDir,              { recursive: true, force: true });
  });

  test('returns HTTP 200 with JSON', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/metrics' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type'].includes('application/json'));
  });

  test('response body has _window field', async () => {
    const res  = await fastify.inject({ method: 'GET', url: '/api/metrics' });
    const body = JSON.parse(res.body);
    assert.ok('_window' in body, 'should include _window');
  });

  test('returns 503 when fetchAllMetrics throws', async () => {
    const tmpP   = makeTmpPaths();
    const devDir2 = mkdtempSync(join(tmpdir(), 'trmnl-devs2-'));
    const { fastify: f2, dispose: d2 } = createApp({
      deps: makeMockDeps(devDir2, {
        fetchAllMetrics: async () => { throw new Error('InfluxDB unreachable'); },
      }),
      paths: tmpP,
      cfg:   makeTestCfg(),
    });
    const res = await f2.inject({ method: 'GET', url: '/api/metrics' });
    assert.equal(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.ok(body.error.includes('InfluxDB unreachable'));
    d2();
    await f2.close();
    rmSync(tmpP.screensDir, { recursive: true, force: true });
    rmSync(devDir2,          { recursive: true, force: true });
  });

  test('returned JSON is the full metrics data object from fetchAllMetrics', async () => {
    const tmpP   = makeTmpPaths();
    const devDir2 = mkdtempSync(join(tmpdir(), 'trmnl-devs2-'));
    const mockData = {
      _window: '15m',
      _queriedAt: new Date().toISOString(),
      wind: { apparentSpeed: { def: {}, stats: { last: 12.3, min: 8.0, max: 16.0, mean: 11.5 } } },
      navigation: null, depth: null, battery: null, environment: null,
    };
    const { fastify: f2, dispose: d2 } = createApp({
      deps: makeMockDeps(devDir2, { fetchAllMetrics: async () => mockData }),
      paths: tmpP,
      cfg:   makeTestCfg(),
    });
    const res  = await f2.inject({ method: 'GET', url: '/api/metrics' });
    const body = JSON.parse(res.body);
    assert.equal(body._window, '15m');
    assert.equal(body.wind.apparentSpeed.stats.last, 12.3);
    d2();
    await f2.close();
    rmSync(tmpP.screensDir, { recursive: true, force: true });
    rmSync(devDir2,          { recursive: true, force: true });
  });
});

// ─── /api/render/:format ────────────────────────────────────────────────────────

describe('GET /api/render/:format', () => {
  let fastify, dispose, tmpPaths, devDir;

  before(() => {
    tmpPaths = makeTmpPaths();
    devDir   = mkdtempSync(join(tmpdir(), 'trmnl-devs-'));
    ({ fastify, dispose } = createApp({
      deps:  makeMockDeps(devDir),
      paths: tmpPaths,
      cfg:   makeTestCfg(),
    }));
  });

  after(async () => {
    dispose();
    await fastify.close();
    rmSync(tmpPaths.screensDir, { recursive: true, force: true });
    rmSync(devDir,              { recursive: true, force: true });
  });

  test('returns 400 for unsupported format', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/render/svg' });
    assert.equal(res.statusCode, 400);
    assert.ok(JSON.parse(res.body).error.includes('svg'));
  });

  test('returns 200 image/bmp for /api/render/bmp', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/render/bmp' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type'].includes('image/bmp'));
  });

  test('returns 200 image/png for /api/render/png', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/render/png' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type'].includes('image/png'));
  });

  test('sets Cache-Control: no-store', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/render/bmp' });
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  test('returns 503 when fetchAllMetrics throws', async () => {
    const tmpP   = makeTmpPaths();
    const devDir2 = mkdtempSync(join(tmpdir(), 'trmnl-devs2-'));
    const { fastify: f2, dispose: d2 } = createApp({
      deps: makeMockDeps(devDir2, {
        fetchAllMetrics: async () => { throw new Error('InfluxDB down'); },
      }),
      paths: tmpP,
      cfg:   makeTestCfg(),
    });
    const res = await f2.inject({ method: 'GET', url: '/api/render/bmp' });
    assert.equal(res.statusCode, 503);
    assert.ok(JSON.parse(res.body).error.includes('InfluxDB down'));
    d2();
    await f2.close();
    rmSync(tmpP.screensDir, { recursive: true, force: true });
    rmSync(devDir2,          { recursive: true, force: true });
  });

  test('bmp and png produce separate output files', async () => {
    await fastify.inject({ method: 'GET', url: '/api/render/bmp' });
    await fastify.inject({ method: 'GET', url: '/api/render/png' });
    const { existsSync } = await import('node:fs');
    const { join: j }   = await import('node:path');
    assert.ok(existsSync(j(tmpPaths.screensDir, 'render_bmp.bmp')), 'render_bmp.bmp should exist');
    assert.ok(existsSync(j(tmpPaths.screensDir, 'render_png.png')), 'render_png.png should exist');
  });
});
