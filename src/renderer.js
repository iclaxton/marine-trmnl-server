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
function windArrowSvg(angleDeg, isDark, bitDepth = 1) {
  const strokeColor = isDark ? '#fff' : '#000';
  // For 2-bit e-ink use an intermediate value so Floyd-Steinberg dithers it
  // into a light mix of #aaaaaa and #ffffff — lighter than solid #aaaaaa.
  // Light mode: #555555 (dark grey) so the circle is visible against the black page.
  const fillColor   = bitDepth >= 2
    ? (isDark ? '#555555' : '#dddddd')
    : (isDark ? '#333' : '#e8e8e8');
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
  <!-- Cardinal labels — inset ~12px from rim -->
  <text x="44" y="18" text-anchor="middle" font-size="9" font-family="system-ui,sans-serif" fill="${strokeColor}" font-weight="700">N</text>
  <text x="72" y="47" text-anchor="middle" font-size="9" font-family="system-ui,sans-serif" fill="${strokeColor}">E</text>
  <text x="44" y="75" text-anchor="middle" font-size="9" font-family="system-ui,sans-serif" fill="${strokeColor}">S</text>
  <text x="18" y="47" text-anchor="middle" font-size="9" font-family="system-ui,sans-serif" fill="${strokeColor}">W</text>
  <!-- Direction arrow -->
  <g transform="rotate(${angle}, 44, 44)">
    <polygon points="44,12 48,44 44,38 40,44" fill="${strokeColor}"/>
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
function pressureSparklineSvg(series, isDark, bitDepth = 1) {
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

  // For 2-bit e-ink only exact palette colours are safe — any non-palette value
  // (including semi-transparent fills) gets Floyd-Steinberg dithered into spots.
  // In 2-bit mode we use no fill (none) for the area under the sparkline so the
  // line itself reads cleanly; the rgba fills are fine for the browser preview.
  const is2bit      = bitDepth === 2;
  const stroke      = is2bit
    ? (isDark ? '#aaaaaa' : '#555555')
    : (isDark  ? '#c0c0c0' : '#444444');
  const fillCol     = is2bit
    ? (isDark ? '#555555' : '#dddddd')   // dithered to light #aaaaaa/#ffffff mix
    : (isDark ? 'rgba(192,192,192,0.10)' : 'rgba(0,0,0,0.07)');
  const dotFill     = isDark ? '#ffffff' : '#000000';
  const baseColor   = is2bit ? (isDark ? '#555555' : '#aaaaaa') : (isDark ? '#333333' : '#dddddd');
  const lblColor    = isDark ? '#555555' : '#aaaaaa';

  const fillPolygon = `<polygon points="${fillPts}" fill="${fillCol}" stroke="none"/>`;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <line x1="1" y1="${H - 1}" x2="${W - 1}" y2="${H - 1}" stroke="${baseColor}" stroke-width="0.5"/>
  ${fillPolygon}
  <polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${lastX}" cy="${lastY}" r="2.5" fill="${dotFill}"/>
  <text x="2" y="${H - 2}" font-size="7" font-family="system-ui,sans-serif" fill="${lblColor}">12h</text>
  <text x="${W - 2}" y="${H - 2}" font-size="7" font-family="system-ui,sans-serif" fill="${lblColor}" text-anchor="end">now</text>
</svg>`;
}

function renderWind(data, isDark, bitDepth = 1) {
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
  <div class="press-chart">${pressureSparklineSvg(pressEntry.series, isDark, bitDepth)}</div>
  <div class="stat-block">
    <div class="stat-header">min/avg/max</div>
    <div class="stat-row">${statsLine(pressEntry.stats, 0)}</div>
  </div>
</div>`
    : '';

  return `<section class="panel panel-wind">
  <div class="panel-title">WIND</div>
  <div class="wind-top">
    <div class="wind-compass">${windArrowSvg(arrowAngle, isDark, bitDepth)}</div>
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

function renderNavigation(data) {
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

function renderDepth(data) {
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

function renderBattery(data) {
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

function renderEnvironment(data) {
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
  const is2bit = bitDepth >= 2;
  const bg0   = isDark ? '#0a0a0a' : '#ffffff';
  const bg1   = isDark ? '#141414' : '#f8f8f8';
  // In 2-bit mode snap colours to the 4 available e-ink palette levels (0/85/170/255)
  // to avoid Floyd-Steinberg dithering on solid UI elements.
  const bg2   = is2bit ? (isDark ? '#000000' : '#aaaaaa') : (isDark ? '#1e1e1e' : '#f0f0f0');
  const text0 = is2bit ? (isDark ? '#ffffff' : '#000000') : (isDark ? '#f2f2f2' : '#0a0a0a');
  const text1 = is2bit ? (isDark ? '#aaaaaa' : '#555555') : (isDark ? '#c0c0c0' : '#333333');
  const text2 = is2bit ? (isDark ? '#555555' : '#aaaaaa') : (isDark ? '#808080' : '#666666');
  const border= is2bit ? (isDark ? '#555555' : '#aaaaaa') : (isDark ? '#2e2e2e' : '#d8d8d8');
  const good  = is2bit ? (isDark ? '#aaaaaa' : '#555555') : (isDark ? '#66bb6a' : '#1b6b1f');
  const warn  = is2bit ? (isDark ? '#555555' : '#aaaaaa') : (isDark ? '#ffa726' : '#a0620b');
  const alert = is2bit ? (isDark ? '#ffffff' : '#000000') : (isDark ? '#ef5350' : '#b71c1c');
  // Badge colours snapped to palette for 2-bit (colours become arbitrary greys at 4 levels)
  const stbdColor = is2bit ? (isDark ? '#aaaaaa' : '#555555') : (isDark ? '#66bb6a' : '#1b6b1f');
  const portColor = is2bit ? (isDark ? '#ffffff' : '#000000') : (isDark ? '#ef5350' : '#b71c1c');
  // Footer background
  const footerBg  = is2bit ? (isDark ? '#000000' : '#ffffff') : (isDark ? '#000' : '#f4f4f4');
  // Font smoothing — grayscale mode maps cleanly to the 4-level palette; avoid subpixel RGB
  const fontSmoothing = is2bit ? '-webkit-font-smoothing:grayscale;-moz-osx-font-smoothing:grayscale;' : '';

  return `
*{box-sizing:border-box;margin:0;padding:0}
body{
  width:800px;height:480px;overflow:hidden;
  background:${bg0};color:${text0};
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  font-size:12px;line-height:1.3;
  ${fontSmoothing}
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
.side-badge.stbd{background:transparent;color:${stbdColor};border-color:${stbdColor}}
.side-badge.port{background:transparent;color:${portColor};border-color:${portColor}}

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
  background:${footerBg};
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

  const windHtml = renderWind(data, isDark, bitDepth);
  const navHtml  = renderNavigation(data);
  const depHtml  = renderDepth(data);
  const batHtml  = renderBattery(data);
  const envHtml  = renderEnvironment(data);

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

// ─── Browser preview page ─────────────────────────────────────────────────────

/**
 * Build a browser-friendly live dashboard page.
 *
 * The returned HTML is a complete self-contained page that uses client-side JS
 * to fetch real-time data from GET /api/metrics, rendering all panels and
 * auto-refreshing every 30 seconds. Unlike renderDashboard(), this page is NOT
 * constrained to 800×480 or the e-ink colour palette.
 *
 * @param {string} vesselName  — displayed in the page header
 * @returns {string}           — complete HTML string
 */
export function buildPreviewPage(vesselName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${vesselName} \xb7 Live Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#f0f2f5;color:#1a1a1a;min-height:100vh;display:flex;flex-direction:column}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 24px;background:#0a0a0a;color:#fff;position:sticky;top:0;z-index:10;gap:12px}
.vessel{font-size:20px;font-weight:700;letter-spacing:0.08em}
.header-right{display:flex;align-items:center;gap:14px}
.status{font-size:12px;padding:4px 10px;border-radius:10px;background:rgba(255,255,255,0.1);transition:background 0.3s,color 0.3s}
.status.ok{background:rgba(34,197,94,0.25);color:#86efac}
.status.error{background:rgba(239,68,68,0.25);color:#fca5a5}
.status.loading{color:#d1d5db}
.refresh-btn{background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);color:#fff;padding:5px 14px;border-radius:6px;cursor:pointer;font-size:13px}
.refresh-btn:hover{background:rgba(255,255,255,0.22)}
.render-links{display:flex;gap:6px}
.render-link{background:transparent;border:1px solid rgba(255,255,255,0.25);color:#ccc;padding:4px 10px;border-radius:5px;text-decoration:none;font-size:11px;font-weight:600;letter-spacing:0.04em}
.render-link:hover{background:rgba(255,255,255,0.1);color:#fff}
.dashboard{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;padding:20px;flex:1}
.card{background:#fff;border-radius:10px;padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,0.08),0 0 0 1px rgba(0,0,0,0.04)}
.card-title{font-size:10px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#888;border-bottom:1px solid #eee;padding-bottom:8px;margin-bottom:14px}
.big-row{display:flex;align-items:baseline;gap:8px;margin-bottom:10px}
.mid-row{display:flex;align-items:baseline;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.lbl{font-size:10px;font-weight:700;color:#999;letter-spacing:0.1em;min-width:36px}
.big{font-size:52px;font-weight:200;font-variant-numeric:tabular-nums;line-height:1}
.mid{font-size:30px;font-weight:400;font-variant-numeric:tabular-nums}
.unit{font-size:16px;color:#666}
.bear{font-size:14px;color:#666;margin-left:2px}
.badge{font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;border:1px solid}
.badge.stbd{color:#16a34a;border-color:#16a34a;background:#f0fdf4}
.badge.port{color:#dc2626;border-color:#dc2626;background:#fef2f2}
.divider{height:1px;background:#eee;margin:10px 0}
.stat-block{margin-top:6px}
.stat-lbl{font-size:11px;font-weight:600;color:#aaa;margin-right:6px}
.stat-row{font-size:12px;color:#666;margin-top:2px;font-variant-numeric:tabular-nums}
.mn{color:#2563eb;font-weight:500}
.av{color:#1a1a1a;font-weight:600}
.mx{color:#dc2626;font-weight:500}
.sep{color:#bbb;padding:0 2px}
.nil{color:#aaa;font-style:italic}
.dual{display:flex}
.dual-item{flex:1;text-align:center;padding:6px 8px}
.dual-sep{width:1px;background:#eee;margin:6px 0}
.dual-lbl{font-size:10px;font-weight:700;color:#999;letter-spacing:0.1em;margin-bottom:6px}
.dual-val{font-size:36px;font-weight:300;font-variant-numeric:tabular-nums;line-height:1.1}
.small-unit{font-size:14px;color:#666}
.battery-grid{display:flex}
.bank{flex:1;text-align:center;padding:6px 8px}
.bank-sep{width:1px;background:#eee;margin:6px 0}
.bank-name{font-size:10px;font-weight:700;color:#999;letter-spacing:0.1em;margin-bottom:6px}
.bank-v{font-size:36px;font-weight:300;font-variant-numeric:tabular-nums;line-height:1.1}
.bank-v.good{color:#16a34a}
.bank-v.warn{color:#d97706}
.bank-v.alert{color:#dc2626}
.bank-i{font-size:15px;color:#555;font-variant-numeric:tabular-nums;margin-top:2px}
.press-section{margin-top:14px;padding-top:12px;border-top:1px solid #eee}
.press-chart{margin:6px 0;line-height:0}
footer{display:flex;justify-content:space-between;padding:10px 24px;font-size:11px;color:#aaa;background:#e8eaed;border-top:1px solid #ddd}
</style>
</head>
<body>
<header>
  <div class="vessel">&#9875; ${vesselName}</div>
  <div class="header-right">
    <span id="status" class="status loading">Loading\u2026</span>
    <div class="render-links">
      <a class="render-link" href="/api/render/png" target="_blank">PNG (2-bit)</a>
      <a class="render-link" href="/api/render/bmp" target="_blank">BMP (1-bit)</a>
    </div>
    <button class="refresh-btn" onclick="doRefresh()">&#8635; Refresh</button>
  </div>
</header>
<div id="dashboard" class="dashboard"></div>
<footer>
  <span id="footer-updated">\u2014</span>
  <span id="footer-window">\u2014</span>
</footer>
<script>
(function() {
  'use strict';

  function fmt(v, dp) {
    return (v == null || isNaN(v)) ? '\u2014' : Number(v).toFixed(dp);
  }

  function statsRow(s, dp) {
    if (!s) return '<span class="nil">\u2014</span>';
    return '<span class="mn">' + fmt(s.min, dp) + '</span>' +
           '<span class="sep"> \xb7 </span>' +
           '<span class="av">' + fmt(s.mean, dp) + '</span>' +
           '<span class="sep"> \xb7 </span>' +
           '<span class="mx">' + fmt(s.max, dp) + '</span>';
  }

  function bearing(deg) {
    if (deg == null) return '\u2014';
    var labels = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return labels[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  }

  function normalise(deg) {
    if (deg == null) return { a: null, s: '' };
    var a = ((deg % 360) + 360) % 360;
    return a > 180 ? { a: 360 - a, s: 'PORT' } : { a: a, s: 'STBD' };
  }

  function badge(side) {
    if (!side) return '';
    return '<span class="badge ' + (side === 'STBD' ? 'stbd' : 'port') + '">' + side + '</span>';
  }

  function sparklineSvg(series) {
    if (!series || series.length < 2) return '';
    var W = 240, H = 44;
    var vs = series.map(function(p) { return p.v; });
    var yMin = Math.min.apply(null, vs), yMax = Math.max.apply(null, vs);
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    var tMin = series[0].t, tMax = series[series.length - 1].t;
    function toX(t) { return ((t - tMin) / (tMax - tMin || 1)) * (W - 2) + 1; }
    function toY(v) { return H - 2 - ((v - yMin) / (yMax - yMin)) * (H - 4); }
    var pts = series.map(function(p) { return toX(p.t).toFixed(1) + ',' + toY(p.v).toFixed(1); }).join(' ');
    var last = series[series.length - 1];
    var lx = toX(last.t).toFixed(1), ly = toY(last.v).toFixed(1);
    return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<polygon points="1,' + H + ' ' + pts + ' ' + lx + ',' + H + '" fill="rgba(59,130,246,0.12)" stroke="none"/>' +
      '<polyline points="' + pts + '" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + lx + '" cy="' + ly + '" r="2.5" fill="#2563eb"/>' +
      '<text x="2" y="' + (H - 2) + '" font-size="8" font-family="system-ui,sans-serif" fill="#aaa">12h ago</text>' +
      '<text x="' + (W - 2) + '" y="' + (H - 2) + '" font-size="8" font-family="system-ui,sans-serif" fill="#aaa" text-anchor="end">now</text>' +
      '</svg>';
  }

  function card(title, body) {
    return '<div class="card"><div class="card-title">' + title + '</div>' + body + '</div>';
  }

  function renderWind(d) {
    if (!d.wind) return card('WIND', '<p class="nil">No data</p>');
    var w = d.wind;
    var awLast  = w.apparentSpeed  && w.apparentSpeed.stats  ? w.apparentSpeed.stats.last  : null;
    var awaLast = w.apparentAngle  && w.apparentAngle.stats  ? w.apparentAngle.stats.last  : null;
    var twLast  = w.trueSpeed      && w.trueSpeed.stats      ? w.trueSpeed.stats.last      : null;
    var twaDeg  = w.trueAngle      && w.trueAngle.stats      ? w.trueAngle.stats.last      : null;
    var awa = normalise(awaLast);
    var twa = normalise(twaDeg);
    return card('WIND',
      '<div class="big-row">' +
        '<span class="lbl">AWS</span>' +
        '<span class="big">' + fmt(awLast, 1) + '</span>' +
        '<span class="unit">kts</span>' +
      '</div>' +
      '<div class="mid-row">' +
        '<span class="lbl">AWA</span>' +
        '<span class="mid">' + fmt(awa.a, 0) + '\xb0</span>' +
        badge(awa.s) +
      '</div>' +
      '<div class="stat-block">' +
        '<div class="stat-row"><span class="stat-lbl">AWS min\xb7avg\xb7max</span>' + statsRow(w.apparentSpeed && w.apparentSpeed.stats, 1) + ' kts</div>' +
        '<div class="stat-row"><span class="stat-lbl">AWA min\xb7avg\xb7max</span>' + statsRow(w.apparentAngle && w.apparentAngle.stats, 0) + '\xb0</div>' +
      '</div>' +
      '<div class="divider"></div>' +
      '<div class="mid-row">' +
        '<span class="lbl">TWS</span><span class="mid">' + fmt(twLast, 1) + '</span><span class="unit">kts</span>' +
        '<span class="lbl" style="margin-left:14px">TWA</span><span class="mid">' + fmt(twa.a, 0) + '\xb0</span>' +
        badge(twa.s) +
      '</div>' +
      '<div class="stat-block">' +
        '<div class="stat-row"><span class="stat-lbl">TWS min\xb7avg\xb7max</span>' + statsRow(w.trueSpeed && w.trueSpeed.stats, 1) + ' kts</div>' +
        '<div class="stat-row"><span class="stat-lbl">TWA min\xb7avg\xb7max</span>' + statsRow(w.trueAngle && w.trueAngle.stats, 0) + '\xb0</div>' +
      '</div>'
    );
  }

  function renderNavigation(d) {
    if (!d.navigation) return card('NAVIGATION', '<p class="nil">No data</p>');
    var n = d.navigation;
    var sog = n.sog     && n.sog.stats     ? n.sog.stats.last     : null;
    var cog = n.cog     && n.cog.stats     ? n.cog.stats.last     : null;
    var hdg = n.heading && n.heading.stats ? n.heading.stats.last : null;
    return card('NAVIGATION',
      '<div class="big-row">' +
        '<span class="lbl">SOG</span>' +
        '<span class="big">' + fmt(sog, 1) + '</span>' +
        '<span class="unit">kts</span>' +
      '</div>' +
      '<div class="mid-row">' +
        '<span class="lbl">COG</span><span class="mid">' + fmt(cog, 0) + '\xb0</span>' +
        '<span class="bear">' + bearing(cog) + '</span>' +
        '<span class="lbl" style="margin-left:16px">HDG</span><span class="mid">' + fmt(hdg, 0) + '\xb0</span>' +
        '<span class="bear">' + bearing(hdg) + '</span>' +
      '</div>' +
      '<div class="stat-block">' +
        '<div class="stat-row"><span class="stat-lbl">SOG min\xb7avg\xb7max</span>' + statsRow(n.sog && n.sog.stats, 1) + ' kts</div>' +
        '<div class="stat-row"><span class="stat-lbl">COG min\xb7avg\xb7max</span>' + statsRow(n.cog && n.cog.stats, 0) + '\xb0</div>' +
      '</div>'
    );
  }

  function renderDepth(d) {
    if (!d.depth) return card('DEPTH & WATER', '<p class="nil">No data</p>');
    var dep   = d.depth;
    var depth = dep.belowKeel && dep.belowKeel.stats ? dep.belowKeel.stats.last : null;
    var wtemp = dep.waterTemp && dep.waterTemp.stats ? dep.waterTemp.stats.last : null;
    return card('DEPTH & WATER',
      '<div class="dual">' +
        '<div class="dual-item">' +
          '<div class="dual-lbl">DEPTH</div>' +
          '<div class="dual-val">' + fmt(depth, 1) + '<span class="small-unit"> m</span></div>' +
          '<div class="stat-row">' + statsRow(dep.belowKeel && dep.belowKeel.stats, 1) + ' m</div>' +
        '</div>' +
        '<div class="dual-sep"></div>' +
        '<div class="dual-item">' +
          '<div class="dual-lbl">WATER TEMP</div>' +
          '<div class="dual-val">' + fmt(wtemp, 1) + '<span class="small-unit"> \xb0C</span></div>' +
          '<div class="stat-row">' + statsRow(dep.waterTemp && dep.waterTemp.stats, 1) + ' \xb0C</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderBattery(d) {
    var banks = (d._banksMeta) || [];
    if (!d.battery || !banks.length) return card('BATTERY', '<p class="nil">No data</p>');
    var html = banks.map(function(bank) {
      var bk = d.battery[bank.id + '_voltage'];
      var bi = d.battery[bank.id + '_current'];
      var v  = bk && bk.stats ? bk.stats.last : null;
      var i  = bi && bi.stats ? bi.stats.last : null;
      var vc = v == null ? '' : v >= 12.6 ? 'good' : v >= 12.2 ? 'warn' : 'alert';
      return '<div class="bank">' +
        '<div class="bank-name">' + bank.label + '</div>' +
        '<div class="bank-v ' + vc + '">' + fmt(v, 1) + '<span class="small-unit"> V</span></div>' +
        (i != null ? '<div class="bank-i">' + (i >= 0 ? '+' : '') + fmt(i, 1) + ' A</div>' : '') +
        '<div class="stat-row">' + statsRow(bk && bk.stats, 1) + ' V</div>' +
      '</div>';
    }).join('<div class="bank-sep"></div>');
    return card('BATTERY', '<div class="battery-grid">' + html + '</div>');
  }

  function renderEnvironment(d) {
    var cabin    = d.environment && d.environment.insideTemp && d.environment.insideTemp.stats
      ? d.environment.insideTemp.stats.last : null;
    var pressure = d.environment && d.environment.outsidePressure;
    var pressHtml = '';
    if (pressure) {
      pressHtml =
        '<div class="press-section">' +
          '<div class="card-title" style="border:none;padding-bottom:4px;margin-bottom:4px">PRESSURE \xb7 12h (hPa)</div>' +
          (pressure.series ? '<div class="press-chart">' + sparklineSvg(pressure.series) + '</div>' : '') +
          '<div class="stat-row">min\xb7avg\xb7max: ' + statsRow(pressure.stats, 0) + ' hPa</div>' +
          '<div class="stat-row" style="margin-top:4px">Now: <strong>' + fmt(pressure.stats && pressure.stats.last, 0) + ' hPa</strong></div>' +
        '</div>';
    }
    return card('ENVIRONMENT',
      '<div class="big-row">' +
        '<span class="lbl">CABIN</span>' +
        '<span class="big">' + fmt(cabin, 1) + '</span>' +
        '<span class="unit">\xb0C</span>' +
      '</div>' +
      '<div class="stat-row"><span class="stat-lbl">min\xb7avg\xb7max</span>' + statsRow(d.environment && d.environment.insideTemp && d.environment.insideTemp.stats, 1) + ' \xb0C</div>' +
      pressHtml
    );
  }

  function renderAll(data) {
    var html = renderWind(data) +
               renderNavigation(data) +
               renderDepth(data) +
               renderBattery(data) +
               renderEnvironment(data);
    document.getElementById('dashboard').innerHTML = html;
    document.getElementById('footer-window').textContent = 'Window: ' + (data._window || '\u2014');
    document.getElementById('footer-updated').textContent = 'Updated: ' + new Date().toLocaleTimeString();
  }

  var refreshTimer = null;

  function doRefresh() {
    var statusEl = document.getElementById('status');
    statusEl.textContent = 'Refreshing\u2026';
    statusEl.className = 'status loading';
    fetch('/api/metrics')
      .then(function(res) {
        if (!res.ok) return res.text().then(function(t) { throw new Error('HTTP ' + res.status + ': ' + t); });
        return res.json();
      })
      .then(function(data) {
        renderAll(data);
        statusEl.textContent = '\u25cf Live';
        statusEl.className = 'status ok';
      })
      .catch(function(err) {
        statusEl.textContent = '\u2717 ' + err.message;
        statusEl.className = 'status error';
      });
  }

  window.doRefresh = doRefresh;

  doRefresh();
  refreshTimer = setInterval(doRefresh, 30000);
})();
</script>
</body>
</html>`;
}
