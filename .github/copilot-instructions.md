# Marine TRMNL Server — Copilot Instructions

## Project Purpose

This is a **BYOS (Bring-Your-Own-Server) API** for a [TRMNL](https://usetrmnl.com/) e-ink display device
mounted aboard a sailing boat. It runs on a Raspberry Pi on the vessel's local network.

**Data pipeline:**
```
SignalK (boat sensors)
  → InfluxDB 2.x  (localhost:8086)
  → HTML render   (src/renderer.js — 800×480 CSS grid dashboard)
  → Puppeteer     (headless Chrome screenshot → PNG)
  → ImageMagick   (PNG → BMP3 monochrome OR 4-level grayscale PNG)
  → TRMNL device  (fetches via BYOS HTTP API)
```

**Display models supported:**
| `display.bitDepth` | Output format | TRMNL model |
|---|---|---|
| `1` | BMP3 monochrome | TRMNL Standard / Developer |
| `2` | Floyd-Steinberg 4-level grayscale PNG | TRMNL OG |

---

## Tech Stack

- **Runtime:** Node.js 20+, ESM (`"type": "module"`) — always `import`/`export`, never `require()`
- **HTTP:** Fastify v5.2.1
- **Screenshot:** puppeteer-core v24 (headless Chrome)
- **Image conversion:** ImageMagick CLI (`convert` command — not a Node package)
- **InfluxDB:** `@influxdata/influxdb-client`
- **InfluxDB org/bucket:** configurable via `config.yaml` (`influxdb.org` / `influxdb.bucket`)
- **Config:** `js-yaml` parsing `config.yaml`; secrets via `dotenv` from `.env`
- **Tests:** `node:test` built-in only — no Jest, Mocha, Vitest, or any other test framework

---

## Source Layout

```
src/
  app.js        — createApp() factory; Fastify routes; all deps injected
  config.js     — config.yaml loader + .env integration
  converter.js  — toDisplayImage(), pngToBmp3(), pngTo2BitGrayscale(), displayExtension()
  devices.js    — createDeviceStore(); file-backed JSON device registry
  influx.js     — queryStats(), queryTimeSeries(), buildQuery helpers
  renderer.js   — renderDashboard(), renderSetupScreen(), buildPreviewPage(), buildCss(), pressureSparklineSvg()
  screenshot.js — screenshotHtml() Puppeteer wrapper
  server.js     — production entry point; wires deps and starts Fastify
  utils.js      — SI unit converters: mps_to_kts, rad_to_deg, kelvin_to_c, pa_to_hpa, etc.
test/
  unit/         — unit tests; import modules directly with mock inputs
  integration/  — instantiate createApp() with injected mock deps; use fastify.inject()
config.yaml     — all non-secret configuration
.env            — INFLUXDB_TOKEN (gitignored; see .env.example)
```

---

## Architecture Principles

### Dependency Injection via Factories
`createApp()` and `createDeviceStore()` accept all external dependencies as parameters.
Tests pass mock functions; production passes real implementations.
**Never** call external services or the filesystem directly at module scope.

```js
// Good — injectable
export function createApp({ deps, paths, cfg, initialState = {} }) { … }

// Bad — not testable
const client = new InfluxDB({ url: config.influxdb.url }); // top-level side effect
```

### Route Naming Conventions (`app.js`)
| BYOS route | Description |
|---|---|
| `GET /api/setup` | Returns device setup JSON |
| `GET /api/display` | Returns next image URL + refresh interval |
| `POST /api/log` | Receives firmware telemetry; calls `updateTelemetry()` |
| `GET /api/metrics` | Returns full `fetchAllMetrics()` JSON payload |
| `GET /api/render/:format` | On-demand render in `bmp` or `png`; runs full pipeline |
| `GET /screens/:file` | Serves generated image files |
| `GET /preview` | Live browser dashboard (auto-refreshes from `/api/metrics`) |
| `GET /health` | JSON health/status endpoint |

### Image File Paths
Paths are assembled in `server.js` and passed into `createApp()` as `paths`:
- `DASHBOARD_RAW` — Puppeteer output PNG (e.g. `screens/dashboard.png`)
- `DASHBOARD_DISPLAY` — converted display file (`.bmp` or `.png`)
- `SETUP_RAW` / `SETUP_DISPLAY` — same pattern for the setup screen

### Security
- Path traversal guard on `/screens/:file`: use `startsWith(screensDir + '/')` (with separator).
- Tokens/passwords always in `.env`, referenced in `config.yaml` as `${ENV_VAR_NAME}`.
  Never hardcode credentials or commit `.env`.

---

## Coding Standards

### JavaScript Style
- **2-space indentation**, semicolons, single quotes for strings
- `const`/`let` only — never `var`
- Arrow functions for pure utilities; named `function` declarations for Fastify route handlers
- JSDoc on every exported function: `@param`, `@returns`, types inline (not TypeScript)
- `node:` prefix for all built-in imports: `import { readFileSync } from 'node:fs'`

```js
// Good
import { readFileSync } from 'node:fs';

/**
 * Convert metres/second to knots.
 * @param {number} v
 * @returns {number}
 */
export const mps_to_kts = (v) => v * 1.94384;
```

### Error Handling
- Fastify route handlers return `reply.code(N).send({ error: '…' })` — never `throw` from routes
- Async errors in background tasks (`setInterval` callbacks, init functions) must be caught and
  logged; they must not crash the server
- Log with `fastify.log` inside app.js; use `console.error` only in server.js and CLI contexts

### Config Access
- Import the config object from `src/config.js`; never re-parse `config.yaml` inline
- Access display config as `cfg.displayConfig.bitDepth`, `cfg.displayConfig.theme`, etc.

### InfluxDB Queries (`influx.js`)
- Stats queries: `queryStats(metrics)` — returns `{ [skPath]: { min, max, mean, last } }`
- Time-series: `queryTimeSeries(skPath, windowSeconds, every)` — returns `[{ _time, _value }]`
- Always use `aggregateWindow` with `createEmpty: false` for time-series to avoid null padding
- Schema is configurable (`path_as_measurement` vs `tagged`) — read from `cfg.influxdbConfig.schema`

### Renderer (`renderer.js`)
- Dashboard is a **3-column CSS grid**: `260px 270px 270px` (fixed, not fluid)
- Columns: Navigation/Depth/Battery panel | Wind/Compass panel | Cabin/Env panel
- Stat rows use `display:flex; justify-content:center` with `min-width:2.8em` per value cell
- Palette colours must snap to 4 e-ink grey levels when `bitDepth === 2`: `0`, `85`, `170`, `255`
- Battery values displayed to **1 decimal place**
- Pressure sparkline is pinned to the bottom of the wind panel via `margin-top: auto`

### SignalK / Unit Conventions
SignalK stores all values in SI units. Always convert for display:
| Measurement | SI unit | Display unit | Converter |
|---|---|---|---|
| Speed (wind/vessel) | m/s | knots | `mps_to_kts` |
| Angle (heading/wind) | radians | degrees 0–360 | `rad_to_deg` |
| Temperature | Kelvin | °C | `kelvin_to_c` |
| Pressure | Pascals | hPa (mbar) | `pa_to_hpa` |
| Depth | metres | metres (1dp) | — |

---

## Testing Standards

- **Framework:** `node:test` built-in only
- **Assertions:** `import { strict as assert } from 'node:assert'`
- **Run:** `node --test test/**/*.test.js` (or `npm test`)

```js
import { test, describe, before, after, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
```

### Unit Tests (`test/unit/`)
- Import the module under test directly
- Pass controlled inputs; assert outputs
- No filesystem or network access

### Integration Tests (`test/integration/`)
- Instantiate `createApp({ deps: mockDeps, paths: testPaths, cfg: testCfg })`
- Use `fastify.inject()` for all HTTP calls — never start a real server
- Mock all deps (influx, renderer, screenshot, converter) with minimal stubs
- Use `tmp` directories created with `mkdtempSync` for file I/O tests; clean up in `after()`

---

## Configuration Reference

```yaml
# config.yaml (non-secret settings)
byos:
  baseUrl: "http://<PI_IP>:3001"   # URL TRMNL device uses to reach this server
  chromiumPath: "/usr/bin/chromium-browser"
  screensDir: "./screens"

vessel:
  name: "HEBE"

server:
  port: 3001
  host: "0.0.0.0"

influxdb:
  url: "http://localhost:8086"
  token: "${INFLUXDB_TOKEN}"       # from .env
  org: "my-org"
  bucket: "signalk"
  schema: "path_as_measurement"   # SignalK→InfluxDB v1 plugin format

display:
  refreshIntervalSeconds: 900     # 15 minutes
  bitDepth: 2                     # 1 = BMP3, 2 = 4-level grayscale PNG
  theme: "light"                  # "light" | "dark"
```

```
# .env (gitignored — never commit)
INFLUXDB_TOKEN=<token>
```

---

## Git Conventions

- Conventional commits: `feat:`, `fix:`, `test:`, `chore:`, `refactor:`, `docs:`
- Branch: `main`
- Never commit `.env` or any file containing real tokens
