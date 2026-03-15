/**
 * screenshot.js — renders an HTML string to a PNG using a headless browser.
 *
 * Uses puppeteer-core pointed at the system Chromium install (no bundled binary).
 * On the Raspberry Pi:   sudo apt install chromium-browser
 * On macOS (dev):        Ensure Google Chrome is installed
 */

import puppeteer from 'puppeteer-core';
import { platform } from 'node:os';
import { existsSync } from 'node:fs';
import { byosConfig } from './config.js';

const WIDTH = 800;
const HEIGHT = 480;

/** Hard timeout (ms) for the entire screenshot operation */
const SCREENSHOT_TIMEOUT_MS = 30_000;

/**
 * Chromium launch flags tuned for Raspberry Pi 4 / headless Linux.
 *
 * --disable-dev-shm-usage   Critical on Pi — default 64MB /dev/shm causes crashes.
 * --window-size             Sets viewport via OS window rather than CDP
 *                           Emulation API, avoiding "Emulation.setTouchEmulationEnabled:
 *                           Session closed" errors on Pi's older Chromium.
 */
const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  `--window-size=${WIDTH},${HEIGHT}`,
];

function resolveChromiumPath() {
  // CHROMIUM_PATH env var takes highest priority — useful for local dev
  // without modifying config.yaml (set it in .env).
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

  const configured = byosConfig?.chromiumPath;
  if (configured && existsSync(configured)) return configured;

  // Auto-detect by OS as a final fallback.
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

  const browser = await puppeteer.launch({
    executablePath,
    args: CHROMIUM_ARGS,
    // 'shell' uses the classic --headless flag, better supported by the
    // Raspberry Pi's older Chromium build than the newer headless mode.
    headless: 'shell',
    // null disables Puppeteer's CDP-based viewport management entirely,
    // avoiding Emulation.setTouchEmulationEnabled calls that crash on Pi.
    defaultViewport: null,
    timeout: SCREENSHOT_TIMEOUT_MS,
  });

  try {
    const page = await browser.newPage();

    // Our dashboard is pure HTML + inline CSS + inline SVG — no JS needed.
    // Disabling JS speeds up rendering and avoids any accidental network calls.
    await page.setJavaScriptEnabled(false);

    await page.setContent(html, { waitUntil: 'load', timeout: SCREENSHOT_TIMEOUT_MS });

    await page.screenshot({
      path: outputPath,
      type: 'png',
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
      omitBackground: false,
    });
  } finally {
    await browser.close();
  }
}
