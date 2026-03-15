#!/usr/bin/env bash
# =============================================================================
# Marine TRMNL Server — Setup Script
# =============================================================================
# Detects your OS, installs dependencies, writes .env, and optionally installs
# the server as a system service (systemd on Linux, launchd on macOS).
#
# Usage (one-liner from anywhere):
#   curl -fsSL https://raw.githubusercontent.com/iclaxton/marine-trmnl-server/main/setup.sh | bash
#
# Or if you have the repo already cloned:
#   bash setup.sh
# =============================================================================

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

info()    { echo -e "${CYAN}▸ $*${RESET}"; }
success() { echo -e "${GREEN}✓ $*${RESET}"; }
warn()    { echo -e "${YELLOW}⚠ $*${RESET}"; }
error()   { echo -e "${RED}✗ $*${RESET}" >&2; exit 1; }
ask()     { echo -e "${BOLD}$*${RESET}"; }

# ── OS Detection ─────────────────────────────────────────────────────────────

OS="unknown"
IS_PI=false
ARCH=$(uname -m)

case "$(uname -s)" in
  Darwin) OS="macos" ;;
  Linux)
    OS="linux"
    # Detect Raspberry Pi via device-tree model file or cpuinfo
    if [[ -f /proc/device-tree/model ]] && grep -qi "raspberry pi" /proc/device-tree/model 2>/dev/null; then
      IS_PI=true
    elif [[ -f /proc/cpuinfo ]] && grep -qi "raspberry pi" /proc/cpuinfo 2>/dev/null; then
      IS_PI=true
    fi
    ;;
  *) error "Unsupported OS: $(uname -s). This script supports macOS and Linux." ;;
esac

echo ""
echo -e "${BOLD}╔════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║   Marine TRMNL Server — Setup          ║${RESET}"
echo -e "${BOLD}╚════════════════════════════════════════╝${RESET}"
echo ""

if [[ "$OS" == "macos" ]]; then
  info "Detected OS: macOS (${ARCH})"
elif [[ "$IS_PI" == "true" ]]; then
  info "Detected OS: Raspberry Pi Linux (${ARCH})"
else
  info "Detected OS: Linux (${ARCH})"
fi
echo ""

# ── Script Directory ─────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Helpers ───────────────────────────────────────────────────────────────────

command_exists() { command -v "$1" &>/dev/null; }

prompt() {
  local var_name="$1"
  local prompt_text="$2"
  local default_val="${3:-}"
  local value

  if [[ -n "$default_val" ]]; then
    read -rp "$(echo -e "${BOLD}${prompt_text}${RESET} [${CYAN}${default_val}${RESET}]: ")" value </dev/tty
    echo "${value:-$default_val}"
  else
    read -rp "$(echo -e "${BOLD}${prompt_text}${RESET}: ")" value </dev/tty
    echo "$value"
  fi
}

prompt_yesno() {
  local prompt_text="$1"
  local default="${2:-n}"  # 'y' or 'n'
  local yn_hint
  if [[ "$default" == "y" ]]; then yn_hint="[Y/n]"; else yn_hint="[y/N]"; fi

  local answer
  read -rp "$(echo -e "${BOLD}${prompt_text}${RESET} ${yn_hint}: ")" answer </dev/tty
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy]$ ]]
}

# ── Step 0: Clone repository (when running via curl | bash) ─────────────────

if [[ ! -f "$SCRIPT_DIR/src/server.js" ]]; then
  echo -e "${BOLD}── Step 0: Clone repository ─────────────────────────────${RESET}"
  echo ""

  if ! command_exists git; then
    error "git is required to clone the repository. Please install git and re-run."
  fi

  INSTALL_DIR_DEFAULT="$HOME/marine-trmnl-server"
  read -rp "$(echo -e "${BOLD}Install directory${RESET} [${CYAN}${INSTALL_DIR_DEFAULT}${RESET}]: ")" _install_input </dev/tty
  INSTALL_DIR="${_install_input:-$INSTALL_DIR_DEFAULT}"

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Repository already exists at ${INSTALL_DIR} — pulling latest…"
    git -C "$INSTALL_DIR" pull --ff-only
  else
    info "Cloning into ${INSTALL_DIR}…"
    git clone https://github.com/iclaxton/marine-trmnl-server.git "$INSTALL_DIR"
    success "Repository cloned ✓"
  fi

  echo ""
  info "Continuing setup from ${INSTALL_DIR}…"
  exec bash "$INSTALL_DIR/setup.sh"
fi
echo ""

# ── Step 1: Node.js ──────────────────────────────────────────────────────────

echo -e "${BOLD}── Step 1: Node.js ──────────────────────────────────────────${RESET}"

