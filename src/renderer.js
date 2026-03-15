/**
 * HTML renderer — generates a 800×480 e-ink optimised dashboard
 * from the metrics data returned by influx.js.
 *
 * Returns a self-contained HTML string (no external resources).
 */

import { formatValue, bearingLabel, normaliseWindAngle } from './utils.js';
import { displayConfig, vesselConfig, metricsConfig } from './config.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format a stats object into a compact "min / mean / max" line */
function statsLine(stats, decimals, unit = '') {
  if (!stats) return '<span class="no-data">no data</span>';
  const min  = formatValue(stats.min,  decimals);
  const mean = formatValue(stats.mean, decimals);
  const max  = formatValue(stats.max,  decimals);
  return `<span class="stat-mn">${min}</span>`
       + `<span class="stat-sep"> · </span>`
       + `<span class="stat-av">${mean}</span>`
       + `<span class="stat-sep"> · </span>`
       + `<span class="stat-mx">${max}</span>`
       + (unit ? `<span class="stat-unit"> ${unit}</span>` : '');
}

/** Wind direction SVG arrow (compass-style, 80×80) */
function windArrowSvg(angleDeg, isDark) {
  const strokeColor = isDark ? '#fff' : '#000';
  const fillColor   = isDark ? '#333' : '#e8e8e8';
  const angle       = (angleDeg ?? 0);
  // Arrow points in the direction the wind is coming FROM
  return `<svg width="88" height="88" viewBox="0 0 88 88" xmlns="http://www.w3.org/2000/svg">
  <circle cx="44" cy="44" r="40" fill="${fillColor}" stroke="${strokeColor}" stroke-width="1.5"/>
  <!-- Tick marks every 45° -->
  ${[0,45,90,135,180,225,270,315].map(a => {
    const r = (a % 90 === 0) ? 36 : 38;
    const x1 = 44 + 40 * Math.sin(a * Math.PI / 180);
    const y1 = 44 - 40 * Math.cos(a * Math.PI / 180);
    const x2 = 44 + r  * Math.sin(a * Math.PI / 180);
    const y2 = 44 - r  * Math.cos(a * Math.PI / 180);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${strokeColor}" stroke-width="1.5"/>`;
  }).join('')}
  <!-- Cardinal labels -->
  <text x="44" y="10" text-anchor="middle" font-size="9" font-family="system-ui,sans-serif" fill="${strokeColor}" font-weight="700">N</text>
  <text x="78" y="47" text-anchor="middle" font-size="9" font-family="system-ui,sans-serif" fill="${strokeColor}">E</text>
  <text x="44" y="83" text-anchor="middle" font-size="9" font-family="system-ui,sans-serif" fill="${strokeColor}">S</text>
  <text x="10" y="47" text-anchor="middle" font-size="9" font-family="system-ui,sans-serif" fill="${strokeColor}">W</text>
  <!-- Direction arrow -->
  <g transform="rotate(${angle}, 44, 44)">
    <polygon points="44,12 48,44 44,38 40,44" fill="${strokeColor}" opacity="0.9"/>
    <polygon points="44,76 48,44 44,50 40,44" fill="${strokeColor}" opacity="0.3"/>
  </g>
  <circle cx="44" cy="44" r="4" fill="${strokeColor}"/>
</svg>`;
}

/** Single metric row: label | value | unit */
function metricRow(label, value, unit, decimals, stats, cls = '') {
  const displayVal = formatValue(value, decimals);
  return `<div class="metric-row ${cls}">
  <span class="metric-label">${label}</span>
  <span class="metric-value">${displayVal}<span class="metric-unit">${unit}</span></span>
  <div class="metric-stats">${statsLine(stats, decimals)}</div>
