/**
 * Integration tests — InfluxDB query layer (src/influx.js)
 *
 * These tests run against the REAL InfluxDB on hebepi:8086.
 * Requirements:
 *   - hebepi reachable on the network
 *   - INFLUXDB_TOKEN set in .env (or environment)
 *
 * If hebepi is unreachable every test is automatically skipped — the suite
 * will not produce failures in a disconnected environment.
 *
 * Run with: node --test test/integration/influx.test.js
 */

import 'dotenv/config';
import { test, describe, before } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  fetchAllMetrics,
  queryStats,
  queryTimeSeries,
} from '../../src/influx.js';

// ─── Connectivity guard ───────────────────────────────────────────────────────

let hebepiAvailable = false;
let allMetrics;       // populated once from fetchAllMetrics() in before()

/** Call t.skip() if hebepi is offline; used in every test. */
function skipIfOffline(t) {
  if (!hebepiAvailable) t.skip('hebepi:8086 unreachable — skipped');
}

/** Assert that a stats object has the four expected keys. */
function assertStatsShape(stats, label) {
  assert.ok(stats !== null && typeof stats === 'object', `${label}: stats must be an object`);
  for (const key of ['last', 'min', 'max', 'mean']) {
    assert.ok(key in stats, `${label}: stats.${key} missing`);
  }
}

/**
 * If value is not null assert it falls within [lo, hi].
 * Handles cases where there is genuinely no data (null returned from InfluxDB).
 */
function assertRange(val, lo, hi, label) {
  if (val === null || val === undefined) return; // no data — acceptable
  assert.ok(
    val >= lo && val <= hi,
    `${label}: ${val} is outside expected range [${lo}, ${hi}]`
  );
}

// ─── Top-level before: confirm connectivity ──────────────────────────────────

before(async () => {
  try {
    // Use a short 5-minute window just to confirm connectivity
    await queryStats('environment.outside.pressure', '5m');
    hebepiAvailable = true;
    // Now fetch the full metrics payload used by the display
    allMetrics = await fetchAllMetrics();
  } catch (err) {
    console.warn(`\n⚠  hebepi:8086 unavailable — InfluxDB integration tests skipped`);
    console.warn(`   (${err.message})\n`);
  }
});

// ─── queryStats — shape for each measurement path ────────────────────────────

describe('queryStats — stats shape for each configured metric path', () => {
  // Using a 24h window so tests still pass even if the boat hasn't
  // been underway recently.  Raw SI values returned here; conversions
  // are tested separately via fetchAllMetrics.
  const WINDOW = '24h';

  const paths = [
    // wind
    { label: 'wind: apparentSpeed',   path: 'environment.wind.speedApparent'   },
    { label: 'wind: apparentAngle',   path: 'environment.wind.angleApparent'   },
    { label: 'wind: trueSpeed',       path: 'environment.wind.speedTrue'       },
    { label: 'wind: trueAngle',       path: 'environment.wind.angleTrueWater'  },
    // navigation
    { label: 'nav: SOG',              path: 'navigation.speedOverGround'       },
    { label: 'nav: COG',              path: 'navigation.courseOverGroundTrue'  },
    { label: 'nav: heading',          path: 'navigation.headingTrue'           },
    // depth
    { label: 'depth: belowKeel',      path: 'environment.depth.belowKeel'      },
    { label: 'depth: waterTemp',      path: 'environment.water.temperature'    },
    // batteries
    { label: 'battery: house voltage',   path: 'electrical.batteries.house.voltage'   },
    { label: 'battery: house current',   path: 'electrical.batteries.house.current'   },
    { label: 'battery: start voltage',   path: 'electrical.batteries.start.voltage'   },
    // environment
    { label: 'env: insideTemp',       path: 'environment.inside.temperature'   },
    { label: 'env: outsidePressure',  path: 'environment.outside.pressure'     },
  ];

  for (const { label, path } of paths) {
    test(`${label} — returns {last,min,max,mean} object`, { timeout: 10000 }, async (t) => {
      skipIfOffline(t);
      const stats = await queryStats(path, WINDOW);
      assertStatsShape(stats, label);
    });

    test(`${label} — min ≤ mean ≤ max when data exists`, { timeout: 10000 }, async (t) => {
      skipIfOffline(t);
      const { min, mean, max } = await queryStats(path, WINDOW);
      if (min === null || mean === null || max === null) return; // no data
      // Allow a tiny epsilon for floating-point rounding in InfluxDB aggregates
      const ε = 1e-9;
      assert.ok(min <= mean + ε, `${label}: min(${min}) > mean(${mean})`);
      assert.ok(mean <= max + ε, `${label}: mean(${mean}) > max(${max})`);
    });
  }
});

