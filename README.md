# Marine TRMNL Server

[![CI](https://github.com/iclaxton/marine-trmnl-server/actions/workflows/ci.yml/badge.svg)](https://github.com/iclaxton/marine-trmnl-server/actions/workflows/ci.yml)

A lightweight Node.js server for a Raspberry Pi that generates a marine
dashboard for the [TRMNL](https://usetrmnl.com) e-ink display.

Reads windowed statistics (min / avg / max) from **InfluxDB 2.x** (fed by
[SignalK](https://signalk.org)) and serves a pixel-perfect **800×480 HTML
dashboard** designed for the TRMNL e-ink display.

![Marine TRMNL dashboard screenshot](https://raw.githubusercontent.com/iclaxton/marine-trmnl-server/main/docs/dashboard.png)

---

## Dashboard panels

| Panel | Metrics |
|---|---|
| **Wind** | AWS, AWA, TWS, TWA with compass arrow + port/stbd badge |
| **Navigation** | SOG (large), COG, Heading |
| **Depth & Water** | Depth below keel, Water temperature |
| **Battery** | Per-bank voltage + current with charge state colour |
| **Cabin Temp** | Interior temperature |

Each value shows the **current reading** (bold/large) plus a
**min · avg · max** row covering the refresh window period.

---

## Requirements

- Node.js 20+
- InfluxDB 2.x (local, e.g. `http://localhost:8086`)
- SignalK pushing data to InfluxDB via
  [`signalk-to-influxdb2`](https://github.com/tkurki/signalk-to-influxdb) or
  similar
- A TRMNL display (Standard or Developer edition)
- **System Chromium** (`chromium-browser`) — for headless screenshot
- **ImageMagick** — for PNG→BMP3 conversion

---

## Quick start

Run this single command — it clones the repo, installs dependencies, and walks you through configuration:

```bash
curl -fsSL https://raw.githubusercontent.com/iclaxton/marine-trmnl-server/main/setup.sh | bash
```

> **Tip:** you can also clone manually first and run `bash setup.sh` from the repo directory.

```bash
# 1. Install system dependencies (Pi)
sudo apt install chromium-browser imagemagick

# 2. Install Node dependencies
npm install

# 3. Create your .env file
cp .env.example .env
# Then edit .env — set INFLUXDB_TOKEN, and any other values to override

# 4. Edit config.yaml
#    - Set byos.baseUrl to your Pi's IP (e.g. http://192.168.1.100:3002)
#    - Set vessel.name
#    - Set influxdb.url / org / bucket
#    - Set influxdb.schema to match your SignalK plugin
#    - Adjust metric paths to match your SignalK→InfluxDB setup
#    - Set display.refreshIntervalSeconds

# 5. Start the server
npm start
```

Open `http://<your-pi-ip>:3002/preview` in a browser to see the live dashboard (auto-refreshes every 30 s).

---

## Configuration

All settings live in **`config.yaml`**. Sensitive values (the InfluxDB token)
are kept in **`.env`** and referenced as `${INFLUXDB_TOKEN}`.

### Key settings

```yaml
byos:
  baseUrl: "http://192.168.1.100:3002"   # Pi's LAN IP — used in image URLs sent to device
  chromiumPath: "/usr/bin/chromium-browser"
  screensDir: "./screens"

vessel:
  name: "My Boat"          # Header label

influxdb:
  url: "http://localhost:8086"
  token: "${INFLUXDB_TOKEN}"
  org: "marine"
  bucket: "signalk"
  # Schema your SignalK plugin uses:
  #   "path_as_measurement"  — measurement = SK path, field = "value"  (most common)
  #   "tagged"               — measurement = "signalk", tag[path] = value
  schema: "path_as_measurement"

display:
  refreshIntervalSeconds: 900   # 15 min — also sets the stats window
  theme: "light"                # "light" or "dark"

metrics:
  wind:
    enabled: true
    apparentSpeed:
      path: "environment.wind.speedApparent"
      unit: "kts"
      conversion: "mps_to_kts"
  # ... (see config.yaml for all options)
```

### Metric paths

The `path` values must match exactly how your SignalK plugin stores them in
InfluxDB. Common SignalK paths:

| Metric | SignalK path |
|---|---|
| Apparent wind speed | `environment.wind.speedApparent` |
| Apparent wind angle | `environment.wind.angleApparent` |
| True wind speed | `environment.wind.speedTrue` |
| True wind angle | `environment.wind.angleTrueWater` |
| Speed over ground | `navigation.speedOverGround` |
| Course over ground | `navigation.courseOverGroundTrue` |
| True heading | `navigation.headingTrue` |
| Depth below keel | `environment.depth.belowKeel` |
| Water temperature | `environment.water.temperature` |
| Battery voltage | `electrical.batteries.<id>.voltage` |
| Battery current | `electrical.batteries.<id>.current` |
| Cabin temperature | `environment.inside.temperature` |

### Unit conversions

SignalK stores SI values. Configure `conversion` in `config.yaml`:

| Conversion | Description |
|---|---|
| `mps_to_kts` | m/s → knots |
| `mps_to_kmh` | m/s → km/h |
| `rad_to_deg` | radians → degrees (0–360) |
| `kelvin_to_c` | Kelvin → Celsius |
| `kelvin_to_f` | Kelvin → Fahrenheit |
| `pa_to_hpa` | Pascals → hectopascals (mbar) |

---

## TRMNL BYOS integration

This server implements the full TRMNL device firmware API (BYOS protocol).
The device talks directly to the Pi — no TRMNL cloud involvement.

### Image pipeline

The **scheduled pipeline** (every `refreshIntervalSeconds`) generates the file the TRMNL device fetches:

```
InfluxDB metrics
    → HTML render (renderer.js, bitDepth-aware)
    → Headless Chromium screenshot (spawnSync) → PNG
    → ImageMagick conversion
    → /screens/dashboard.bmp  (bitDepth=1, 1-bit monochrome)
       /screens/dashboard.png  (bitDepth=2, 4-level grayscale)
    → served at {baseUrl}/screens/dashboard.<ext>
```

The **on-demand render** endpoints run the same pipeline immediately and stream the result:

```
GET /api/render/bmp  → 1-bit monochrome BMP3   (TRMNL Standard / Developer)
GET /api/render/png  → 4-level grayscale PNG    (TRMNL OG)
```

These are independent of the scheduled file — useful for layout development.

The device hits `GET /api/display` and receives:
```json
{
  "filename": "dashboard.bmp",
  "image_url": "http://192.168.1.100:3002/screens/dashboard.bmp",
  "refresh_rate": 900,
  "image_url_timeout": 0,
  "reset_firmware": false,
  "update_firmware": false
}
```

It then fetches the BMP directly and renders it.

### Pi setup

```bash
# Recommended: one-liner (clones repo + guided setup)
curl -fsSL https://raw.githubusercontent.com/iclaxton/marine-trmnl-server/main/setup.sh | bash

# --- or clone first and then run setup ---
git clone https://github.com/iclaxton/marine-trmnl-server.git
cd marine-trmnl-server
bash setup.sh

# --- or follow the manual steps below ---

# 1. Install system dependencies
sudo apt update
sudo apt install chromium-browser imagemagick

# 2. Install Node.js 20+ (if not present)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs

# 3. Clone and set up the server
cd ~
git clone <your-repo> marine-trmnl-server
cd marine-trmnl-server
npm install
cp .env.example .env
nano .env   # Add your INFLUXDB_TOKEN

# 4. Edit config.yaml
#    - Set byos.baseUrl to your Pi's IP, e.g. http://192.168.1.100:3002
#    - Confirm byos.chromiumPath is /usr/bin/chromium-browser
#    - Set influxdb.url / org / bucket / schema
#    - Adjust metric paths

# 5. Test it works
npm start
# Open http://<pi-ip>:3002/preview in a browser
```

### Docker deployment (alternative to bare-metal)

Docker handles Node.js, Chromium and ImageMagick automatically — no manual
`apt install` needed. The image works on both Raspberry Pi (arm64) and x86.

A pre-built multi-platform image is published to GitHub Container Registry and
Docker Hub on every push to `main`:

```bash
# GitHub Container Registry
docker pull ghcr.io/iclaxton/marine-trmnl-server:latest

# Docker Hub
docker pull klaxian/marine-trmnl-server:latest
```

Or build locally:

```bash
# 1. Copy and edit your config
cp .env.example .env
nano .env          # Add INFLUXDB_TOKEN
nano config.yaml   # Set baseUrl, vessel name, InfluxDB settings

# 2. Build and start
docker compose up -d

# 3. View logs
docker compose logs -f
```

> **Raspberry Pi (arm64):** uncomment `platform: linux/arm64` in
> `docker-compose.yml`, or build natively on the Pi (recommended — avoids
> emulation overhead).

The container automatically mounts `./config.yaml`, `./screens/` and
`./data/` from your project directory, so no rebuild is needed after config
changes — just restart:

```bash
docker compose restart
```

### Connect your TRMNL device

1. Hold the button on the TRMNL to enter WiFi setup mode
2. Connect your phone to the TRMNL's WiFi hotspot
3. In the captive portal, set **Custom Server URL** to:
   `http://<your-pi-ip>:3002`
4. Connect to your boat's WiFi and complete setup
5. The device will call `/api/setup` then start polling `/api/display`

### Run as a systemd service on Pi

```bash
sudo tee /etc/systemd/system/marine-trmnl.service > /dev/null <<EOF
[Unit]
Description=Marine TRMNL Dashboard Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/marine-trmnl-server
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable marine-trmnl
sudo systemctl start marine-trmnl
sudo systemctl status marine-trmnl
```

---

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/setup` | Device provisioning — `ID: <mac>` header required |
| `GET /api/display` | Returns `image_url` + `refresh_rate` JSON for the device |
| `POST /api/log` | Device telemetry logging (battery, WiFi, firmware) |
| `GET /api/metrics` | Live metrics JSON from InfluxDB (`fetchAllMetrics()` payload) |
| `GET /api/render/bmp` | On-demand: render + convert to 1-bit BMP3, stream result |
| `GET /api/render/png` | On-demand: render + convert to 4-level grayscale PNG, stream result |
| `GET /screens/:file` | Serves the generated `dashboard.bmp` / `setup.bmp` etc. |
| `GET /preview` | Live browser dashboard — fetches `/api/metrics`, auto-refreshes every 30 s |
| `GET /health` | JSON status (cache state, last error, device count) |

---

## Project structure

```
marine-trmnl-server/
├── src/
│   ├── server.js      — Production entry point; wires deps and starts Fastify
│   ├── app.js         — createApp() factory; all routes; deps injected
│   ├── screenshot.js  — Headless Chromium HTML→PNG (spawnSync, Pi-optimised flags)
│   ├── converter.js   — ImageMagick PNG→BMP3 / PNG→2-bit grayscale
│   ├── devices.js     — File-backed device registry (data/devices.json)
│   ├── influx.js      — InfluxDB 2.x Flux queries (windowed min/max/mean/last + time-series)
│   ├── renderer.js    — 800×480 HTML dashboard, setup screen, browser preview page
│   ├── utils.js       — Unit conversions, formatting helpers
│   └── config.js      — YAML config loader with env var interpolation
├── screens/           — Generated BMP/PNG files (git-ignored)
├── data/              — Device registry JSON (git-ignored)
├── config.yaml        — All user-facing configuration
├── .env.example       — Template for secrets
├── setup.sh           — Interactive guided setup (dependencies, .env, service install)
├── Dockerfile         — Multi-stage build (Node 20 + Chromium + ImageMagick)
├── docker-compose.yml — Docker Compose for Pi / local deployment
└── package.json
```