</div>`;
}

// ─── Section renderers ───────────────────────────────────────────────────────

/**
 * Render a pressure sparkline as an inline SVG from a 12-hour time-series.
 *
 * @param {{ t: number, v: number }[]|undefined} series — [{epoch ms, hPa value}]
 * @param {boolean} isDark
 * @returns {string} — SVG element string, or a "no data" span
 */
function pressureSparklineSvg(series, isDark) {
  const W = 234, H = 58;
  if (!series || series.length < 2) {
    return `<span class="no-data">no history</span>`;
  }

  const values  = series.map(p => p.v);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const range   = Math.max(dataMax - dataMin, 2);  // ensure visible Y range on flat pressure
  const pad     = range * 0.2;
  const yMin    = dataMin - pad;
  const yMax    = dataMax + pad;

  const tMin = series[0].t;
  const tMax = series[series.length - 1].t;

  const toX = t => ((t - tMin) / (tMax - tMin || 1)) * (W - 2) + 1;
  const toY = v => H - 2 - ((v - yMin) / (yMax - yMin)) * (H - 4);

  const pts    = series.map(p => `${toX(p.t).toFixed(1)},${toY(p.v).toFixed(1)}`).join(' ');
  const lastPt = series[series.length - 1];
  const lastX  = toX(lastPt.t).toFixed(1);
  const lastY  = toY(lastPt.v).toFixed(1);
  // Close path to baseline for the filled area
  const fillPts = `1,${H} ${pts} ${lastX},${H}`;

  const stroke    = isDark ? '#c0c0c0' : '#444444';
  const fillCol   = isDark ? 'rgba(192,192,192,0.10)' : 'rgba(0,0,0,0.07)';
  const dotFill   = isDark ? '#ffffff' : '#000000';
  const baseColor = isDark ? '#333333' : '#dddddd';
  const lblColor  = isDark ? '#555555' : '#aaaaaa';

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <line x1="1" y1="${H - 1}" x2="${W - 1}" y2="${H - 1}" stroke="${baseColor}" stroke-width="0.5"/>
  <polygon points="${fillPts}" fill="${fillCol}" stroke="none"/>
  <polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${lastX}" cy="${lastY}" r="2.5" fill="${dotFill}"/>
  <text x="2" y="${H - 2}" font-size="7" font-family="system-ui,sans-serif" fill="${lblColor}">12h</text>
  <text x="${W - 2}" y="${H - 2}" font-size="7" font-family="system-ui,sans-serif" fill="${lblColor}" text-anchor="end">now</text>
</svg>`;
}

