/**
 * screenshot.js — renders an HTML string to a PNG using a headless browser.
 *
 * Uses puppeteer-core pointed at the system Chromium install (no bundled binary).
 * On the Raspberry Pi:   sudo apt install chromium-browser
 * On macOS (dev):        Ensure Google Chrome is installed
 */

import puppeteer from 'puppeteer-core';
import { platform } from 'node:os';
import { byosConfig } from './config.js';

const VIEWPORT = { width: 800, height: 480, deviceScaleFactor: 1 };

/** Hard timeout (ms) for the entire screenshot operation */
const SCREENSHOT_TIMEOUT_MS = 30_000;

/**
 * Chromium launch flags tuned for Raspberry Pi 4 / headless Linux.
 * --disable-dev-shm-usage is critical on Pi — the default 64MB /dev/shm
 * causes Chromium to crash when rendering anything substantial.
 * --run-all-compositor-stages-before-draw is intentionally omitted — it is
 * not supported by Raspberry Pi's older Chromium builds and causes an
 * immediate crash ("Target closed").
 */
const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
];

function resolveChromiumPath() {
  // CHROMIUM_PATH env var takes highest priority — useful for local dev
  // without modifying config.yaml (set it in .env).
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

  const configured = byosConfig?.chromiumPath;
  if (configured) return configured;

  // Auto-detect by OS as a final fallback
  if (platform() === 'linux')  return '/usr/bin/chromium-browser';
  if (platform() === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

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
    timeout: SCREENSHOT_TIMEOUT_MS,
  });

  try {
    const page = await browser.newPage();

    await page.setViewport(VIEWPORT);

    // Our dashboard is pure HTML + inline CSS + inline SVG — no JS needed.
    // Disabling JS speeds up rendering and avoids any accidental network calls.
    await page.setJavaScriptEnabled(false);

    // Load the HTML string directly (no temp file needed).
    // 'networkidle0' would wait for network, 'load' fires when DOM is ready.
    await page.setContent(html, { waitUntil: 'load', timeout: SCREENSHOT_TIMEOUT_MS });

    await page.screenshot({
      path: outputPath,
      type: 'png',
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
      omitBackground: false,
    });
  } finally {
    await browser.close();
  }
}
