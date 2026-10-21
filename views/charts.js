import { esc } from './format.js';

let chartNumber = 0;

// Small hand-built SVG charts. Colours come from CSS classes so both themes work.
const W = 640;
const H = 220;
const P = { l: 52, r: 12, t: 12, b: 28 };

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

function short(v, money) {
  const s = v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `${Math.round(v)}`;
  return money ? `RM${s}` : s;
}

function legend(items) {
  return `<div class="legend">${items.map(([label, cls]) => `<span><i class="key ${cls}"></i>${label}</span>`).join('')}</div>`;
}

function hourLabel(h) {
  return h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
}

export function barChart24({ a, b, shade = [], aLabel, bLabel }) {
  const patternId = `visitor-series-${++chartNumber}`;
  const max = niceMax(Math.max(...a.map((v, i) => v + b[i]), 1));
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;
  const bw = iw / 24;
  const y = (v) => P.t + ih - (v / max) * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(aLabel)} and ${esc(bLabel)}, kWh by hour of day">
    <defs><pattern id="${patternId}" patternUnits="userSpaceOnUse" width="6" height="6"><rect width="6" height="6" fill="#3676A2"/><path d="M-1 1 1-1M0 6 6 0M5 7 7 5" stroke="#A8DDF6" stroke-width="1.2"/></pattern></defs>`;
  for (const h of shade) s += `<rect x="${P.l + h * bw}" y="${P.t}" width="${bw}" height="${ih}" class="shade"/>`;
  for (const t of [0, max / 2, max]) {
    s += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/>`;
    s += `<text x="${P.l - 6}" y="${y(t) + 4}" class="axis" text-anchor="end">${short(t, false)} kWh</text>`;
  }
  a.forEach((v, i) => {
    const x = P.l + i * bw + 2;
    const w = Math.max(1, bw - 4);
    s += `<rect x="${x}" y="${y(v)}" width="${w}" height="${P.t + ih - y(v)}" class="sa"/>`;
    s += `<rect x="${x}" y="${y(v + b[i])}" width="${w}" height="${y(v) - y(v + b[i])}" class="sb" style="fill:url(#${patternId})"/>`;
  });
  for (const h of [0, 6, 12, 18]) s += `<text x="${P.l + h * bw + bw / 2}" y="${H - 8}" class="axis" text-anchor="middle">${hourLabel(h)}</text>`;
  return `<div class="chart-scroll" tabindex="0" role="region" aria-label="Hourly charging chart, scroll horizontally on small screens">${s}</svg></div>${legend([[aLabel + ' (solid)', 'sa'], [bLabel + ' (hatched)', 'sb']])}
    <details class="chart-values"><summary>View hourly data</summary><div class="tbl"><table><caption>Existing hourly series, kWh. Shading on the chart identifies peak hours.</caption>
    <thead><tr><th scope="col">Hour</th><th scope="col">${esc(aLabel)} (kWh)</th><th scope="col">${esc(bLabel)} (kWh)</th></tr></thead>
    <tbody>${a.map((value, i) => `<tr><th scope="row">${hourLabel(i)}</th><td>${esc(value)}</td><td>${esc(b[i])}</td></tr>`).join('')}</tbody></table></div></details>`;
}

export function lineChart({ labels, series, money = true, unit = '', ariaLabel = 'Monthly income by source' }) {
  const max = niceMax(Math.max(...series.flatMap((se) => se.values), 1));
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;
  const x = (i) => P.l + (labels.length === 1 ? iw / 2 : (i * iw) / (labels.length - 1));
  const y = (v) => P.t + ih - (v / max) * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(ariaLabel)}">`;
  for (const t of [0, max / 2, max]) {
    s += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/>`;
    s += `<text x="${P.l - 6}" y="${y(t) + 4}" class="axis" text-anchor="end">${short(t, money)}${unit}</text>`;
  }
  for (const se of series) {
    const d = se.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    s += `<path d="${d}" class="line ${se.cls}"/>`;
    const last = se.values.length - 1;
    s += `<circle cx="${x(last)}" cy="${y(se.values[last])}" r="4" class="dot ${se.cls}"/>`;
  }
  labels.forEach((l, i) => { s += `<text x="${x(i)}" y="${H - 8}" class="axis" text-anchor="middle">${l}</text>`; });
  return `<div class="chart-scroll" tabindex="0" role="region" aria-label="${esc(ariaLabel)}, scroll horizontally on small screens">${s}</svg></div>${legend(series.map((se) => [se.label + (se.cls === 'lb' ? ' (dashed)' : ' (solid)'), se.cls]))}
    <details class="chart-values"><summary>View chart data</summary><div class="tbl"><table><caption>${esc(ariaLabel)}. Values in ${money ? 'RM' : esc(unit || 'the chart units')}, using the same source series.</caption>
    <thead><tr><th scope="col">Period</th>${series.map((se) => `<th scope="col">${esc(se.label)}</th>`).join('')}</tr></thead>
    <tbody>${labels.map((label, i) => `<tr><th scope="row">${esc(label || `Period ${i + 1}`)}</th>${series.map((se) => `<td>${esc(se.values[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