function renderWind(data, isDark) {
  if (!metricsConfig.wind?.enabled || !data.wind) {
    return `<section class="panel panel-wind"><div class="panel-title">WIND</div><div class="no-data">disabled</div></section>`;
  }

  const w  = data.wind;
  const aw = w.apparentAngle;
  const twAngle = w.trueAngle;

  const awStats    = aw?.stats;
  const awLast     = aw?.stats?.last;
  const { angle: normAwa, side: awaSide } = normaliseWindAngle(awLast);

  const twStats    = twAngle?.stats;
  const twLast     = twAngle?.stats?.last;
  const { side: twaSide } = normaliseWindAngle(twLast);

  // Primary bearing for the SVG: use apparent angle, convert to compass direction
  const awsBig = formatValue(w.apparentSpeed?.stats?.last, w.apparentSpeed?.def?.decimals ?? 1);
  const awaDeg = formatValue(normAwa, 0);

  const arrowAngle = awLast !== null && awLast !== undefined
    ? (((awLast * 180 / Math.PI) % 360) + 360) % 360
    : 0;

  // Pressure sparkline — drawn if environment.outsidePressure is configured
  const pressEntry = data.environment?.outsidePressure;
  const pressHtml  = pressEntry
    ? `<div class="press-section">
  <div class="stat-header">PRESSURE · 12h (hPa)</div>
  <div class="press-chart">${pressureSparklineSvg(pressEntry.series, isDark)}</div>
  <div class="stat-block">
    <div class="stat-header">min/avg/max</div>
    <div class="stat-row">${statsLine(pressEntry.stats, 0)}</div>
  </div>
</div>`
    : '';

  return `<section class="panel panel-wind">
  <div class="panel-title">WIND</div>
  <div class="wind-top">
    <div class="wind-compass">${windArrowSvg(arrowAngle, isDark)}</div>
    <div class="wind-primary">
      <div class="wind-speed-group">
        <span class="big-label">AWS</span>
        <span class="big-value">${awsBig}</span>
        <span class="big-unit">kts</span>
      </div>
      <div class="wind-angle-group">
        <span class="big-label">AWA</span>
        <span class="big-value medium-value">${awaDeg}°</span>
        <span class="side-badge ${awaSide.toLowerCase()}">${awaSide}</span>
      </div>
    </div>
  </div>
  <div class="wind-stats-grid">
    <div class="wind-stat-col">
      <div class="stat-header">AWS · min/avg/max (kts)</div>
      <div class="stat-row">${statsLine(w.apparentSpeed?.stats, w.apparentSpeed?.def?.decimals ?? 1)}</div>
    </div>
    <div class="wind-stat-col">
      <div class="stat-header">AWA · min/avg/max (°)</div>
      <div class="stat-row">${statsLine(awStats, 0)}</div>
    </div>
  </div>
  <div class="wind-true">
    <span class="true-label">TWS</span>
    <span class="true-value">${formatValue(w.trueSpeed?.stats?.last, 1)}</span>
    <span class="true-unit">kts</span>
    <span class="divider">|</span>
    <span class="true-label">TWA</span>
    <span class="true-value">${formatValue(normaliseWindAngle(w.trueAngle?.stats?.last).angle, 0)}°</span>
    <span class="side-badge ${twaSide.toLowerCase()}">${twaSide}</span>
  </div>
  <div class="wind-stats-grid">
    <div class="wind-stat-col">
      <div class="stat-header">TWS · min/avg/max (kts)</div>
      <div class="stat-row">${statsLine(w.trueSpeed?.stats, 1)}</div>
    </div>
    <div class="wind-stat-col">
      <div class="stat-header">TWA · min/avg/max (°)</div>
      <div class="stat-row">${statsLine(twStats, 0)}</div>
    </div>
  </div>
  ${pressHtml}
</section>`;
}

function renderNavigation(data, isDark) {
  if (!metricsConfig.navigation?.enabled || !data.navigation) {
    return `<section class="panel panel-nav"><div class="panel-title">NAVIGATION</div><div class="no-data">disabled</div></section>`;
  }

  const n   = data.navigation;
  const sog = n.sog?.stats?.last;
  const cog = n.cog?.stats?.last;
  const hdg = n.heading?.stats?.last;

  return `<section class="panel panel-nav">
  <div class="panel-title">NAVIGATION</div>
  <div class="nav-main">
    <div class="nav-primary">
      <span class="nav-big-value">${formatValue(sog, 1)}</span>
      <span class="nav-big-unit">kts</span>
    </div>
    <div class="nav-label-row">Speed Over Ground</div>
  </div>
  <div class="nav-row-group">
    <div class="nav-row">
      <span class="nav-row-label">COG</span>
      <span class="nav-row-value">${formatValue(cog, 0)}°</span>
      <span class="nav-row-sub">${bearingLabel(cog)}</span>
    </div>
    <div class="nav-row">
      <span class="nav-row-label">HDG</span>
      <span class="nav-row-value">${formatValue(hdg, 0)}°</span>
      <span class="nav-row-sub">${bearingLabel(hdg)}</span>
    </div>
  </div>
  <div class="stat-block">
    <div class="stat-header">SOG · min/avg/max (kts)</div>
    <div class="stat-row">${statsLine(n.sog?.stats, 1)}</div>
  </div>
  <div class="stat-block">
    <div class="stat-header">COG · min/avg/max (°)</div>
    <div class="stat-row">${statsLine(n.cog?.stats, 0)}</div>
  </div>
</section>`;
}