if command_exists node; then
  NODE_VERSION=$(node --version | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [[ "$NODE_MAJOR" -ge 20 ]]; then
    success "Node.js v${NODE_VERSION} ✓"
  else
    warn "Node.js v${NODE_VERSION} found but v20+ is required."
    if [[ "$OS" == "macos" ]]; then
      warn "Install with: brew install node"
    else
      warn "Install via NodeSource: https://github.com/nodesource/distributions"
    fi
    error "Please upgrade Node.js to v20+ and re-run this script."
  fi
else
  warn "Node.js not found."
  if [[ "$OS" == "macos" ]]; then
    info "Installing Node.js via Homebrew…"
    command_exists brew || error "Homebrew not found. Install from https://brew.sh then re-run."
    brew install node
    success "Node.js installed ✓"
  elif [[ "$IS_PI" == "true" ]] || [[ "$OS" == "linux" ]]; then
    info "Installing Node.js 20 via NodeSource…"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null || true
    sudo apt-get update -qq --allow-releaseinfo-change 2>/dev/null || true
    sudo apt-get install -y nodejs
    success "Node.js installed ✓"
  fi
fi
echo ""

# ── Step 2: ImageMagick ───────────────────────────────────────────────────────

echo -e "${BOLD}── Step 2: ImageMagick ──────────────────────────────────────${RESET}"

IM_CMD=""
if command_exists magick; then
  IM_CMD="magick"
  success "ImageMagick 7 (magick) ✓"
elif command_exists convert; then
  IM_CMD="convert"
  success "ImageMagick 6 (convert) ✓"
else
  warn "ImageMagick not found."
  if [[ "$OS" == "macos" ]]; then
    info "Installing ImageMagick via Homebrew…"
    command_exists brew || error "Homebrew not found. Install from https://brew.sh then re-run."
    brew install imagemagick
    success "ImageMagick installed ✓"
    IM_CMD="magick"
  elif [[ "$IS_PI" == "true" ]] || [[ "$OS" == "linux" ]]; then
    info "Installing ImageMagick via apt…"
    sudo apt-get update -qq --allow-releaseinfo-change 2>/dev/null || true
    sudo apt-get install -y imagemagick
    success "ImageMagick installed ✓"
    IM_CMD="convert"
  fi
fi
echo ""

# ── Step 3: Chromium / Chrome ─────────────────────────────────────────────────

echo -e "${BOLD}── Step 3: Chromium / Chrome ────────────────────────────────${RESET}"

CHROMIUM_PATH_DEFAULT=""

if [[ "$OS" == "macos" ]]; then
  # Check common macOS browser locations
  for path in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
    "/Applications/Brave Browser 3.app/Contents/MacOS/Brave Browser" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  do
    if [[ -x "$path" ]]; then
      CHROMIUM_PATH_DEFAULT="$path"
      success "Found browser: ${path}"
      break
    fi
  done

  if [[ -z "$CHROMIUM_PATH_DEFAULT" ]]; then
    warn "No compatible browser found in /Applications."
    warn "Please install Google Chrome, Brave Browser, or Chromium."
    warn "Set CHROMIUM_PATH manually in .env after installation."
    CHROMIUM_PATH_DEFAULT="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  fi
else
  # Linux / Raspberry Pi
  for cmd in chromium-browser chromium google-chrome google-chrome-stable; do
    if command_exists "$cmd"; then
      CHROMIUM_PATH_DEFAULT=$(command -v "$cmd")
      success "Found browser: ${CHROMIUM_PATH_DEFAULT}"
      break
    fi
  done

  if [[ -z "$CHROMIUM_PATH_DEFAULT" ]]; then
    warn "Chromium not found."
    if [[ "$IS_PI" == "true" ]]; then
      info "Installing chromium-browser via apt…"
      sudo apt-get update -qq --allow-releaseinfo-change 2>/dev/null || true
      sudo apt-get install -y chromium-browser
      CHROMIUM_PATH_DEFAULT="/usr/bin/chromium-browser"
      success "chromium-browser installed ✓"
    else
      info "Installing chromium via apt…"
      sudo apt-get update -qq --allow-releaseinfo-change 2>/dev/null || true
      sudo apt-get install -y chromium
      CHROMIUM_PATH_DEFAULT=$(command -v chromium || echo "/usr/bin/chromium")
      success "chromium installed ✓"
    fi
  fi
fi
echo ""

# ── Step 4: npm install ───────────────────────────────────────────────────────

echo -e "${BOLD}── Step 4: npm dependencies ─────────────────────────────────${RESET}"
info "Running npm install…"
npm install --prefer-offline 2>&1 | tail -3
success "npm dependencies installed ✓"
echo ""

# ── Step 5: .env setup ────────────────────────────────────────────────────────

echo -e "${BOLD}── Step 5: Environment configuration (.env) ─────────────────${RESET}"

if [[ -f .env ]]; then
  warn ".env already exists."
  if ! prompt_yesno "Overwrite it?" "n"; then
    info "Keeping existing .env."
    echo ""
  else
    mv .env ".env.backup.$(date +%Y%m%d%H%M%S)"
    warn "Existing .env backed up."
    WRITE_ENV=true
  fi
else
  WRITE_ENV=true
fi

if [[ "${WRITE_ENV:-false}" == "true" ]]; then
  echo ""
  info "Please enter your configuration values."
  info "Press Enter to accept the [default] shown in brackets."
  echo ""

  VESSEL_NAME=$(prompt "VESSEL_NAME" "Vessel name (shown on dashboard)" "MY BOAT")

  # InfluxDB URL default depends on OS
  if [[ "$IS_PI" == "true" ]]; then
    INFLUXDB_URL_DEFAULT="http://localhost:8086"
  else
    INFLUXDB_URL_DEFAULT="http://localhost:8086"
  fi
  INFLUXDB_URL=$(prompt "INFLUXDB_URL" "InfluxDB URL" "$INFLUXDB_URL_DEFAULT")
  INFLUXDB_TOKEN=$(prompt "INFLUXDB_TOKEN" "InfluxDB API token (from InfluxDB UI → API Tokens)" "")
  INFLUXDB_ORG=$(prompt "INFLUXDB_ORG" "InfluxDB organisation name" "my-org")
  INFLUXDB_BUCKET=$(prompt "INFLUXDB_BUCKET" "InfluxDB bucket name" "signalk")

  # CHROMIUM_PATH only needed if not the default Pi path
  if [[ "$OS" == "macos" ]]; then
    CHROMIUM_PATH=$(prompt "CHROMIUM_PATH" "Path to Chrome/Brave/Chromium executable" "$CHROMIUM_PATH_DEFAULT")
  else
    CHROMIUM_PATH="$CHROMIUM_PATH_DEFAULT"
  fi

  cat > .env <<EOF
# Marine TRMNL Server — Environment Configuration
# Generated by setup.sh on $(date)
# See .env.example for documentation of each variable.

VESSEL_NAME=${VESSEL_NAME}

INFLUXDB_URL=${INFLUXDB_URL}
INFLUXDB_TOKEN=${INFLUXDB_TOKEN}
INFLUXDB_ORG=${INFLUXDB_ORG}
INFLUXDB_BUCKET=${INFLUXDB_BUCKET}
EOF

  # Only write CHROMIUM_PATH on macOS (Pi uses the config.yaml default)
  if [[ "$OS" == "macos" ]]; then
    echo "CHROMIUM_PATH=${CHROMIUM_PATH}" >> .env
  fi

  success ".env written ✓"
fi
echo ""

# ── Step 6: screens directory ─────────────────────────────────────────────────

mkdir -p screens
success "screens/ directory ready ✓"
echo ""

# ── Step 7: Test InfluxDB connection ───────────────────────────────────────────

echo -e "${BOLD}── Step 7: Test InfluxDB connection ───────────────────────${RESET}"

# Source .env to get the latest values (may have been kept from a prior run)
_INFLUXDB_URL=""
_INFLUXDB_TOKEN=""
_INFLUXDB_ORG=""
_INFLUXDB_BUCKET=""
if [[ -f .env ]]; then
  while IFS='=' read -r key val; do
    [[ "$key" =~ ^# ]] && continue
    [[ -z "$key" ]] && continue
    val="${val%%#*}"      # strip inline comments
    val="${val//\"/}"     # strip quotes
    val="${val// /}"      # trim spaces
    case "$key" in
      INFLUXDB_URL)    _INFLUXDB_URL="$val" ;;
      INFLUXDB_TOKEN)  _INFLUXDB_TOKEN="$val" ;;
      INFLUXDB_ORG)    _INFLUXDB_ORG="$val" ;;
      INFLUXDB_BUCKET) _INFLUXDB_BUCKET="$val" ;;
    esac
  done < .env
