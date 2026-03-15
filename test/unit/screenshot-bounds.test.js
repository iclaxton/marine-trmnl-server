/**
 * screenshot-bounds.test.js
 *
 * Self-contained rendering test: generates a dashboard screenshot using
 * renderDashboard() with mock metric data, then verifies the layout fills the
 * full 800×480 canvas with no white bar at the bottom.
 *
 * Detection strategy: sample specific border pixels that MUST be non-white
 * in any theme when the layout is correct:
 *   - x=259, y=450 — right edge of wind panel (border-right: #D8D8D8 / #444)
 *   - x=530, y=450 — right edge of col-2 panels (same border)
 *   - x=0,   y=465 — footer background (#F4F4F4 light / #000 dark)
 *
 * Requires: Chrome/Chromium and ImageMagick in PATH (or CHROMIUM_PATH in env).
 *
 * Run standalone:
 *   node --test test/unit/screenshot-bounds.test.js
 */

import { test, describe, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderDashboard } from '../../src/renderer.js';

// ─── Mock metric data ─────────────────────────────────────────────────────────
// Enough real-looking values to ensure every panel renders with visible content
// (borders, numbers, labels) throughout its full height.

const MOCK_DATA = {
  _window: '12h',
  wind: {
    apparentSpeed: { stats: { min: 8.2, mean: 12.4, max: 18.1, last: 14.3 }, def: { decimals: 1 } },
    apparentAngle: { stats: { min: -42, mean: -35, max: -28, last: -37 } },
    trueSpeed:     { stats: { min: 6.1, mean: 10.2, max: 15.8, last: 11.9 } },
    trueAngle:     { stats: { min: 130, mean: 142,  max: 155,  last: 145  } },
  },
  navigation: {
    speedOverGround: { stats: { min: 3.1, mean: 5.4, max: 7.2, last: 5.8 }, def: { decimals: 1 } },
    courseOverGround:{ stats: { min: 190, mean: 205, max: 220, last: 210  } },
    headingMagnetic: { stats: { min: 195, mean: 208, max: 222, last: 212  } },
  },
  depth: {
    belowKeel: { stats: { min: 4.2, mean: 8.1, max: 18.4, last: 9.6 }, def: { decimals: 1 } },
  },
  electrical: {
    battery1Voltage: { stats: { min: 12.1, mean: 12.6, max: 13.1, last: 12.8 }, def: { decimals: 1 } },
    battery2Voltage: { stats: { min: 11.9, mean: 12.4, max: 12.9, last: 12.5 }, def: { decimals: 1 } },
  },
  environment: {
    insideTemperature:  { stats: { min: 18.1, mean: 20.4, max: 23.6, last: 21.0 }, def: { decimals: 1 } },
    outsideTemperature: { stats: { min: 14.2, mean: 16.1, max: 18.4, last: 16.8 }, def: { decimals: 1 } },
    outsidePressure: {
      stats:  { min: 1012, mean: 1015, max: 1018, last: 1016 },
      series: Array.from({ length: 24 }, (_, i) => ({ t: Date.now() - (23 - i) * 1800000, v: 1012 + i * 0.25 })),
    },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROOT = new URL('../../', import.meta.url).pathname;

/** Resolve Chrome/Chromium executable (same logic as screenshot.js). */
function resolveChrome() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for (const p of [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser 3.app/Contents/MacOS/Brave Browser',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Sample the RGB hex color of a single pixel in a PNG.
 *
 * @param {string} pngPath
 * @param {number} x
 * @param {number} y
 * @returns {string}  e.g. '#D8D8D8'
 */
function pixelColor(pngPath, x, y) {
  const r = spawnSync('magick', [
    pngPath,
    '-crop', `1x1+${x}+${y}`,
    '+repage',
    'txt:-',
  ], { encoding: 'utf8' });
  const match = r.stdout.match(/#([0-9A-Fa-f]{6})/);
  return match ? `#${match[1].toUpperCase()}` : '#??????';
}

/**
 * Find the last row (from bottom) that contains any pixel darker than white
 * by scanning every 4px from bottom to top.
 *
 * @param {string} pngPath
 * @param {number} canvasH
 * @returns {number}  y-coordinate of the last non-white row, or -1 if all white
 */
function lastNonWhiteRow(pngPath, canvasH) {
  for (let y = canvasH - 1; y >= 0; y -= 1) {
    const r = spawnSync('magick', [
      pngPath,
      '-crop', `800x1+0+${y}`,
      '+repage',
      '-threshold', '98%',      // binarise: near-white → white, anything darker → black
      '-negate',                 // flip so "has content" pixels become white
      '-format', '%[fx:mean]',
      'info:',
    ], { encoding: 'utf8' });
    const mean = parseFloat(r.stdout.trim());
    if (mean > 0) return y;
  }
  return -1;
}

// ─────────────────────────────────────────────────────────────────────────────

// Resolve Chrome path at module load time so { skip: !chrome } works correctly
const chrome = resolveChrome();

describe('screenshot layout bounds', () => {
  let tmpDir, htmlFile, pngFile;

  before(() => {
    tmpDir  = mkdtempSync(join(tmpdir(), 'trmnl-bounds-'));
    htmlFile = join(tmpDir, 'dashboard.html');
    pngFile  = join(tmpDir, 'dashboard.png');

    // Render HTML — bitDepth:1 ensures non-white footer background (#F4F4F4)
    const html = renderDashboard(MOCK_DATA, { bitDepth: 1 });
    writeFileSync(htmlFile, html, 'utf8');

    if (!chrome) return; // screenshot tests will skip

    // Take screenshot with extra height to avoid macOS viewport reduction
    const result = spawnSync(chrome, [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--window-size=800,680',        // +200px padding for macOS Chrome virtual chrome (~88px)
      `--screenshot=${pngFile}`,
      `file://${htmlFile}`,
    ], { timeout: 30_000, encoding: 'utf8' });

    if (result.error) throw result.error;

    // Crop to exact 800×480 display dimensions
    spawnSync('magick', [pngFile, '-crop', '800x480+0+0', '+repage', pngFile]);

    // Save a copy as the diagnostic file for manual inspection
    spawnSync('cp', [pngFile, join(ROOT, 'screens', 'dashboard-bounds.png')]);
  });

  after(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  test('Chrome/Chromium is available', () => {
    assert.ok(chrome, 'No Chrome/Chromium found. Set CHROMIUM_PATH in .env');
  });

  test('screenshot dimensions are 800×480', { skip: !chrome }, () => {
    const r = spawnSync('magick', ['identify', pngFile], { encoding: 'utf8' });
    assert.match(r.stdout, /800x480/, `Expected 800x480, got: ${r.stdout.trim()}`);
  });

  // ── Key pixel checks ──────────────────────────────────────────────────────
  // These pixels are structurally non-white in BOTH light and dark themes:
  //   • Panel right borders are #D8D8D8 (light) or #444444 (dark)
  //   • Footer background is #F4F4F4 (light, bitDepth=1) or #000000 (dark)

  test('wind panel right border visible at y=250 (mid-height)', { skip: !chrome }, () => {
    // x=259 is the 1px right border of the wind panel column
    const color = pixelColor(pngFile, 259, 250);
    assert.notStrictEqual(color, '#FFFFFF',
      `Wind panel right border at (259,250) is white — panel content not rendering mid-height`);
  });

  test('wind panel right border visible at y=430 (near bottom)', { skip: !chrome }, () => {
    const color = pixelColor(pngFile, 259, 430);
    assert.notStrictEqual(color, '#FFFFFF',
      `Wind panel right border at (259,430) is white — layout is clipped ~${480 - 430}px from bottom`);
  });

  test('column separator borders visible at y=450 (grid reaches bottom)', { skip: !chrome }, () => {
    // Panel borders at column boundaries are gray in both themes, not white.
    // x=259 = right border of wind panel (col1/col2 boundary)
    // x=529 = right border of nav/depth panel (col2/col3 boundary)
    const c1 = pixelColor(pngFile, 259, 450);  // col1/col2 border
    const c2 = pixelColor(pngFile, 529, 450);  // col2/col3 border
    assert.ok(
      c1 !== '#FFFFFF' || c2 !== '#FFFFFF',
      `Column separator borders are both white at y=450 — grid is not rendering to this depth. c1=${c1} c2=${c2}`
    );
  });

  test('footer band renders at y=465 (not white)', { skip: !chrome }, () => {
    // Footer has background:#F4F4F4 in light bitDepth=1 — distinctly not white
    const color = pixelColor(pngFile, 400, 465);
    assert.notStrictEqual(color, '#FFFFFF',
      `Footer at (400,465) is white — footer not rendering or layout is clipped above footer`);
  });

  // ── Height scan ───────────────────────────────────────────────────────────

  test('last non-white row is within 5px of bottom (no white bar)', { skip: !chrome }, () => {
    const lastRow = lastNonWhiteRow(pngFile, 480);
    const whiteBar = 480 - 1 - lastRow;

    console.log('');
    console.log(`  Last non-white row: y=${lastRow}  →  white bar at bottom: ${whiteBar}px`);
    console.log(`  Diagnostic image saved → screens/dashboard-bounds.png`);
    console.log('');

    assert.ok(whiteBar <= 5,
      `White bar is ${whiteBar}px tall (last non-white row y=${lastRow}). Expected ≤5px.`);
  });
});