function renderDepth(data, isDark) {
  const enabled = metricsConfig.depth?.enabled && data.depth;
  const depth   = enabled ? data.depth?.belowKeel?.stats?.last  : null;
  const wtemp   = enabled ? data.depth?.waterTemp?.stats?.last  : null;

  return `<section class="panel panel-depth">
  <div class="panel-title">DEPTH &amp; WATER</div>
  <div class="dual-metric">
    <div class="dual-item">
      <span class="dual-label">DEPTH</span>
      <span class="dual-value">${formatValue(depth, 1)}</span>
      <span class="dual-unit">m</span>
      <div class="stat-block">
        <div class="stat-header">min/avg/max</div>
        <div class="stat-row">${statsLine(data.depth?.belowKeel?.stats, 1)}</div>
      </div>
    </div>
    <div class="dual-divider"></div>
    <div class="dual-item">
      <span class="dual-label">WATER</span>
      <span class="dual-value">${formatValue(wtemp, 1)}</span>
      <span class="dual-unit">°C</span>
      <div class="stat-block">
        <div class="stat-header">min/avg/max</div>
        <div class="stat-row">${statsLine(data.depth?.waterTemp?.stats, 1)}</div>
      </div>
    </div>
  </div>
</section>`;
}

function renderBattery(data, isDark) {
  const banks    = data._banksMeta ?? [];
  const enabled  = metricsConfig.battery?.enabled;

  if (!enabled || banks.length === 0) {
    return `<section class="panel panel-battery"><div class="panel-title">BATTERY</div><div class="no-data">disabled</div></section>`;
  }

  const bankHtml = banks.map(bank => {
    const vStats   = data.battery?.[`${bank.id}_voltage`]?.stats;
    const iStats   = data.battery?.[`${bank.id}_current`]?.stats;
    const voltage  = vStats?.last;
    const current  = iStats?.last;

    const vClass = voltage == null ? '' : voltage >= 12.6 ? 'good' : voltage >= 12.2 ? 'warn' : 'alert';

    return `<div class="battery-bank">
  <div class="battery-name">${bank.label}</div>
  <div class="battery-voltage ${vClass}">${formatValue(voltage, 1)}<span class="battery-unit">V</span></div>
  ${current !== null
    ? `<div class="battery-current">${current >= 0 ? '+' : ''}${formatValue(current, 1)}<span class="battery-unit">A</span></div>`
    : ''}
  <div class="stat-block">
    <div class="stat-header">V · min/avg/max</div>
    <div class="stat-row">${statsLine(vStats, 1)}</div>
  </div>
</div>`;
  }).join('<div class="bank-divider"></div>');

  return `<section class="panel panel-battery">
  <div class="panel-title">BATTERY</div>
  <div class="battery-grid">${bankHtml}</div>
</section>`;
}

