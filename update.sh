#!/usr/bin/env bash
# update.sh — pull latest changes from git and restart the server service.
#
# Usage:
#   bash update.sh
#
# Works whether the server is running as a systemd service (Linux/Pi) or
# was started manually. On macOS (dev) it just pulls without restarting.

set -euo pipefail

BOLD="\033[1m"; GREEN="\033[0;32m"; CYAN="\033[0;36m"; YELLOW="\033[1;33m"; RESET="\033[0m"

info()    { echo -e "${CYAN}  ℹ ${*}${RESET}"; }
success() { echo -e "${GREEN}  ✓ ${*}${RESET}"; }
warn()    { echo -e "${YELLOW}  ⚠ ${*}${RESET}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="marine-trmnl-server"

echo ""
echo -e "${BOLD}── Marine TRMNL Server — Update ────────────────────────────${RESET}"
echo ""

# ── 1. Pull latest changes ─────────────────────────────────────────────────
info "Pulling latest changes…"
cd "$SCRIPT_DIR"
git pull
success "git pull complete"

# ── 2. Install/update dependencies ────────────────────────────────────────
info "Checking npm dependencies…"
npm install --omit=dev --silent
success "npm install complete"

# ── 3. Restart service ────────────────────────────────────────────────────
echo ""
if [[ "$(uname -s)" == "Linux" ]]; then
  if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    info "Restarting systemd service '${SERVICE_NAME}'…"
    sudo systemctl restart "$SERVICE_NAME"
    success "Service restarted ✓"
    echo ""
    info "Recent logs (Ctrl+C to exit):"
    echo ""
    journalctl -u "$SERVICE_NAME" -n 20 --no-pager
    echo ""
    info "Live logs: journalctl -u ${SERVICE_NAME} -f"
  elif systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
    info "Service '${SERVICE_NAME}' is installed but not running — starting…"
    sudo systemctl start "$SERVICE_NAME"
    success "Service started ✓"
  else
    warn "No systemd service named '${SERVICE_NAME}' found."
    warn "If you started the server manually, restart it with: node src/server.js"
    warn "To install as a service, run: bash setup.sh"
  fi
else
  warn "macOS detected — no automatic service restart."
  warn "If the server is running, restart it manually: node src/server.js"
fi

echo ""
