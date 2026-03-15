/**
 * InfluxDB 2.x client — fetches windowed statistics for marine metrics.
 *
 * Supports two SignalK→InfluxDB schemas (configured via config.yaml):
 *   "path_as_measurement" — measurement = SK path, field = "value"  (default v1 plugin)
 *   "tagged"              — measurement = "signalk", tag[path] = SK path, field = "value"
 */

import { InfluxDB } from '@influxdata/influxdb-client';
import { influxConfig, metricsConfig, displayConfig } from './config.js';
import { applyConversion, secondsToFluxDuration } from './utils.js';

/** Singleton client instance */
let _client = null;

function getClient() {
  if (!_client) {
    _client = new InfluxDB({
      url:   influxConfig.url,
      token: influxConfig.token,
    });
  }
  return _client;
}

/**
 * Build a Flux query that returns min, max, mean and last value
 * for a given SignalK path over the refresh window.
 *
 * @param {string} skPath   — e.g. "environment.wind.speedApparent"
 * @param {string} window   — Flux duration string, e.g. "15m"
 * @returns {string}        — Flux query
 */
function buildStatsQuery(skPath, window) {
  const bucket  = influxConfig.bucket;
  const schema  = influxConfig.schema ?? 'path_as_measurement';

  const dataFilter = schema === 'tagged'
    ? `filter(fn: (r) => r._measurement == "signalk")
  |> filter(fn: (r) => r["path"] == "${skPath}")`
    : `filter(fn: (r) => r._measurement == "${skPath}")`;

  // Flux: build stats using aggregates and tag each row with a "stat" field.
  return `
data = from(bucket: "${bucket}")
  |> range(start: -${window})
  |> ${dataFilter}
  |> filter(fn: (r) => r._field == "value")

union(tables: [
  data |> mean() |> map(fn: (r) => ({r with stat: "mean"})),
  data |> min()  |> map(fn: (r) => ({r with stat: "min"})),
  data |> max()  |> map(fn: (r) => ({r with stat: "max"})),
  data |> last() |> map(fn: (r) => ({r with stat: "last"})),
])
  `.trim();
}

/**
 * Query InfluxDB for windowed stats on a single path.
 *
 * @param {string} skPath
 * @param {string} fluxWindow  — e.g. "15m"
 * @returns {Promise<{last:number|null, min:number|null, max:number|null, mean:number|null}>}
 */
async function queryStats(skPath, fluxWindow) {
  const queryApi = getClient().getQueryApi(influxConfig.org);
  const query    = buildStatsQuery(skPath, fluxWindow);

  const result = { last: null, min: null, max: null, mean: null };

  return new Promise((resolve, reject) => {
    queryApi.queryRows(query, {
      next(row, tableMeta) {
        const obj  = tableMeta.toObject(row);
        const stat = obj.stat;
        if (stat && obj._value !== undefined && obj._value !== null) {
          result[stat] = obj._value;
        }
      },
      error(err) {
        // Don't crash on missing measurements — just return nulls
        console.warn(`InfluxDB query warning for "${skPath}": ${err.message}`);
        resolve(result);
      },
      complete() {
        resolve(result);
      },
    });
  });
}

/**
 * Apply a metric config's conversion + formatting to a stats object.
 * Returns a new object with values converted to display units.
 *
 * @param {{ last, min, max, mean }} rawStats
 * @param {object} metricDef  — from config.yaml metrics section
 * @returns {{ last, min, max, mean }}
 */
function convertStats(rawStats, metricDef) {
  const { conversion } = metricDef;
  return {
    last: applyConversion(rawStats.last, conversion),
    min:  applyConversion(rawStats.min,  conversion),
    max:  applyConversion(rawStats.max,  conversion),
    mean: applyConversion(rawStats.mean, conversion),
  };
}

/**
 * Build a Flux query that downsamples a metric to evenly-spaced mean buckets
 * over a given window — used for sparkline charts.
 *
 * @param {string} skPath
 * @param {string} window  — e.g. "12h"
 * @param {string} every   — aggregate window size, e.g. "15m"
 * @returns {string}
 */
function buildTimeSeriesQuery(skPath, window, every) {
  const bucket = influxConfig.bucket;
  const schema = influxConfig.schema ?? 'path_as_measurement';

  const dataFilter = schema === 'tagged'
    ? `filter(fn: (r) => r._measurement == "signalk")
  |> filter(fn: (r) => r["path"] == "${skPath}")`
    : `filter(fn: (r) => r._measurement == "${skPath}")`;

  return `
from(bucket: "${bucket}")
  |> range(start: -${window})
  |> ${dataFilter}
  |> filter(fn: (r) => r._field == "value")
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)
  `.trim();
}

