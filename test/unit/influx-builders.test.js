/**
 * Unit tests — Flux query builder functions (src/influx.js)
 *
 * These tests verify the generated Flux query strings without making any
 * network requests. They check that every structural element required for
 * correct InfluxDB queries is present.
 *
 * Run with: node --test test/unit/influx-builders.test.js
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import { buildStatsQuery, buildTimeSeriesQuery } from '../../src/influx.js';
import { influxConfig } from '../../src/config.js';

// ─── buildStatsQuery ────────────────────────────────────────────────────────

describe('buildStatsQuery — path_as_measurement schema (default)', () => {
  const Q = buildStatsQuery('environment.wind.speedApparent', '15m');

  test('uses the configured bucket name', () => {
    assert.match(Q, new RegExp(`from\\(bucket: "${influxConfig.bucket}"\\)`));
  });

  test('scopes query to the correct range window', () => {
    assert.match(Q, /range\(start: -15m\)/);
  });

  test('filters by measurement name (path_as_measurement)', () => {
    assert.match(Q, /r\._measurement == "environment\.wind\.speedApparent"/);
  });

  test('does NOT use the "signalk" measurement name for default schema', () => {
    assert.doesNotMatch(Q, /r\._measurement == "signalk"/);
  });

  test('filters field to "value"', () => {
    assert.match(Q, /r\._field == "value"/);
  });

  test('produces a union of all four aggregate tables', () => {
    assert.match(Q, /union\(tables:/);
  });

  test('includes mean() aggregate', () => {
    assert.match(Q, /mean\(\)/);
  });

  test('includes min() aggregate', () => {
    assert.match(Q, /min\(\)/);
  });

  test('includes max() aggregate', () => {
    assert.match(Q, /max\(\)/);
  });

  test('includes last() aggregate', () => {
    assert.match(Q, /last\(\)/);
  });

  test('tags each aggregate row with its stat name', () => {
    assert.match(Q, /stat: "mean"/);
    assert.match(Q, /stat: "min"/);
    assert.match(Q, /stat: "max"/);
    assert.match(Q, /stat: "last"/);
  });

  test('embeds the window string into range', () => {
    const q6h = buildStatsQuery('some.path', '6h');
    assert.match(q6h, /range\(start: -6h\)/);
    assert.doesNotMatch(q6h, /range\(start: -15m\)/);
  });
});

describe('buildStatsQuery — tagged schema (opts override)', () => {
  const Q = buildStatsQuery(
    'environment.wind.speedApparent', '15m',
    { schema: 'tagged', bucket: 'testbucket' }
  );

  test('uses the overridden bucket name', () => {
    assert.match(Q, /from\(bucket: "testbucket"\)/);
  });

  test('filters by measurement == "signalk"', () => {
    assert.match(Q, /r\._measurement == "signalk"/);
  });

  test('filters by path tag equal to the sk path', () => {
    assert.match(Q, /r\["path"\] == "environment\.wind\.speedApparent"/);
  });

  test('does NOT use path as the measurement name', () => {
    assert.doesNotMatch(Q, /r\._measurement == "environment\.wind/);
  });
});

// ─── buildTimeSeriesQuery ───────────────────────────────────────────────────

describe('buildTimeSeriesQuery — path_as_measurement schema (default)', () => {
  const Q = buildTimeSeriesQuery('environment.outside.pressure', '12h', '15m');

  test('uses the configured bucket name', () => {
    assert.match(Q, new RegExp(`from\\(bucket: "${influxConfig.bucket}"\\)`));
  });

  test('scopes query to the correct range window', () => {
    assert.match(Q, /range\(start: -12h\)/);
  });

  test('filters by measurement name', () => {
    assert.match(Q, /r\._measurement == "environment\.outside\.pressure"/);
  });

  test('filters field to "value"', () => {
    assert.match(Q, /r\._field == "value"/);
  });

  test('uses aggregateWindow with the provided every interval', () => {
    assert.match(Q, /aggregateWindow\(every: 15m, fn: mean, createEmpty: false\)/);
  });

  test('does not pad with empty rows (createEmpty: false)', () => {
    assert.match(Q, /createEmpty: false/);
  });

  test('respects a different every value', () => {
    const q30 = buildTimeSeriesQuery('some.path', '6h', '30m');
    assert.match(q30, /aggregateWindow\(every: 30m, fn: mean, createEmpty: false\)/);
  });
});

describe('buildTimeSeriesQuery — tagged schema (opts override)', () => {
  const Q = buildTimeSeriesQuery('environment.outside.pressure', '12h', '15m',
    { schema: 'tagged', bucket: 'testbucket' });

  test('uses the overridden bucket name', () => {
    assert.match(Q, /from\(bucket: "testbucket"\)/);
  });

  test('filters by measurement == "signalk"', () => {
    assert.match(Q, /r\._measurement == "signalk"/);
  });

  test('filters by path tag', () => {
    assert.match(Q, /r\["path"\] == "environment\.outside\.pressure"/);
  });
});