function renderEnvironment(data, isDark) {
  const enabled = metricsConfig.environment?.enabled;
  const cabin   = enabled ? data.environment?.insideTemp?.stats?.last : null;

  return `<section class="panel panel-env">
  <div class="panel-title">CABIN TEMP</div>
  <div class="env-main">
    <span class="env-big-value">${formatValue(cabin, 1)}</span>
    <span class="env-big-unit">°C</span>
  </div>
  <div class="stat-block">
    <div class="stat-header">min/avg/max (°C)</div>
    <div class="stat-row">${statsLine(data.environment?.insideTemp?.stats, 1)}</div>
  </div>
</section>`;
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

function buildCss(isDark, bitDepth = 1) {
  const bg0   = isDark ? '#0a0a0a' : '#ffffff';
  const bg1   = isDark ? '#141414' : '#f8f8f8';
  // In 2-bit mode map colours to the 4 available display levels (0/85/170/255)
  const bg2   = bitDepth >= 2 ? (isDark ? '#404040' : '#d0d0d0') : (isDark ? '#1e1e1e' : '#f0f0f0');
  const text0 = isDark ? '#f2f2f2' : '#0a0a0a';
  const text1 = isDark ? '#c0c0c0' : '#333333';
  const text2 = isDark ? '#808080' : '#666666';
  const border= isDark ? '#2e2e2e' : '#d8d8d8';
  const good  = bitDepth >= 2 ? (isDark ? '#b0b0b0' : '#505050') : (isDark ? '#66bb6a' : '#1b6b1f');
  const warn  = bitDepth >= 2 ? (isDark ? '#707070' : '#a0a0a0') : (isDark ? '#ffa726' : '#a0620b');
  const alert = bitDepth >= 2 ? (isDark ? '#ffffff' : '#000000') : (isDark ? '#ef5350' : '#b71c1c');

  return `
*{box-sizing:border-box;margin:0;padding:0}
body{
  width:800px;height:480px;overflow:hidden;
  background:${bg0};color:${text0};
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  font-size:12px;line-height:1.3;
}

/* ── Header ── */
.header{
  display:flex;justify-content:space-between;align-items:center;
  height:40px;padding:0 14px;
  background:${isDark ? '#000' : '#000'};color:#fff;
  border-bottom:2px solid ${isDark ? '#333' : '#000'};
}
.vessel-name{font-size:16px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase}
.header-right{text-align:right;font-size:11px;color:#ccc;font-variant-numeric:tabular-nums}
.header-time{font-size:16px;font-weight:600;color:#fff;font-variant-numeric:tabular-nums}

/* ── Main grid ── */
/* Layout: 3 columns × 2 rows
   Col 1 (260px): Wind — spans both rows
   Col 2 (1fr):   Navigation (row 1)  |  Depth (row 2)
   Col 3 (1fr):   Battery   (row 1)  |  Cabin  (row 2)  */
.main-grid{
  display:grid;
  grid-template-columns: 260px 270px 270px;
  grid-template-rows: 58% 42%;
  width:800px;height:416px;
}

/* ── Panels ── */
.panel{
  border-right:1px solid ${border};border-bottom:1px solid ${border};
  padding:8px 12px;overflow:hidden;position:relative;
  background:${bg0};
}
.panel-wind{grid-column:1;grid-row:1/3;border-left:none;display:flex;flex-direction:column}
.panel-nav{grid-column:2;grid-row:1}
.panel-depth{grid-column:2;grid-row:2}
.panel-battery{grid-column:3;grid-row:1}
.panel-env{grid-column:3;grid-row:2}

.panel-title{
  font-size:9px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;
  color:${text2};border-bottom:1px solid ${border};padding-bottom:4px;margin-bottom:8px;
}

/* ── Wind panel ── */
.wind-top{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.wind-compass{flex-shrink:0}
.wind-primary{flex:1}
.wind-speed-group,.wind-angle-group{display:flex;align-items:baseline;gap:4px;margin-bottom:4px}
.big-label{font-size:9px;font-weight:700;letter-spacing:0.1em;color:${text2};width:28px}
.big-value{font-size:36px;font-weight:300;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
.big-unit{font-size:14px;color:${text1};margin-left:2px}
.medium-value{font-size:28px}

.side-badge{
  font-size:9px;font-weight:700;letter-spacing:0.08em;padding:2px 5px;
  border:1px solid ${border};border-radius:3px;margin-left:4px;
}
.side-badge.stbd{background:transparent;color:${isDark?'#66bb6a':'#1b6b1f'};border-color:${isDark?'#66bb6a':'#1b6b1f'}}
.side-badge.port{background:transparent;color:${isDark?'#ef5350':'#b71c1c'};border-color:${isDark?'#ef5350':'#b71c1c'}}

.wind-true{
  display:flex;align-items:center;gap:6px;
  font-size:12px;padding:6px 0;border-top:1px solid ${border};margin-top:2px
}
.true-label{font-size:9px;font-weight:700;color:${text2};letter-spacing:0.1em}
.true-value{font-size:16px;font-weight:500;font-variant-numeric:tabular-nums}
.true-unit{font-size:10px;color:${text1}}
.divider{color:${border};margin:0 4px}

.wind-stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:6px}
.wind-stat-col{text-align:center}

/* ── Stat blocks ── */
.stat-block{margin-top:6px;text-align:center}
.stat-header{
  font-size:8.5px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;
  color:${text2};margin-bottom:2px;
}
.stat-row{
  font-size:11px;font-variant-numeric:tabular-nums;color:${text1};
  display:flex;justify-content:center;align-items:baseline;gap:1px;
  white-space:nowrap;
}
.stat-mn{color:${isDark?'#80b4ff':'#1565c0'};font-weight:500;min-width:2.8em;text-align:right}
.stat-av{color:${text0};font-weight:600;min-width:2.8em;text-align:center}
.stat-mx{color:${isDark?'#ff8a80':'#b71c1c'};font-weight:500;min-width:2.8em;text-align:left}
.stat-sep{color:${text2};padding:0 1px}
.stat-unit{color:${text2};font-size:10px}
.no-data{color:${text2};font-style:italic}

/* ── Navigation panel ── */
.nav-main{text-align:center;padding:8px 0 6px}
.nav-primary{display:flex;align-items:baseline;justify-content:center;gap:4px}
.nav-big-value{font-size:48px;font-weight:200;letter-spacing:-0.03em;font-variant-numeric:tabular-nums}
.nav-big-unit{font-size:18px;color:${text1}}
.nav-label-row{font-size:9px;color:${text2};text-align:center;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px}

.nav-row-group{display:flex;justify-content:center;gap:20px;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid ${border}}
.nav-row{display:flex;align-items:baseline;gap:4px}
.nav-row-label{font-size:9px;font-weight:700;color:${text2};letter-spacing:0.1em}
.nav-row-value{font-size:20px;font-weight:500;font-variant-numeric:tabular-nums}
.nav-row-sub{font-size:11px;color:${text1}}

/* ── Depth panel ── */
.dual-metric{display:flex;align-items:stretch;height:calc(100% - 28px)}
.dual-item{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px}
.dual-divider{width:1px;background:${border};margin:4px 0}
.dual-label{font-size:9px;font-weight:700;color:${text2};letter-spacing:0.1em;margin-bottom:4px}
.dual-value{font-size:32px;font-weight:300;font-variant-numeric:tabular-nums;line-height:1}
.dual-unit{font-size:13px;color:${text1};margin-bottom:4px}

/* ── Battery panel ── */
.battery-grid{display:flex;gap:0;height:calc(100% - 28px)}
.battery-bank{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px}
.bank-divider{width:1px;background:${border};margin:4px 0}
.battery-name{font-size:9px;font-weight:700;color:${text2};letter-spacing:0.1em;margin-bottom:4px}
.battery-voltage{font-size:26px;font-weight:400;font-variant-numeric:tabular-nums;line-height:1}
.battery-voltage.good{color:${good}}
.battery-voltage.warn{color:${warn}}
.battery-voltage.alert{color:${alert}}
.battery-current{font-size:14px;color:${text1};font-variant-numeric:tabular-nums;margin-bottom:2px}
.battery-unit{font-size:12px;color:${text1}}

/* ── Environment panel ── */
.env-main{display:flex;align-items:baseline;gap:4px;justify-content:center;padding:12px 0 8px}
.env-big-value{font-size:40px;font-weight:300;font-variant-numeric:tabular-nums}
.env-big-unit{font-size:18px;color:${text1}}

/* ── Footer ── */
.footer{
  display:flex;justify-content:space-between;align-items:center;
  height:24px;padding:0 14px;
  background:${isDark?'#000':'#f4f4f4'};
  border-top:1px solid ${border};
  font-size:9.5px;color:${text2};font-variant-numeric:tabular-nums;
}

/* ── Pressure sparkline (inside wind panel) ── */
.press-section{margin-top:auto;padding-top:6px;border-top:1px solid ${border}}
.press-chart{margin:3px 0;line-height:0;text-align:center}
`;
}

// ─── Main render function ─────────────────────────────────────────────────────

/**
 * Render the full dashboard HTML for the TRMNL display.
 *
 * @param {object} data  — result of fetchAllMetrics()
 * @returns {string}     — complete HTML string, 800×480
 */
export function renderDashboard(data, { bitDepth = 1 } = {}) {
  const isDark   = displayConfig.theme === 'dark';
  const window   = data._window ?? '—';
  const now      = new Date();
  const timeStr  = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const dateStr  = now.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });

  const windHtml = renderWind(data, isDark);
  const navHtml  = renderNavigation(data, isDark);
  const depHtml  = renderDepth(data, isDark);
  const batHtml  = renderBattery(data, isDark);
  const envHtml  = renderEnvironment(data, isDark);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=800, initial-scale=1">
