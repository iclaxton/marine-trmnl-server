/**
 * Unit tests — src/utils.js
 * Run with: node --test test/unit/utils.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  converters,
  applyConversion,
  formatValue,
  bearingLabel,
  windSide,
  normaliseWindAngle,
  secondsToFluxDuration,
} from '../../src/utils.js';

// ─── converters ───────────────────────────────────────────────────────────────

describe('converters.mps_to_kts', () => {
  test('1 m/s ≈ 1.94384 kts', () => {
    assert.ok(Math.abs(converters.mps_to_kts(1) - 1.94384) < 0.00001);
  });
  test('0 m/s = 0 kts', () => {
    assert.equal(converters.mps_to_kts(0), 0);
  });
  test('ms_to_kts alias is identical', () => {
    assert.equal(converters.ms_to_kts(1), converters.mps_to_kts(1));
  });
});

describe('converters.rad_to_deg', () => {
  test('0 rad = 0°', () => {
    assert.equal(converters.rad_to_deg(0), 0);
  });
  test('π rad = 180°', () => {
    assert.ok(Math.abs(converters.rad_to_deg(Math.PI) - 180) < 0.001);
  });
  test('2π rad wraps to 0° (within tolerance)', () => {
    assert.ok(converters.rad_to_deg(2 * Math.PI) < 0.001);
  });
  test('π/2 rad = 90°', () => {
    assert.ok(Math.abs(converters.rad_to_deg(Math.PI / 2) - 90) < 0.001);
  });
  test('negative angle wraps to positive', () => {
    // -π/2 should give 270° (or equivalent positive value)
    const deg = converters.rad_to_deg(-Math.PI / 2);
    assert.ok(deg >= 0 && deg < 360, `Expected 0–360 but got ${deg}`);
  });
});

describe('converters.kelvin_to_c', () => {
  test('273.15 K = 0°C', () => {
    assert.ok(Math.abs(converters.kelvin_to_c(273.15)) < 0.001);
  });
  test('373.15 K = 100°C', () => {
    assert.ok(Math.abs(converters.kelvin_to_c(373.15) - 100) < 0.001);
  });
});

describe('converters.kelvin_to_f', () => {
  test('273.15 K = 32°F (freezing)', () => {
    assert.ok(Math.abs(converters.kelvin_to_f(273.15) - 32) < 0.001);
  });
  test('373.15 K = 212°F (boiling)', () => {
    assert.ok(Math.abs(converters.kelvin_to_f(373.15) - 212) < 0.001);
  });
});

describe('converters.pa_to_hpa', () => {
  test('standard atmosphere 101325 Pa = 1013.25 hPa', () => {
    assert.ok(Math.abs(converters.pa_to_hpa(101325) - 1013.25) < 0.001);
  });
  test('100000 Pa = 1000 hPa', () => {
    assert.strictEqual(converters.pa_to_hpa(100000), 1000);
  });
  test('0 Pa = 0 hPa', () => {
    assert.strictEqual(converters.pa_to_hpa(0), 0);
  });
});

// ─── applyConversion ──────────────────────────────────────────────────────────

describe('applyConversion', () => {
  test('applies a known conversion', () => {
    const result = applyConversion(1, 'mps_to_kts');
    assert.ok(Math.abs(result - 1.94384) < 0.00001);
  });
  test('returns value unchanged when no conversion specified', () => {
    assert.equal(applyConversion(42, undefined), 42);
  });
  test('returns null for null input regardless of conversion', () => {
    assert.equal(applyConversion(null, 'mps_to_kts'), null);
  });
  test('returns null for undefined input', () => {
    assert.equal(applyConversion(undefined, 'mps_to_kts'), null);
  });
  test('returns raw value and does not throw for unknown conversion', () => {
    // should warn to console but not throw
    assert.equal(applyConversion(5, 'totally_unknown'), 5);
  });
  test('applies kelvin_to_c correctly', () => {
    assert.ok(Math.abs(applyConversion(273.15, 'kelvin_to_c')) < 0.001);
  });
});

// ─── formatValue ──────────────────────────────────────────────────────────────

describe('formatValue', () => {
  test('formats with 1 decimal by default', () => {
    assert.equal(formatValue(12.3456), '12.3');
  });
  test('rounds to 2 decimals when specified', () => {
    assert.equal(formatValue(12.346, 2), '12.35');
  });
  test('rounds to 0 decimals', () => {
    assert.equal(formatValue(12.6, 0), '13');
  });
  test('returns em dash for null', () => {
    assert.equal(formatValue(null), '—');
  });
  test('returns em dash for undefined', () => {
    assert.equal(formatValue(undefined), '—');
  });
  test('returns em dash for NaN', () => {
    assert.equal(formatValue(NaN), '—');
  });
  test('handles 0 correctly', () => {
    assert.equal(formatValue(0, 1), '0.0');
  });
  test('handles negative values', () => {
    assert.equal(formatValue(-5.5, 1), '-5.5');
  });
});

// ─── bearingLabel ─────────────────────────────────────────────────────────────

describe('bearingLabel', () => {
  const cases = [
    [0,   'N'],
    [45,  'NE'],
    [90,  'E'],
    [135, 'SE'],
    [180, 'S'],
    [225, 'SW'],
    [270, 'W'],
    [315, 'NW'],
    [360, 'N'],   // wraps
    [22.5, 'NNE'],
    [67.5, 'ENE'],
  ];
  for (const [deg, expected] of cases) {
    test(`${deg}° = ${expected}`, () => {
      assert.equal(bearingLabel(deg), expected);
    });
  }
  test('returns em dash for null', () => {
    assert.equal(bearingLabel(null), '—');
  });
  test('returns em dash for undefined', () => {
    assert.equal(bearingLabel(undefined), '—');
  });
  test('wraps angles > 360', () => {
    assert.equal(bearingLabel(450), bearingLabel(90)); // 450 % 360 = 90 = E
  });
});

// ─── windSide ─────────────────────────────────────────────────────────────────

describe('windSide', () => {
  test('returns STBD for angle 45°', () => {
    assert.equal(windSide(45), 'STBD');
  });
  test('returns PORT for angle 270°', () => {
    assert.equal(windSide(270), 'PORT');
  });
  test('returns empty string for null', () => {
    assert.equal(windSide(null), '');
  });
  test('returns STBD for angle 180° exactly', () => {
    // 180 → ((180 % 360) + 360) % 360 = 180, not > 180 → STBD
    assert.equal(windSide(180), 'STBD');
  });
  test('returns PORT for angle 181°', () => {
    assert.equal(windSide(181), 'PORT');
  });
});

// ─── normaliseWindAngle ───────────────────────────────────────────────────────

describe('normaliseWindAngle', () => {
  test('starboard: angle 45° → { angle: 45, side: STBD }', () => {
    const r = normaliseWindAngle(45);
    assert.equal(r.side, 'STBD');
    assert.equal(r.angle, 45);
  });
  test('port: angle 270° → { angle: 90, side: PORT }', () => {
    const r = normaliseWindAngle(270);
    assert.equal(r.side, 'PORT');
    assert.equal(r.angle, 90); // 360 - 270
  });
  test('null input → { angle: null, side: "" }', () => {
    const r = normaliseWindAngle(null);
    assert.equal(r.angle, null);
    assert.equal(r.side, '');
  });
  test('undefined input → { angle: null, side: "" }', () => {
    const r = normaliseWindAngle(undefined);
    assert.equal(r.angle, null);
    assert.equal(r.side, '');
  });
  test('angle 0° → { angle: 0, side: STBD }', () => {
    const r = normaliseWindAngle(0);
    assert.equal(r.angle, 0);
    assert.equal(r.side, 'STBD');
  });
  test('angle 180° → { angle: 180, side: STBD }', () => {
    const r = normaliseWindAngle(180);
    assert.equal(r.angle, 180);
    assert.equal(r.side, 'STBD');
  });
  test('angle 360° wraps to 0 STBD', () => {
    const r = normaliseWindAngle(360);
    assert.equal(r.angle, 0);
    assert.equal(r.side, 'STBD');
  });
  test('negative angle (e.g. -45°) normalises correctly', () => {
    // -45 → ((−45 % 360) + 360) % 360 = 315 → PORT (315 > 180)
    const r = normaliseWindAngle(-45);
    assert.equal(r.side, 'PORT');
    assert.equal(r.angle, 45); // 360 - 315
  });
});

// ─── secondsToFluxDuration ───────────────────────────────────────────────────

describe('secondsToFluxDuration', () => {
  test('30s → "30s" (below 1 min)', () => {
    assert.equal(secondsToFluxDuration(30), '30s');
  });
  test('60s → "1m"', () => {
    assert.equal(secondsToFluxDuration(60), '1m');
  });
  test('120s → "2m"', () => {
    assert.equal(secondsToFluxDuration(120), '2m');
  });
  test('900s → "15m"', () => {
    assert.equal(secondsToFluxDuration(900), '15m');
  });
  test('3600s → "1h"', () => {
    assert.equal(secondsToFluxDuration(3600), '1h');
  });
  test('7200s → "2h"', () => {
    assert.equal(secondsToFluxDuration(7200), '2h');
  });
  test('90s (non-clean-minute multiple) → "90s"', () => {
    // 90 % 60 = 30 ≠ 0, so stays as seconds
    assert.equal(secondsToFluxDuration(90), '90s');
  });
  test('3660s (not clean hours) → "61m"', () => {
    // 3660 % 3600 ≠ 0 but 3660 % 60 = 0 → minutes
    assert.equal(secondsToFluxDuration(3660), '61m');
  });
});