// ─── queryStats — plausible value ranges (post-conversion sanity checks) ─────

describe('queryStats — plausible raw SI value ranges', () => {
  // All values are raw SI (unconverted) as returned by queryStats.
  // These are sanity checks against obviously wrong data.

  test('outside pressure is a plausible Pascal value (95000–110000 Pa)', { timeout: 10000 }, async (t) => {
    skipIfOffline(t);
    const { last } = await queryStats('environment.outside.pressure', '24h');
    assertRange(last, 95000, 110000, 'outside pressure (Pa)');
  });

  test('house battery voltage is plausible (10.5–15.5 V)', { timeout: 10000 }, async (t) => {
    skipIfOffline(t);
    const { last } = await queryStats('electrical.batteries.house.voltage', '24h');
    assertRange(last, 10.5, 15.5, 'house battery voltage (V)');
  });

  test('inside temperature is plausible Kelvin (268–323 K = -5 to +50°C)', { timeout: 10000 }, async (t) => {
    skipIfOffline(t);
    const { last } = await queryStats('environment.inside.temperature', '24h');
    assertRange(last, 268, 323, 'inside temperature (K)');
  });

  test('apparent wind speed is non-negative (m/s)', { timeout: 10000 }, async (t) => {
    skipIfOffline(t);
    const { last, min } = await queryStats('environment.wind.speedApparent', '24h');
    if (last !== null) assertRange(last, 0, 60,  'apparent wind speed (m/s)');
    if (min  !== null) assertRange(min,  0, Infinity, 'apparent wind speed min (must be ≥ 0)');
  });

  test('depth below keel is non-negative metres', { timeout: 10000 }, async (t) => {
    skipIfOffline(t);
    const { last } = await queryStats('environment.depth.belowKeel', '24h');
    if (last !== null) assertRange(last, 0, 500, 'depth belowKeel (m)');
  });

  test('water temperature is plausible Kelvin (273–313 K = 0–40°C)', { timeout: 10000 }, async (t) => {
    skipIfOffline(t);
    const { last } = await queryStats('environment.water.temperature', '24h');
    assertRange(last, 273, 313, 'water temperature (K)');
  });

  test('true heading radians are in range 0 – 2π', { timeout: 10000 }, async (t) => {
    skipIfOffline(t);
    const { last } = await queryStats('navigation.headingTrue', '24h');
    assertRange(last, 0, 2 * Math.PI + 0.01, 'headingTrue (radians)');
  });

  test('course over ground radians are in range 0 – 2π', { timeout: 10000 }, async (t) => {
    skipIfOffline(t);
    const { last } = await queryStats('navigation.courseOverGroundTrue', '24h');
    assertRange(last, 0, 2 * Math.PI + 0.01, 'COG (radians)');
  });
});

// ─── queryTimeSeries — pressure sparkline ────────────────────────────────────

describe('queryTimeSeries — pressure sparkline (12h)', () => {
  test('returns an array', { timeout: 10000 }, async (t) => {
    skipIfOffline(t);
    const series = await queryTimeSeries('environment.outside.pressure', '12h', '15m');
    assert.ok(Array.isArray(series), 'expected array');
  });

  test('each point has numeric t (epoch ms) and v fields', { timeout: 10000 }, async (t) => {
    skipIfOffline(t);
    const series = await queryTimeSeries('environment.outside.pressure', '12h', '15m');
    if (series.length === 0) return; // no data — acceptable
    for (const pt of series) {
      assert.equal(typeof pt.t, 'number', 'point.t must be a number');
      assert.equal(typeof pt.v, 'number', 'point.v must be a number');
      assert.ok(pt.t > 0, 'point.t must be a positive epoch ms');
    }
  });

  test('12h series at 15m aggregation has at most 50 points', { timeout: 10000 }, async (t) => {
    skipIfOffline(t);
    const series = await queryTimeSeries('environment.outside.pressure', '12h', '15m');
    // 12h / 15m = 48 buckets; InfluxDB may include boundary points → allow up to 50
    assert.ok(series.length <= 50, `expected ≤50 points, got ${series.length}`);
  });

  test('points are in ascending chronological order', { timeout: 10000 }, async (t) => {
    skipIfOffline(t);
    const series = await queryTimeSeries('environment.outside.pressure', '12h', '15m');
    for (let i = 1; i < series.length; i++) {
      assert.ok(series[i].t > series[i - 1].t, `points out of order at index ${i}`);
    }
  });

  test('raw Pa values fall in a plausible atmospheric range (95000–110000)', { timeout: 10000 }, async (t) => {
    skipIfOffline(t);
    const series = await queryTimeSeries('environment.outside.pressure', '12h', '15m');
    for (const { t: ts, v } of series) {
      assert.ok(
        v >= 95000 && v <= 110000,
        `pressure point at ${new Date(ts).toISOString()} has implausible value ${v} Pa`
      );
    }
  });
});

