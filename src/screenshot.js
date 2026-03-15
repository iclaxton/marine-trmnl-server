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

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { platform, tmpdir } from 'node:os';
import { existsSync, writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { byosConfig } from './config.js';

const execFileAsync = promisify(execFile);

const WIDTH  = 800;
const HEIGHT = 480;

/**
 * Extra vertical pixels added to --window-size to compensate for Chrome's
 * virtual browser chrome on macOS (URL bar, toolbar — ~88px). The screenshot
 * is always cropped back to WIDTH×HEIGHT afterwards, so the extra space is
 * invisible to callers. On Linux there is no overhead but the extra pixels
 * are harmless.
 */
const WINDOW_HEIGHT_PADDING = 200;

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
    for (const p of [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser 3.app/Contents/MacOS/Brave Browser',
    ]) {
      if (existsSync(p)) return p;
    }
  }

  throw new Error(
    'Cannot auto-detect Chromium. Set CHROMIUM_PATH in .env or byos.chromiumPath in config.yaml'
  );
}

/**
 * Render an HTML string to a PNG file at outputPath.
 *
 * All subprocess calls are async (execFileAsync) so the Node.js event loop
 * remains unblocked while Chromium and ImageMagick are running.
 *
 * @param {string} html          — Full HTML document string
 * @param {string} outputPath    — Absolute path to write the PNG
 * @returns {Promise<void>}
 */
export async function screenshotHtml(html, outputPath) {
  const executablePath = resolveChromiumPath();

  // Write HTML to a temp file — Chromium CLI requires a file:// URL.
  const tmpDir  = mkdtempSync(join(tmpdir(), 'trmnl-'));
  const tmpFile = join(tmpDir, 'dashboard.html');

  try {
    writeFileSync(tmpFile, html, 'utf8');

    // Use Chromium's --screenshot flag — no Puppeteer CDP session at all.
    // Window height is padded to account for Chrome's virtual browser chrome
    // on macOS (~88px overhead). The PNG is cropped to WIDTH×HEIGHT afterwards.
    try {
      await execFileAsync(executablePath, [
        '--headless',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--disable-extensions',
        '--disable-sync',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-translate',
        '--disable-client-side-phishing-detection',
        '--disable-component-update',
        '--mute-audio',
        '--force-device-scale-factor=1',
        '--hide-scrollbars',
        `--window-size=${WIDTH},${HEIGHT + WINDOW_HEIGHT_PADDING}`,
        `--screenshot=${outputPath}`,
        `file://${tmpFile}`,
      ], { timeout: SCREENSHOT_TIMEOUT_MS });
    } catch (err) {
      // execFile rejects with the stderr in err.stderr
      const detail = (err.stderr || err.message || 'unknown error').slice(-500);
      throw new Error(`Chromium screenshot failed: ${detail}`);
    }

    // Crop the screenshot back to the exact display dimensions. Failures here
    // are non-fatal — the uncropped PNG is still usable (just taller).
    const cropArgs = [
      outputPath,
      '-crop', `${WIDTH}x${HEIGHT}+0+0`,
      '+repage',
      outputPath,
    ];
    try {
      await execFileAsync('magick', cropArgs);
    } catch {
      try {
        await execFileAsync('convert', cropArgs);
      } catch { /* ignore — uncropped PNG is usable */ }
    }
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
    try { rmdirSync(tmpDir); } catch { /* ignore */ }
  }
}


