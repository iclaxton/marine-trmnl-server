/**
 * Unit conversion helpers for SignalK SI values.
 * SignalK stores everything in SI: m/s, radians, Kelvin, metres.
 */

export const converters = {
  /** metres/second → knots */
  mps_to_kts: (v) => v * 1.94384,
  /** alias */
  ms_to_kts: (v) => v * 1.94384,
  /** metres/second → km/h */
  mps_to_kmh: (v) => v * 3.6,
  /** radians → degrees (0–360) */
  rad_to_deg: (v) => {
    const deg = (v * 180) / Math.PI;
    return ((deg % 360) + 360) % 360;
  },
  /** Kelvin → Celsius */
  kelvin_to_c: (v) => v - 273.15,
  /** Kelvin → Fahrenheit */
  kelvin_to_f: (v) => ((v - 273.15) * 9) / 5 + 32,
  /** Pascals → hectopascals (mbar) — SignalK stores barometric pressure in Pa */
  pa_to_hpa: (v) => v / 100,
};

/**
 * Apply a named conversion to a value.
 * If no conversion is specified, returns the value unchanged.
 * @param {number|null} value
 * @param {string|undefined} conversionName
 * @returns {number|null}
 */
export function applyConversion(value, conversionName) {
  if (value === null || value === undefined) return null;
  if (!conversionName) return value;
  const fn = converters[conversionName];
  if (!fn) {
    console.warn(`Unknown conversion: "${conversionName}" — returning raw value`);
    return value;
  }
  return fn(value);
}

/**
 * Format a number for display.
 * @param {number|null} value
 * @param {number} decimals
 * @param {string} unit
 * @returns {string}
 */
export function formatValue(value, decimals = 1, unit = '') {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return `${value.toFixed(decimals)}${unit}`;
}

/**
 * Compass bearing label from degrees (N, NNE, NE, …)
 * @param {number|null} deg
 * @returns {string}
 */
export function bearingLabel(deg) {
  if (deg === null || deg === undefined) return '—';
  const labels = ['N','NNE','NE','ENE','E','ESE','SE','SSE',
                  'S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return labels[idx];
}

/**
 * Wind angle side label: PORT / STBD
 * @param {number|null} deg — apparent or true wind angle (-180 to 180 or 0 to 360)
 * @returns {string}
 */
export function windSide(deg) {
  if (deg === null || deg === undefined) return '';
  const a = ((deg % 360) + 360) % 360;
  return a > 180 ? 'PORT' : 'STBD';
}

/**
 * Normalise a wind angle to 0–180 with a side label.
 * @param {number|null} deg
 * @returns {{ angle: number|null, side: string }}
 */
export function normaliseWindAngle(deg) {
  if (deg === null || deg === undefined) return { angle: null, side: '' };
  const a = ((deg % 360) + 360) % 360;
  if (a > 180) {
    return { angle: 360 - a, side: 'PORT' };
  }
  return { angle: a, side: 'STBD' };
}

/**
 * Build a duration string for Flux queries from seconds.
 * e.g. 900 → "15m", 3600 → "1h"
 * @param {number} seconds
 * @returns {string}
 */
export function secondsToFluxDuration(seconds) {
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds >= 60   && seconds % 60   === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}