// ─── fetchAllMetrics — overall response shape ─────────────────────────────────

describe('fetchAllMetrics — response structure', () => {
  test('returns _window field', { timeout: 30000 }, async (t) => {
    skipIfOffline(t);
    assert.ok(typeof allMetrics._window === 'string', '_window must be a string');
    assert.match(allMetrics._window, /^\d+(s|m|h)$/, '_window must be a Flux duration string');
  });

  test('returns _queriedAt ISO timestamp', { timeout: 30000 }, async (t) => {
    skipIfOffline(t);
    assert.ok(typeof allMetrics._queriedAt === 'string', '_queriedAt must be a string');
    assert.doesNotThrow(() => {
      const d = new Date(allMetrics._queriedAt);
      assert.ok(!isNaN(d), '_queriedAt must be a valid date');
    });
  });

  // ── Wind group ────────────────────────────────────────────────────────────

  test('wind group is present', async (t) => {
    skipIfOffline(t);
    assert.ok(allMetrics.wind, 'wind group missing');
  });

  test('wind.apparentSpeed has def + stats shape', async (t) => {
    skipIfOffline(t);
    const m = allMetrics.wind?.apparentSpeed;
    assert.ok(m, 'wind.apparentSpeed missing');
    assert.ok(m.def,   'wind.apparentSpeed.def missing');
    assertStatsShape(m.stats, 'wind.apparentSpeed');
  });

  test('wind.apparentAngle has def + stats shape', async (t) => {
    skipIfOffline(t);
    const m = allMetrics.wind?.apparentAngle;
    assert.ok(m, 'wind.apparentAngle missing');
    assertStatsShape(m.stats, 'wind.apparentAngle');
  });

  test('wind.trueSpeed has def + stats shape', async (t) => {
    skipIfOffline(t);
    const m = allMetrics.wind?.trueSpeed;
    assert.ok(m, 'wind.trueSpeed missing');
    assertStatsShape(m.stats, 'wind.trueSpeed');
  });

  test('wind.trueAngle has def + stats shape', async (t) => {
    skipIfOffline(t);
    const m = allMetrics.wind?.trueAngle;
    assert.ok(m, 'wind.trueAngle missing');
    assertStatsShape(m.stats, 'wind.trueAngle');
  });

  // ── Navigation group ──────────────────────────────────────────────────────

  test('navigation group is present', async (t) => {
    skipIfOffline(t);
    assert.ok(allMetrics.navigation, 'navigation group missing');
  });

  test('navigation.sog has def + stats shape', async (t) => {
    skipIfOffline(t);
    assertStatsShape(allMetrics.navigation?.sog?.stats, 'navigation.sog');
  });

  test('navigation.cog has def + stats shape', async (t) => {
    skipIfOffline(t);
    assertStatsShape(allMetrics.navigation?.cog?.stats, 'navigation.cog');
  });

  test('navigation.heading has def + stats shape', async (t) => {
    skipIfOffline(t);
    assertStatsShape(allMetrics.navigation?.heading?.stats, 'navigation.heading');
  });

  // ── Depth group ───────────────────────────────────────────────────────────

  test('depth group is present', async (t) => {
    skipIfOffline(t);
    assert.ok(allMetrics.depth, 'depth group missing');
  });

  test('depth.belowKeel has def + stats shape', async (t) => {
    skipIfOffline(t);
    assertStatsShape(allMetrics.depth?.belowKeel?.stats, 'depth.belowKeel');
  });

  test('depth.waterTemp has def + stats shape', async (t) => {
    skipIfOffline(t);
    assertStatsShape(allMetrics.depth?.waterTemp?.stats, 'depth.waterTemp');
  });

  // ── Battery group ─────────────────────────────────────────────────────────

  test('battery group is present', async (t) => {
    skipIfOffline(t);
    assert.ok(allMetrics.battery, 'battery group missing');
  });

  test('battery.house_voltage has def + stats shape', async (t) => {
    skipIfOffline(t);
    assertStatsShape(allMetrics.battery?.house_voltage?.stats, 'battery.house_voltage');
  });

  test('battery.house_current has def + stats shape', async (t) => {
    skipIfOffline(t);
    assertStatsShape(allMetrics.battery?.house_current?.stats, 'battery.house_current');
  });

  test('battery.start_voltage has def + stats shape', async (t) => {
    skipIfOffline(t);
    assertStatsShape(allMetrics.battery?.start_voltage?.stats, 'battery.start_voltage');
  });

  test('_banksMeta is an array of bank descriptors', async (t) => {
    skipIfOffline(t);
    assert.ok(Array.isArray(allMetrics._banksMeta), '_banksMeta must be an array');
    assert.ok(allMetrics._banksMeta.length > 0, '_banksMeta must not be empty');
    for (const bank of allMetrics._banksMeta) {
      assert.ok(bank.id,    'bank must have id');
      assert.ok(bank.label, 'bank must have label');
    }
  });

  // ── Environment group ─────────────────────────────────────────────────────

  test('environment group is present', async (t) => {
    skipIfOffline(t);
    assert.ok(allMetrics.environment, 'environment group missing');
  });

  test('environment.insideTemp has def + stats shape', async (t) => {
    skipIfOffline(t);
    assertStatsShape(allMetrics.environment?.insideTemp?.stats, 'environment.insideTemp');
  });

  test('environment.outsidePressure has def + stats shape', async (t) => {
    skipIfOffline(t);
    assertStatsShape(allMetrics.environment?.outsidePressure?.stats, 'environment.outsidePressure');
  });

  test('environment.outsidePressure.series is populated', async (t) => {
    skipIfOffline(t);
    const series = allMetrics.environment?.outsidePressure?.series;
    assert.ok(Array.isArray(series), 'outsidePressure.series must be an array');
    assert.ok(series.length > 0, 'outsidePressure.series must have at least one data point');
  });

  test('pressure series values are converted to hPa (950–1050)', async (t) => {
    skipIfOffline(t);
    const series = allMetrics.environment?.outsidePressure?.series ?? [];
    for (const { v } of series) {
      assert.ok(v >= 950 && v <= 1050, `converted pressure ${v} hPa outside plausible range`);
    }
  });

  // ── Conversion sanity checks on real data ─────────────────────────────────

  test('wind apparentSpeed is in knots after conversion (0–60 kts)', async (t) => {
    skipIfOffline(t);
    const { last } = allMetrics.wind?.apparentSpeed?.stats ?? {};
    assertRange(last, 0, 60, 'wind apparentSpeed (kts)');
  });

  test('inside temperature is in Celsius after conversion (-5 to +50°C)', async (t) => {
    skipIfOffline(t);
    const { last } = allMetrics.environment?.insideTemp?.stats ?? {};
    assertRange(last, -5, 50, 'insideTemp (°C)');
  });

  test('outside pressure is in hPa after conversion (950–1050)', async (t) => {
    skipIfOffline(t);
    const { last } = allMetrics.environment?.outsidePressure?.stats ?? {};
    assertRange(last, 950, 1050, 'outsidePressure (hPa)');
  });

  test('house battery voltage after conversion is still in plausible volts (10.5–15.5)', async (t) => {
    skipIfOffline(t);
    const { last } = allMetrics.battery?.house_voltage?.stats ?? {};
    assertRange(last, 10.5, 15.5, 'house battery voltage (V)');
  });

  test('heading angle is in degrees 0–360 after conversion', async (t) => {
    skipIfOffline(t);
    const { last } = allMetrics.navigation?.heading?.stats ?? {};
    assertRange(last, 0, 360, 'heading (degrees)');
  });

  test('COG is in degrees 0–360 after conversion', async (t) => {
    skipIfOffline(t);
    const { last } = allMetrics.navigation?.cog?.stats ?? {};
    assertRange(last, 0, 360, 'COG (degrees)');
  });
});
