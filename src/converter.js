/**
 * converter.js — converts a PNG to a TRMNL-compatible BMP3 image.
 *
 * Uses ImageMagick (system install):
 *   Raspberry Pi / Debian:  sudo apt install imagemagick
 *   macOS:                  brew install imagemagick
 *
 * Required output spec (from TRMNL docs):
 *   BMP3 format, 800×480, 1-bit monochrome, stripped metadata
 *   magick input.png -monochrome -colors 2 -depth 1 -strip bmp3:output.bmp
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Detect whether `magick` (IM 7) or `convert` (IM 6) is available.
 * Result is cached after first successful detection.
 * @type {string|null}
 */
let _imageMagickCmd = null;

async function resolveImageMagickCommand() {
  if (_imageMagickCmd) return _imageMagickCmd;

  for (const cmd of ['magick', 'convert']) {
    try {
      await execFileAsync(cmd, ['--version']);
      _imageMagickCmd = cmd;
      return cmd;
    } catch {
      // not found, try next
    }
  }

  throw new Error(
    'ImageMagick not found.\n' +
    '  Raspberry Pi:  sudo apt install imagemagick\n' +
    '  macOS:         brew install imagemagick'
  );
}

/**
 * Convert a PNG file to a TRMNL-compatible BMP3 (1-bit monochrome).
 *
 * @param {string} inputPng   — Absolute path to the source PNG
 * @param {string} outputBmp  — Absolute path to write the BMP
 * @returns {Promise<void>}
 */
export async function pngToBmp3(inputPng, outputBmp) {
  const cmd = await resolveImageMagickCommand();

  const args = [
    inputPng,
    '-monochrome',    // Convert to true 1-bit B&W
    '-colors', '2',   // Enforce exactly 2 colours
    '-depth', '1',    // 1 bit per pixel
    '-strip',         // Remove EXIF/metadata (reduces file size)
    `bmp3:${outputBmp}`,  // Force BMP version 3 (what TRMNL expects)
  ];

  try {
    await execFileAsync(cmd, args);
  } catch (err) {
    throw new Error(`ImageMagick conversion failed: ${err.message}`);
  }
}

/**
 * Verify ImageMagick is installed and accessible.
 * Call this at startup to give a clear error message early.
 * @returns {Promise<string>} — the command name ('magick' or 'convert')
 */
export async function checkImageMagick() {
  return resolveImageMagickCommand();
}

// ─── Bit-depth helpers ────────────────────────────────────────────────────────

/**
 * Return the file extension for a display-ready image at the given bit depth.
 * @param {number} bitDepth — 1 or 2
 * @returns {string} — '.bmp' (1-bit) or '.png' (2-bit)
 */
export function displayExtension(bitDepth) {
  return bitDepth >= 2 ? '.png' : '.bmp';
}

/**
 * Convert a full-colour Puppeteer PNG screenshot to the display-ready format
 * appropriate for the device's bit depth.
 *
 *   bitDepth 1 → BMP3, 1-bit monochrome  (TRMNL Standard / Developer)
 *   bitDepth 2 → PNG, 2-bit 4-level grayscale  (TRMNL OG 2-bit)
 *
 * @param {string} inputPng   — Absolute path to the source full-colour PNG
 * @param {string} outputPath — Absolute path to write the display image
 * @param {number} [bitDepth=1]
 * @returns {Promise<void>}
 */
export async function toDisplayImage(inputPng, outputPath, bitDepth = 1) {
  if (bitDepth >= 2) {
    return pngTo2BitGrayscale(inputPng, outputPath);
  }
  return pngToBmp3(inputPng, outputPath);
}

/**
 * Convert a PNG to a 2-bit (4-level) grayscale PNG for TRMNL OG 2-bit displays.
 *
 * Uses Floyd-Steinberg error-diffusion dithering to distribute quantisation
 * error across the 4 display levels (black, dark-grey, light-grey, white).
 *
 * @param {string} inputPng  — source PNG
 * @param {string} outputPng — destination PNG
 * @returns {Promise<void>}
 */
async function pngTo2BitGrayscale(inputPng, outputPng) {
  const cmd = await resolveImageMagickCommand();

  const args = [
    inputPng,
    '-colorspace', 'Gray',       // Convert to luminance grayscale
    '-dither', 'FloydSteinberg', // Error-diffusion dither for best 4-level quality
    '-colors', '4',              // Exactly 4 levels: black, dark-grey, light-grey, white
    '-depth', '2',               // 2 bits per pixel in the output file
    outputPng,
  ];

  try {
    await execFileAsync(cmd, args);
  } catch (err) {
    throw new Error(`ImageMagick 2-bit grayscale conversion failed: ${err.message}`);
  }
}