fi

# Fall back to values entered this session if .env wasn't (re)written
_INFLUXDB_URL="${_INFLUXDB_URL:-${INFLUXDB_URL:-http://localhost:8086}}"
_INFLUXDB_TOKEN="${_INFLUXDB_TOKEN:-${INFLUXDB_TOKEN:-}}"
_INFLUXDB_ORG="${_INFLUXDB_ORG:-${INFLUXDB_ORG:-}}"
_INFLUXDB_BUCKET="${_INFLUXDB_BUCKET:-${INFLUXDB_BUCKET:-}}"

info "Testing connection to ${_INFLUXDB_URL}…"

_INFLUX_OK=false
if [[ -z "${_INFLUXDB_TOKEN}" ]]; then
  warn "INFLUXDB_TOKEN is empty — skipping connection test."
elif ! command_exists curl; then
  warn "curl not found — skipping connection test."
else
  _HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 5 \
    -H "Authorization: Token ${_INFLUXDB_TOKEN}" \
    "${_INFLUXDB_URL}/api/v2/buckets?name=${_INFLUXDB_BUCKET}&org=${_INFLUXDB_ORG}" 2>/dev/null || echo "000")

  if [[ "$_HTTP_STATUS" == "200" ]]; then
    success "InfluxDB connection OK (HTTP 200) ✓"
    _INFLUX_OK=true
  elif [[ "$_HTTP_STATUS" == "000" ]]; then
    warn "Could not reach InfluxDB at ${_INFLUXDB_URL} (connection refused or timeout)."
    warn "Check that InfluxDB is running and INFLUXDB_URL is correct in .env"
  elif [[ "$_HTTP_STATUS" == "401" ]]; then
    warn "InfluxDB returned 401 Unauthorized — check your INFLUXDB_TOKEN in .env"
  elif [[ "$_HTTP_STATUS" == "404" ]]; then
    warn "InfluxDB returned 404 — check INFLUXDB_ORG and INFLUXDB_BUCKET in .env"
  else
    warn "InfluxDB returned unexpected HTTP ${_HTTP_STATUS} from ${_INFLUXDB_URL}"
  fi