/**
 * Fetch a downsampled time-series for sparkline charts.
 * Returns raw (unconverted) values — caller applies unit conversion.
 *
 * @param {string} skPath
 * @param {string} window       — Flux duration, e.g. "12h"
 * @param {string} [every="15m"] — bucket size
 * @returns {Promise<{t:number, v:number}[]>}  — [{epoch ms, raw value}]
 */
async function queryTimeSeries(skPath, window, every = '15m') {
  const queryApi = getClient().getQueryApi(influxConfig.org);
  const query    = buildTimeSeriesQuery(skPath, window, every);
  const series   = [];

  return new Promise((resolve) => {
    queryApi.queryRows(query, {
      next(row, tableMeta) {
        const obj = tableMeta.toObject(row);
        if (obj._time !== undefined && obj._value !== null && obj._value !== undefined) {
          series.push({ t: new Date(obj._time).getTime(), v: obj._value });
        }
      },
      error(err) {
        console.warn(`InfluxDB time-series warning for "${skPath}": ${err.message}`);
        resolve(series);
      },
      complete() {
        resolve(series);
      },
    });
  });
}

/**
 * Fetch all configured metric stats from InfluxDB.
 * Returns a structured object matching the metrics config shape.
 *
 * @returns {Promise<MetricsData>}
 */
export async function fetchAllMetrics() {
  const window     = secondsToFluxDuration(displayConfig.refreshIntervalSeconds);
  const metrics    = metricsConfig;

  // Collect all (path, metricDef, key) tuples we need to query
  const tasks = [];

  if (metrics.wind?.enabled) {
    const w = metrics.wind;
    for (const key of ['apparentSpeed','apparentAngle','trueSpeed','trueAngle']) {
      if (w[key]) tasks.push({ group: 'wind', key, def: w[key] });
    }
  }

  if (metrics.navigation?.enabled) {
    const n = metrics.navigation;
    for (const key of ['sog','cog','heading']) {
      if (n[key]) tasks.push({ group: 'navigation', key, def: n[key] });
    }
  }

  if (metrics.depth?.enabled) {
    const d = metrics.depth;
    for (const key of ['belowKeel','waterTemp']) {
      if (d[key]) tasks.push({ group: 'depth', key, def: d[key] });
    }
  }

  if (metrics.battery?.enabled) {
    const banks = metrics.battery.banks ?? [];
    for (const bank of banks) {
      if (bank.voltagePath) {
        tasks.push({ group: 'battery', key: `${bank.id}_voltage`, def: { ...bank, path: bank.voltagePath } });
      }
      if (bank.currentPath) {
        tasks.push({ group: 'battery', key: `${bank.id}_current`, def: { ...bank, path: bank.currentPath } });
      }
    }
  }

  if (metrics.environment?.enabled) {
    const e = metrics.environment;
    if (e.insideTemp)      tasks.push({ group: 'environment', key: 'insideTemp',      def: e.insideTemp });
    if (e.outsidePressure) tasks.push({ group: 'environment', key: 'outsidePressure', def: e.outsidePressure });
  }

  // Run stat queries and the 12-hour pressure time-series in parallel
  const pressureDef = metrics.environment?.outsidePressure;
  const [results, pressureSeries] = await Promise.all([
    Promise.allSettled(
      tasks.map(async (t) => {
        const raw = await queryStats(t.def.path, window);
        return { ...t, stats: convertStats(raw, t.def) };
      })
    ),
    pressureDef
      ? queryTimeSeries(pressureDef.path, '12h').then(
          pts => pts.map(p => ({ t: p.t, v: applyConversion(p.v, pressureDef.conversion) }))
        ).catch(() => [])
      : Promise.resolve([]),
  ]);

  // Fold into grouped result object
  const data = { _window: window, _queriedAt: new Date().toISOString() };
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { group, key, def, stats } = result.value;
      if (!data[group]) data[group] = {};
      data[group][key] = { def, stats };
    }
  }

  // Attach 12h time-series to the pressure entry (if data was returned)
  if (pressureSeries.length > 0 && data.environment?.outsidePressure) {
    data.environment.outsidePressure.series = pressureSeries;
  }

  // Attach bank metadata for rendering
  if (metrics.battery?.enabled) {
    data._banksMeta = metrics.battery.banks ?? [];
  }

  return data;
}
