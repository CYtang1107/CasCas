// Live charger status over OCPP 1.6: status per bay, power against the smart-charging cap,
// and the condo's total load against its safe limit. Polls while the card is on screen.
import { getToken, forgetJmb } from './jmb-shared.js';
import { esc, num } from './format.js';

const POLL_MS = 5000;
const CHIP = { Charging: 'on', Available: '', Faulted: 'warn' };
let timer = null;
let lastFaulted = null;

export function liveHtml(condo, ctx) {
  if (!ctx.api) {
    return `<section class="card live"><div class="card-head"><h3>Live chargers (OCPP 1.6)</h3></div>
      <p class="muted">Live status from the chargers needs the shared server. Run <code>npm start</code> or open the Render demo; this copy works on this device only.</p></section>`;
  }
  return `<section class="card live" id="j-live" data-condo="${esc(condo.id)}"><div class="card-head"><h3>Live chargers (OCPP 1.6)</h3><span class="chip">Connecting…</span></div>
    <p class="loading">Waiting for the chargers…</p></section>`;
}

function body(condo, snap, canAct) {
  const loadPct = snap.limitKw ? Math.min(100, (snap.loadKw / snap.limitKw) * 100) : 0;
  const s = snap.summary;
  const rows = Array.from({ length: condo.bays }, (_, i) => {
    const p = snap.points.find((x) => x.bay === i + 1);
    if (!p) return `<tr><td>Bay ${i + 1}</td><td><span class="chip">Offline</span></td><td>—</td><td>—</td><td></td></tr>`;
    const capped = p.status === 'Charging' && p.limitKw < 6.99;
    const act = canAct
      ? (p.status === 'Faulted'
        ? `<button class="btn small" type="button" data-ocpp="clear" data-bay="${p.bay}">Back online</button>`
        : `<button class="btn small" type="button" data-ocpp="fault" data-bay="${p.bay}">Simulate fault</button>`)
      : '';
    return `<tr><td>Bay ${p.bay}</td><td><span class="chip ${CHIP[p.status] ?? ''}">${esc(p.status)}</span>${p.status === 'Faulted' ? ` <span class="muted">${esc(p.errorCode)}</span>` : ''}</td>
      <td>${p.status === 'Charging' ? `${p.powerKw.toFixed(1)} kW${capped ? ` <span class="muted">(capped at ${p.limitKw.toFixed(1)})</span>` : ''}` : '—'}</td>
      <td>${p.status === 'Charging' ? `${p.sessionKwh.toFixed(1)} kWh` : '—'}</td><td>${act}</td></tr>`;
  }).join('');
  return `<div class="card-head"><h3>Live chargers (OCPP 1.6)</h3><span class="chip on">${snap.simulated ? 'Simulated chargers' : 'Connected'}</span></div>
    <p class="muted">${s.charging} charging · ${s.available} free${s.faulted ? ` · ${s.faulted} faulted` : ''}${s.offline ? ` · ${s.offline} offline` : ''}. Each charger talks OCPP 1.6-J to CasSama: status, meter values and sessions come in; power limits go out.</p>
    <p><b>Site load ${snap.loadKw.toFixed(1)} kW</b> of a ${num(snap.limitKw)} kW safe limit. When many bays charge, smart charging (SetChargingProfile) lowers each bay's cap so the total stays inside it.</p>
    <div class="bar" role="img" aria-label="Site load ${Math.round(loadPct)}% of the limit"><span style="width:${loadPct}%"></span></div>
    <div class="tbl"><table><thead><tr><th>Bay</th><th>Status</th><th>Power</th><th>This session</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted">A charger that reports Faulted is logged in the maintenance log automatically and taken out of service for drivers.${canAct ? ' Use "Simulate fault" to try it.' : ''}</p>
    <p id="j-live-err" class="error" role="alert" hidden></p>`;
}

export function bindLive(root, condo, ctx) {
  if (timer) clearInterval(timer);
  timer = null;
  const el = root.querySelector('#j-live');
  if (!el || !ctx.api) return;
  lastFaulted = null;

  const tick = async () => {
    const box = document.getElementById('j-live');
    if (!box || box.dataset.condo !== condo.id) { clearInterval(timer); timer = null; return; }
    const r = await ctx.api.ocpp(condo.id);
    if (!r.ok) { box.querySelector('.loading')?.replaceChildren('Live status unavailable right now.'); return; }
    const token = getToken(condo.id);
    box.innerHTML = body(condo, r.data, !!token && r.data.simulated);
    // A new fault means the maintenance log changed: reload the JMB data.
    const f = r.data.summary.faulted;
    if (lastFaulted !== null && f !== lastFaulted) { forgetJmb(condo.id); ctx.refresh(); }
    lastFaulted = f;
  };

  el.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-ocpp]');
    if (!btn) return;
    btn.disabled = true;
    const r = await ctx.api.ocppAction(condo.id, getToken(condo.id), btn.dataset.bay, btn.dataset.ocpp);
    if (!r.ok) { const err = el.querySelector('#j-live-err'); if (err) { err.textContent = r.error; err.hidden = false; } }
    setTimeout(tick, 300);
  });
  tick();
  timer = setInterval(tick, POLL_MS);
}
