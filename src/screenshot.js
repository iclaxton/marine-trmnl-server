/**
 * screenshot.js — renders an HTML string to a PNG using a headless browser.
 *
 * Uses Chromium's built-in --screenshot CLI flag rather than Puppeteer's CDP
 * API. This avoids all Emulation/Runtime CDP calls that crash Raspberry Pi
 * Chromium 126 on Debian 11.
 *
 * On the Raspberry Pi:   sudo apt install chromium-browser
 * On macOS (dev):        Ensure Google Chrome or Brave is installed
 */

import { spawnSync } from 'node:child_process';
import { platform, tmpdir } from 'node:os';
import { existsSync, writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { byosConfig } from './config.js';

const WIDTH = 800;
const HEIGHT = 480;

/** Hard timeout (ms) for the entire screenshot operation */
const SCREENSHOT_TIMEOUT_MS = 30_000;

function resolveChromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

  const configured = byosConfig?.chromiumPath;
  if (configured && existsSync(configured)) return configured;

  // On Pi Bookworm the binary is 'chromium'; older Pi OS uses 'chromium-browser'.
  if (platform() === 'linux') {
    for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser']) {
      if (existsSync(p)) return p;
    }
  }
  if (platform() === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }

  throw new Error(
    'Cannot auto-detect Chromium. Set CHROMIUM_PATH in .env or byos.chromiumPath in config.yaml'
  );
}

/**
 * Render an HTML string to a PNG file at outputPath.
 *
 * @param {string} html          — Full HTML document string
 * @param {string} outputPath    — Absolute path to write the PNG
 * @returns {Promise<void>}
 */
export async function screenshotHtml(html, outputPath) {
  const executablePath = resolveChromiumPath();

  // Write HTML to a temp file — Chromium CLI requires a file:// URL.
  const tmpDir = mkdtempSync(join(tmpdir(), 'trmnl-'));
  const tmpFile = join(tmpDir, 'dashboard.html');

  try {
    writeFileSync(tmpFile, html, 'utf8');

    // Use Chromium's --screenshot flag — no Puppeteer CDP session at all.
    // --screenshot=PATH writes directly to the given path.
    const result = spawnSync(executablePath, [
      '--headless',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      `--window-size=${WIDTH},${HEIGHT}`,
      `--screenshot=${outputPath}`,
      `file://${tmpFile}`,
    ], {
      timeout: SCREENSHOT_TIMEOUT_MS,
      encoding: 'utf8',
    });

    if (result.error) {
      throw new Error(`Chromium failed to launch: ${result.error.message}`);
    }
    if (result.status !== 0) {
      const detail = (result.stderr || '').slice(-500) || 'unknown error';
      throw new Error(`Chromium exited with code ${result.status}: ${detail}`);
    }
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
    try { rmdirSync(tmpDir); } catch { /* ignore */ }
  }
}