<title>${vesselConfig.name} — Marine Dashboard</title>
<style>${buildCss(isDark, bitDepth)}</style>
</head>
<body>
<header class="header">
  <div class="vessel-name">&#9875; ${vesselConfig.name}</div>
  <div class="header-right">
    <div class="header-time">${timeStr}</div>
    <div>${dateStr}</div>
  </div>
</header>

<div class="main-grid">
  ${windHtml}
  ${navHtml}
  ${depHtml}
  ${batHtml}
  ${envHtml}
</div>

<footer class="footer">
  <span>Window: ${window}</span>
  <span>SignalK &rsaquo; InfluxDB</span>
  <span>Updated: ${now.toLocaleTimeString('en-GB')}</span>
</footer>
</body>
</html>`;
}

// ─── Setup screen ─────────────────────────────────────────────────────────────

/**
 * Render a simple setup/provisioning screen shown to a freshly connected
 * TRMNL device while the first dashboard image is being generated.
 *
 * @returns {string} — complete HTML string, 800×480
 */
export function renderSetupScreen({ bitDepth = 1 } = {}) {
  const isDark  = displayConfig.theme === 'dark';
  const bg0     = isDark ? '#0a0a0a' : '#ffffff';
  const text0   = isDark ? '#f2f2f2' : '#0a0a0a';
  // In 2-bit mode snap to the nearest available display level to avoid dithering artefacts
  // on what should be solid-colour text.  Same logic as buildCss().
  const text2   = bitDepth >= 2 ? (isDark ? '#707070' : '#a0a0a0') : (isDark ? '#808080' : '#666666');
  const border  = bitDepth >= 2 ? (isDark ? '#404040' : '#d0d0d0') : (isDark ? '#2e2e2e' : '#d8d8d8');
  const name    = vesselConfig.name;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=800, initial-scale=1">
<title>${name} — Setting up</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{
  width:800px;height:480px;overflow:hidden;
  background:${bg0};color:${text0};
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:24px;
}
.boat{font-size:80px;line-height:1}
.vessel{font-size:36px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase}
.msg{font-size:15px;color:${text2};letter-spacing:0.05em}
.divider{width:120px;height:1px;background:${border}}
.sub{font-size:11px;color:${text2};letter-spacing:0.08em;text-transform:uppercase}
</style>
</head>
<body>
  <div class="boat">&#9875;</div>
  <div class="vessel">${name}</div>
  <div class="divider"></div>
  <div class="msg">Marine Dashboard — connecting&hellip;</div>
  <div class="sub">First update in progress</div>
</body>
</html>`;
}