fi

if [[ "$_INFLUX_OK" == "false" ]]; then
  echo ""
  if ! prompt_yesno "Continue setup anyway?" "y"; then
    echo ""
    info "Edit .env with correct InfluxDB credentials, then re-run: bash setup.sh"
    exit 1
  fi
fi
echo ""

# ── Step 8: Service installation ───────────────────────────────────────────────

echo -e "${BOLD}── Step 8: Install as a system service ────────────────────${RESET}"
echo "  This will start the server automatically on boot."
echo ""

if prompt_yesno "Install as a system service?" "n"; then
  echo ""
  SERVER_USER="${USER}"
  PROJECT_DIR="$SCRIPT_DIR"
  NODE_BIN=$(command -v node)

  # ── macOS: launchd ────────────────────────────────────────────────────────
  if [[ "$OS" == "macos" ]]; then
    PLIST_LABEL="com.marine-trmnl-server"
    PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
    LOG_DIR="$HOME/Library/Logs/marine-trmnl-server"
    mkdir -p "$LOG_DIR"

    cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${PROJECT_DIR}/src/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/server.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/server.err</string>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
</dict>
</plist>
EOF

    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    launchctl load -w "$PLIST_PATH"

    success "launchd service installed and started ✓"
    info "Logs: ${LOG_DIR}/server.log"
    info "To stop:    launchctl unload ${PLIST_PATH}"
    info "To start:   launchctl load -w ${PLIST_PATH}"
    info "To remove:  launchctl unload ${PLIST_PATH} && rm ${PLIST_PATH}"

  # ── Linux: systemd ────────────────────────────────────────────────────────
  else
    SERVICE_NAME="marine-trmnl-server"
    UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

    # Build EnvironmentFile path
    ENV_FILE="${PROJECT_DIR}/.env"

    sudo bash -c "cat > ${UNIT_FILE}" <<EOF
[Unit]
Description=Marine TRMNL BYOS Server
Documentation=https://github.com/usetrmnl
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVER_USER}
WorkingDirectory=${PROJECT_DIR}
ExecStart=${NODE_BIN} ${PROJECT_DIR}/src/server.js
EnvironmentFile=${ENV_FILE}
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable "$SERVICE_NAME"
    sudo systemctl start "$SERVICE_NAME"

    success "systemd service '${SERVICE_NAME}' installed and started ✓"
    info "To view logs:   journalctl -u ${SERVICE_NAME} -f"
    info "To stop:        sudo systemctl stop ${SERVICE_NAME}"
    info "To disable:     sudo systemctl disable ${SERVICE_NAME}"
    info "To remove:      sudo systemctl disable ${SERVICE_NAME} && sudo rm ${UNIT_FILE}"
  fi
else
  echo ""
  info "Skipping service installation."
  if [[ "$OS" == "macos" ]]; then
    info "To start manually:  npm start"
  else
    info "To start manually:  npm start"
    info "To run in background:  nohup node src/server.js &"
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  Setup complete!${RESET}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════${RESET}"
echo ""
echo -e "  Server:       ${CYAN}http://localhost:3001${RESET}"
echo -e "  BYOS display: ${CYAN}http://localhost:3001/api/display${RESET}"
echo -e "  Preview:      ${CYAN}http://localhost:3001/preview${RESET}"
echo ""
if [[ "${WRITE_ENV:-false}" == "true" ]] && [[ -z "${INFLUXDB_TOKEN:-}" ]]; then
  warn "INFLUXDB_TOKEN is not set. Edit .env and add your token, then restart."
fi
echo ""
