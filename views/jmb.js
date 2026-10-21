import { CONST } from '../config.js';
import { TNB } from '../data/tariff.js';
import { simulateCondoMonth, rampSeries } from '../engine/economics.js';
import { validateSharing, isOpenToVisitors } from '../engine/sharing.js';
import { describeSharing, proposalFor, proposalHtml, bindProposal, propose } from './governance.js';
import { getToken } from './jmb-shared.js';
import { barChart24, lineChart } from './charts.js';
import { esc, rm, rm0, num, pct, monthLabel } from './format.js';
import { privateSection } from './jmb-shared.js';
import { liveHtml, bindLive } from './jmb-live.js';
import { recoveryHtml, quietHtml, maintenanceHtml, bindMaintenance, reportCsv, downloadCsv } from './jmb-ops.js';
import { bayStatus, maintenanceCost } from '../engine/maintenance.js';
import { filterSessions } from '../engine/insights.js';
import { renderCpo } from './cpo.js';

let condoId = null;
const PEAK_HOURS = Array.from({ length: TNB.peakEndHour - TNB.peakStartHour }, (_, i) => TNB.peakStartHour + i);

export function renderJmb(root, ctx) {
  if (location.hash === '#cpo') { renderCpo(root, ctx); return; }
  const { condos, chargers } = ctx.world;
  const fromUrl = location.hash.slice(1);
  if (condos.some((c) => c.id === fromUrl)) condoId = fromUrl;
  if (!condos.some((c) => c.id === condoId)) condoId = condos[0].id;
  const condo = condos.find((c) => c.id === condoId);
  const charger = chargers.find((ch) => ch.condoId === condo.id);
  const start = new Date(ctx.clock.getFullYear(), ctx.clock.getMonth(), 1);
  const priv = privateSection(condo, charger, ctx);
  const token = ctx.api ? getToken(condo.id) : null;
  const entries = priv.maintenance;
  const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 1).getTime();
  const maintenanceRm = entries ? maintenanceCost(entries, start.getTime(), monthEnd) : 0;
  const sim = simulateCondoMonth(condo, charger, start, { maintenanceRm });
  const s = condo.sharing;
  const vote = proposalFor(ctx, condo);
  // Auto vs fixed hours for this condo: hours open on a typical weekday and the JMB's monthly income.
  const day = new Date(2026, 9, 21);
  const openHours = (sh) => Array.from({ length: 24 }, (_, h) => isOpenToVisitors({ ...condo, sharing: sh }, new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, 30))).filter(Boolean).length;
  const asMode = (mode) => ({ ...s, enabled: true, mode, days: s.days });
  const simAuto = simulateCondoMonth({ ...condo, sharing: asMode('auto') }, charger, start, { maintenanceRm });
  const simHours = simulateCondoMonth({ ...condo, sharing: asMode('hours') }, charger, start, { maintenanceRm });
  const gain = simAuto.jmbIncome - simHours.jmbIncome;
  const autoHtml = `<div class="auto-compare">
    <p><b>Auto sharing vs fixed hours</b> (simulated month)</p>
    <div class="cmp"><div><span>Fixed ${s.start}:00–${s.end}:00</span><b>${rm0(simHours.jmbIncome)}</b><small>${openHours(asMode('hours'))} h open on a weekday</small></div>
      <div class="win"><span>Auto</span><b>${rm0(simAuto.jmbIncome)}</b><small>${openHours(asMode('auto'))} h open on a weekday</small></div></div>
    <p class="muted">${gain > 0 ? `Auto would add about <b>${rm0(gain)}</b> a month for the JMB` : 'Fixed hours already cover the idle time'}, still keeping ${s.reservedBays} bays for residents and closing before the evening rush.</p>
  </div>`;
  const sinkingYear = 0.1 * condo.monthlyFee * condo.units * 12;
  const boost = (sim.jmbIncome * 12) / sinkingYear;
  const months = Array.from({ length: 6 }, (_, i) => monthLabel(new Date(start.getFullYear(), start.getMonth() - 5 + i, 1)));
  const checkins = (ctx.checkins || ctx.state.checkins)[charger.id] || [];
  const problems = checkins.filter((c) => !c.ok);

  const bays = entries ? bayStatus(entries, condo.bays) : null;
  const SECTIONS = [['j-s-overview', 'Overview'], ['j-s-sharing', 'Sharing'], ['j-s-money', 'Cost recovery'], ['j-s-live', 'Live chargers'], ['j-s-health', 'Charger health'], ['j-s-private', 'Visitors & drivers']];
  root.innerHTML = `
  <div class="portal">
  <nav class="side" aria-label="Dashboard sections">${SECTIONS.map(([id, l]) => `<button type="button" data-jump="${id}">${l}</button>`).join('')}</nav>
  <div class="jmb">
    <div class="view-head">
      <div><p class="eyebrow">JMB dashboard · ${esc(start.toLocaleString('en-MY', { month: 'long', year: 'numeric' }))}</p>
        <h2>${esc(condo.name)}</h2>
        <p class="muted">${condo.units} units · ${condo.bays} charging bays · the JMB keeps ${pct(condo.jmbShare)} of the margin, the charging partner keeps the rest</p></div>
      <label class="field inline">Condo <select id="j-condo"><option value="cpo">CPO: all sites</option>${condos.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
    </div>

    <div class="kpis" id="j-s-overview">
      <div class="kpi"><span>Charging income this month</span><b>${rm0(sim.revenue)}</b></div>
      <div class="kpi"><span>JMB share after all costs</span><b>${rm0(sim.jmbIncome)}</b></div>
      <div class="kpi hero"><span>Saving per unit per month</span><b>${rm(sim.perUnitSaving)}</b></div>
      <div class="kpi"><span>Energy delivered</span><b>${num(sim.kWhSold)} kWh</b></div>
    </div>

    <div class="grid2">
      <section class="card"><h3>An average day: who charges when</h3>
        ${barChart24({ a: sim.residentByHour, b: sim.visitorByHour, shade: PEAK_HOURS, aLabel: 'Residents', bLabel: 'Outside drivers (shared bays)' })}
        <p class="muted">Shaded hours are TNB peak (weekdays 2–10 PM). Residents charge in the evening; outside drivers fill the bays they leave empty during the day.</p>
        ${quietHtml(condo, charger, sim)}
      </section>
      <section class="card"><h3>Charging income, last 6 months</h3>
        ${lineChart({ labels: months, series: [
          { label: 'From residents', values: rampSeries(sim.residentRevenue), cls: 'la' },
          { label: 'From outside drivers', values: rampSeries(sim.visitorRevenue), cls: 'lb' },
        ] })}
        <p class="muted">Simulated ramp-up as more residents switch to EVs.</p>
      </section>
    </div>

    <div class="grid2">
      <section class="card"><h3>What it means for owners</h3>
        <p class="big">Monthly fee held at <b>${rm0(condo.monthlyFee)}</b> instead of <b>${rm(condo.monthlyFee + sim.perUnitSaving)}</b>.</p>
        <p>Or add it to the sinking fund: <b>+${rm0(sim.jmbIncome * 12)} a year</b>, ${pct(boost)} on top of owners' contributions of ${rm0(sinkingYear)}.</p>
        <div class="bar" role="img" aria-label="Sinking fund boost ${pct(boost)}"><span style="width:${Math.min(100, boost * 100)}%"></span></div>
        <p class="muted">Hardware payback on ${condo.bays} bays at ${rm0(CONST.hardwarePerBay)} each: ${sim.paybackMonths ? `${sim.paybackMonths} months` : 'not reached at these prices'}. CO₂ avoided: ${num(sim.co2AvoidedKg)} kg this month.</p>
        <button id="j-report" class="btn small" type="button">Download monthly report (CSV)</button>
      </section>
      <section class="card" id="j-s-sharing"><h3>Sharing with outside drivers</h3>
        <p class="inforce"><span class="chip ${s.enabled ? 'on' : 'off'}">${s.enabled ? 'In force' : 'Paused'}</span> ${esc(describeSharing({ ...s, enabled: true }))}</p>
        ${priv.canEdit ? `<div class="btn-row"><button type="button" class="btn small" id="j-pause">${s.enabled ? 'Pause sharing now' : 'Resume sharing'}</button></div>
          <p class="muted">Pausing or resuming takes effect at once. Any other change goes to a resident vote.</p>` : '<p class="muted">Log in with the condo PIN below to pause sharing or propose a change.</p>'}
        ${autoHtml}
        ${proposalHtml(condo, vote, 'jmb', priv.canEdit)}
        <p class="error vote-err" role="alert" hidden></p>
        ${priv.canEdit && vote.proposal?.status !== 'open' ? `<details class="propose"><summary>Propose a change to residents</summary>
        <form id="j-share" class="form" novalidate>
          <label class="field">Sharing mode <select id="j-mode"><option value="auto">Auto: share whenever bays are idle</option><option value="hours">Fixed hours</option></select></label>
          <label class="field">Days <select id="j-days">
            <option value="weekdays">Weekdays</option><option value="weekends">Weekends</option><option value="all">Every day</option></select></label>
          <div class="row" id="j-hours">
            <label class="field">Opens (hour) <input id="j-start" type="number" min="0" max="23" step="1" value="${s.start}"></label>
            <label class="field">Closes (hour) <input id="j-end" type="number" min="1" max="24" step="1" value="${s.end}"></label>
          </div>
          <div class="row">
            <label class="field">Bays always kept for residents <input id="j-res" type="number" min="0" max="${condo.bays}" step="1" value="${s.reservedBays}"></label>
            <label class="field">Visitor price (RM/kWh) <input id="j-price" type="number" min="0.5" max="3" step="0.05" value="${s.visitorPrice}"></label>
          </div>
          <p id="j-err" class="error" role="alert" hidden></p>
          <button class="btn primary" type="submit">Put to a resident vote</button>
          <p class="muted">Residents pay ${rm(condo.residentPrice)}/kWh. TNB peak hours add ${rm(condo.peakSurcharge)}. The vote runs 7 days; the JMB can close it early.</p>
        </form></details>` : ''}
      </section>
    </div>

    <div class="grid2" id="j-s-money">
      ${recoveryHtml(condo, sim)}
      ${maintenanceHtml(condo, entries, priv.canEdit, ctx.clock)}
    </div>

    <div id="j-s-live">${liveHtml(condo, ctx)}</div>

    <section class="card" id="j-s-health"><h3>Charger health</h3>
      <p class="muted">Reliability ${pct(charger.reliability)} · ${checkins.length} check-ins ${ctx.api ? 'shared by all drivers' : 'from drivers on this device'}.</p>
      <div class="tbl"><table>
        <thead><tr><th>Bay</th><th>Status</th><th>Latest report</th></tr></thead>
        <tbody>${Array.from({ length: condo.bays }, (_, i) => {
          const b = bays ? bays[i] : null;
          if (b?.status === 'fault') return `<tr><td>Bay ${i + 1}</td><td><span class="chip warn">Out of service</span></td><td>${esc(b.last.note || 'Fault logged by the JMB')}</td></tr>`;
          const p = problems[problems.length - 1 - i];
          return `<tr><td>Bay ${i + 1}</td><td>${p ? '<span class="chip warn">Problem reported</span>' : '<span class="chip on">Working</span>'}</td><td>${p ? esc(p.note || 'No details given') : '—'}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
    </section>
    <div id="j-s-private">
      ${priv.html}

      ${ctx.api && priv.canEdit ? `
        <section class="card">
          <h3>Resident Access Management</h3>

          <p class="muted">
            Issue an access key only after verifying
            that the applicant is a resident of this condominium.
          </p>

          <button
            type="button"
            class="btn primary"
            id="j-issue-key">
            Generate Resident Key
          </button>

          <p id="j-key-result"
            class="muted"
            aria-live="polite"
            hidden></p>
        </section>
      ` : ''}
    </div>
  </div>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  $('#j-condo').value = condo.id;
  $('#j-condo').addEventListener('change', (e) => { if (e.target.value === 'cpo') { location.hash = '#cpo'; return; } condoId = e.target.value; history.replaceState(null, '', `#${condoId}`); ctx.rerender(); });
  root.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => document.getElementById(b.dataset.jump)?.scrollIntoView({ block: 'start' })));
  bindProposal(root, ctx, condo, token);
  root.querySelector('#j-pause')?.addEventListener('click', async () => {
    const next = { ...s, enabled: !s.enabled };
    if (priv.save) { const r = await priv.save(next); if (!r.ok) alert(r.error); return; }
    ctx.state.sharing[condo.id] = next;
    ctx.save();
    ctx.rerender();
  });
  const form = root.querySelector('#j-share');
  if (form) {
    form.querySelector('#j-mode').value = s.mode === 'hours' ? 'hours' : 'auto';
    form.querySelector('#j-days').value = s.days;
    const syncHours = () => { form.querySelector('#j-hours').hidden = form.querySelector('#j-mode').value === 'auto'; };
    syncHours();
    form.querySelector('#j-mode').addEventListener('change', syncHours);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const next = {
        enabled: true,
        mode: form.querySelector('#j-mode').value,
        days: form.querySelector('#j-days').value,
        start: Number(form.querySelector('#j-start').value),
        end: Number(form.querySelector('#j-end').value),
        reservedBays: Number(form.querySelector('#j-res').value),
        visitorPrice: Number(form.querySelector('#j-price').value),
      };
      const box = form.querySelector('#j-err');
      const err = validateSharing(next, condo.bays);
      if (err) { box.textContent = err; box.hidden = false; return; }
      const r = await propose(ctx, condo, next, token);
      if (!r.ok) { box.textContent = r.error; box.hidden = false; }
    });
  }
  priv.bind(root);
  const issueBtn = $('#j-issue-key');

    issueBtn?.addEventListener('click', async () => {
      issueBtn.disabled = true;

      const output = $('#j-key-result');

      const result = await ctx.api.issueResidentKey(
        condo.id,
        token
      );

      output.hidden = false;

      if (result.ok) {
        output.textContent =
          `Resident key (copy now): ${result.data.residentKey}`;
      } else {
        output.textContent =
          `Could not issue key: ${result.error}`;
      }

      issueBtn.disabled = false;
    });
  bindMaintenance(root, condo, ctx, priv.addMaintenance);
  bindLive(root, condo, ctx);
  $('#j-report').addEventListener('click', () => {
    const sessions = priv.sessions ? filterSessions(priv.sessions, { from: start.getTime(), to: monthEnd }).length : 'n/a (log in)';
    const month = start.toLocaleString('en-MY', { month: 'long', year: 'numeric' });
    downloadCsv(`cassama-${condo.id}-report-${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}.csv`, reportCsv(condo, charger, sim, { month, sessions, entries }));
  });
}
