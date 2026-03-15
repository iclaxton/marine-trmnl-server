# Marine TRMNL Server — Claude Instructions

## Project Purpose

BYOS (Bring-Your-Own-Server) API for a [TRMNL](https://usetrmnl.com/) e-ink display mounted aboard
sailing vessel **HEBE**. Runs on a Raspberry Pi named **hebepi** (192.168.1.x, port 3001).

**Data pipeline:**
```
SignalK → InfluxDB 2.x (hebepi:8086) → HTML render (800×480) → Puppeteer PNG → ImageMagick → TRMNL device
```

---

## Common Commands

```bash
# Run all tests
npm test
# or
node --test test/**/*.test.js

# Start the server (production)
node src/server.js

# Check ImageMagick is available
which convert

# Inspect InfluxDB connection
curl -s http://hebepi:8086/health
```

---

## Tech Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 20+ ESM (`"type": "module"`) |
| HTTP server | Fastify v5.2.1 |
| Screenshot | puppeteer-core v24 (headless Chrome) |
| Image conversion | ImageMagick CLI (`convert`) — not a Node package |
| InfluxDB client | `@influxdata/influxdb-client` |
| Config | `js-yaml` + `dotenv` |
| Tests | `node:test` built-in **only** |

**Never use `require()`** — this is ESM throughout.

**Never use Jest, Mocha, Vitest, or any non-built-in test framework.**

---

## Source Layout

```
src/
  app.js        — createApp() factory; Fastify routes; all deps injected
  config.js     — config.yaml loader + .env secret injection
  converter.js  — toDisplayImage(), pngToBmp3(), pngTo2BitGrayscale(), displayExtension()
  devices.js    — createDeviceStore(); file-backed JSON device registry
  influx.js     — queryStats(), queryTimeSeries(), buildQuery helpers
  renderer.js   — renderDashboard(), renderSetupScreen(), buildPreviewPage(), buildCss(), pressureSparklineSvg()
  screenshot.js — screenshotHtml() Puppeteer wrapper
  server.js     — production entry point; wires real deps and starts Fastify
  utils.js      — converters: mps_to_kts, rad_to_deg, kelvin_to_c, pa_to_hpa, applyConversion()
test/
  unit/         — pure function tests; no mocking library needed
  integration/  — createApp() with mock deps + fastify.inject()
config.yaml     — all non-secret config
.env            — INFLUXDB_TOKEN (gitignored)
.env.example    — safe template committed to git
```

---

## Architecture: Dependency Injection

All external deps flow in via factory functions — never instantiate at module scope.

```js
// app.js — production
export function createApp({ deps, paths, cfg, initialState = {} }) { … }

// Integration test
const { fastify } = createApp({
  deps: {
    fetchAllMetrics: async () => ({}),
    renderDashboard: async () => '<html/>',
    renderSetupScreen: () => '<html/>',
    buildPreviewPage: (name) => `<html><title>${name}</title></html>`,
    screenshotHtml: async () => {},
    toDisplayImage: async () => {},
    displayExtension: () => 'bmp',
    checkImageMagick: async () => 'magick',
    devices: { getOrCreate, get, updateTelemetry, updateCapabilities, list },
  },
  paths: { screensDir: '/tmp/…', DASHBOARD_RAW: '…', DASHBOARD_DISPLAY: '…', SETUP_RAW: '…', SETUP_DISPLAY: '…' },
  cfg: { byosConfig: { baseUrl: 'http://localhost:3001' }, displayConfig: { bitDepth: 1, refreshIntervalSeconds: 900 }, … },
  initialState: { dashboardReady: true },
});
const res = await fastify.inject({ method: 'GET', url: '/health' });
```

---

## API Routes

| Route | Description |
|---|---|
| `GET /api/setup` | BYOS setup payload for TRMNL firmware |
| `GET /api/display` | Next image URL + refresh interval |
| `POST /api/log` | Firmware telemetry (calls `updateTelemetry()`) |
| `GET /api/metrics` | Full `fetchAllMetrics()` JSON — used by `/preview` |
| `GET /api/render/:format` | On-demand render: `bmp` (1-bit) or `png` (2-bit); runs full pipeline |
| `GET /screens/:file` | Serve generated image files |
| `GET /preview` | Live browser dashboard (fetches `/api/metrics`, auto-refreshes every 30s) |
| `GET /health` | JSON health/status |

---

## Image Pipeline Details

| `bitDepth` | Function | Output |
|---|---|---|
| `1` | `pngToBmp3(src, dst)` | BMP3 monochrome via ImageMagick |
| `2` | `pngTo2BitGrayscale(src, dst)` | Floyd-Steinberg 4-level grayscale PNG |

`displayExtension(bitDepth)` → `'bmp'` or `'png'`

Path names passed to `createApp()` as `paths`:
- `DASHBOARD_RAW` — Puppeteer PNG output
- `DASHBOARD_DISPLAY` — converted display file
- `SETUP_RAW` / `SETUP_DISPLAY` — setup screen equivalents

---

## Coding Standards

```js
// 2-space indent, semicolons, single quotes, const/let only
import { readFileSync } from 'node:fs';   // node: prefix for built-ins

/**
 * Convert metres/second to knots.
 * @param {number} v
 * @returns {number}
 */
export const mps_to_kts = (v) => v * 1.94384;
```

- Named `function` declarations for Fastify route handlers
- Arrow functions for pure utilities
- JSDoc on every exported symbol (`@param`, `@returns`)
- Route handlers: `reply.code(N).send({ error: '…' })` — never `throw`
- Log with `fastify.log` in app.js; `console.error` only in server.js

---

## InfluxDB

- **URL:** `http://hebepi:8086` | **org:** `Hebe` | **bucket:** `Hebe` | **orgID:** `718b491b0ca68e0e`
- **Token:** `INFLUXDB_TOKEN` env var (never hardcode)
- **Schema:** `path_as_measurement` — measurement = SignalK path, field = `"value"`
- `queryStats(metrics)` → `{ [skPath]: { min, max, mean, last } }`
- `queryTimeSeries(skPath, windowSeconds, every='15m')` → `[{ _time, _value }]`
- Always `aggregateWindow` with `createEmpty: false` to avoid null padding

---

## Renderer Layout

- **Grid:** `260px 270px 270px` (3 columns, fixed — not fluid)
- **Column 1:** Navigation, Depth, Battery
- **Column 2:** Wind (AWS/AWA, TWS/TWA), Compass SVG, Pressure sparkline (pinned bottom via `margin-top: auto`)
- **Column 3:** Cabin temperature, environmental data
- **Stat rows:** `display:flex; justify-content:center` with `min-width:2.8em` per value cell
- **2-bit palette:** colours snap to `0`, `85`, `170`, `255` only
- **Battery:** always 1 decimal place

---

## SignalK Unit Conversions

SignalK stores all values in SI. Always convert for display:

| Signal | SI | Display | Converter |
|---|---|---|---|
| Speed | m/s | knots | `mps_to_kts` |
| Angle | radians | degrees 0–360 | `rad_to_deg` |
| Temperature | Kelvin | °C | `kelvin_to_c` |
| Pressure | Pascals | hPa | `pa_to_hpa` |
| Depth | metres | metres (1dp) | — |

---

## Testing

```js
import { test, describe, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
```

- `test/unit/` — import module, assert outputs, no network/FS
- `test/integration/` — `createApp()` + `fastify.inject()` + `mkdtempSync` for temp files
- Clean up temp dirs in `after()` with `rmSync(dir, { recursive: true, force: true })`
- Mock deps are minimal plain functions — no mock libraries

---

## Security

- Path traversal guard: `resolvedPath.startsWith(screensDir + '/')` (separator included)
- Secrets in `.env` only; referenced in `config.yaml` as `${ENV_VAR_NAME}`
- Never commit `.env`

---

## Git Conventions

- Conventional commits: `feat:`, `fix:`, `test:`, `chore:`, `refactor:`, `docs:`
- Branch: `main`
- Never commit `.env` or files with real tokens
