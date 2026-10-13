import { APP, CONST } from '../config.js';
import { townshipSummary, scaleUp } from '../engine/economics.js';
import { esc, rm, rm0, num, pct } from './format.js';

let townships = 5;

const PILOT = [
  { label: 'Charging partner (registered operator)', status: 'Lead', cls: 'amber', note: 'The SDP–TNB MoU (Dec 2023) already covers EV charging in SDP townships. Gentari and EV Connection run condo models today.' },
  { label: 'Energy Commission CPO registration', status: 'Partner holds', cls: 'on', note: 'The operator is registered under the EVCS guideline (Feb 2025), so the JMB never resells electricity itself.' },
  { label: 'JMB resolution', status: 'To do', cls: 'off', note: 'Shared bays on common property need a resolution under the Strata Management Act 2013.' },
  { label: 'TNB sub-meter for the bays', status: 'To do', cls: 'off', note: 'Separate metering for the charging bays takes about 4–8 weeks.' },
  { label: 'Bomba and council approval', status: 'To do', cls: 'off', note: 'Required for shared or public-access chargers.' },
  { label: 'Resident and JMB survey', status: 'In progress', cls: 'amber', note: '20–30 residents and 1–2 JMB managers, before 23 Oct 2026.' },
];

export function renderSdp(root, ctx) {
  const start = new Date(ctx.clock.getFullYear(), ctx.clock.getMonth(), 1);
  const { perCondo, totals } = townshipSummary(ctx.world.condos, ctx.world.chargers, start);
  const rows = [...perCondo].sort((a, b) => b.perUnitSaving - a.perUnitSaving);
  const avg = (list) => (list.length ? list.reduce((s, r) => s + r.perUnitSaving, 0) / list.length : 0);
  const on = perCondo.filter((r) => r.condo.sharing.enabled);
  const offRows = perCondo.filter((r) => !r.condo.sharing.enabled);
  const compare = on.length && offRows.length
    ? `Condos sharing idle bays save owners ${rm(avg(on))} per unit a month on average, against ${rm(avg(offRows))} without sharing.`
    : 'Turn sharing on or off in the JMB view to compare condos.';

  root.innerHTML = `
  <div class="sdp">
    <div class="view-head">
      <div><p class="eyebrow">SDP / operator view · ${esc(start.toLocaleString('en-MY', { month: 'long', year: 'numeric' }))}</p>
        <h2>${esc(APP.township)} township</h2>
        <p class="muted">${perCondo.length} condos and KL East Mall on one shared charging network</p></div>
    </div>

    <div class="kpis">
      <div class="kpi"><span>Energy delivered this month</span><b>${num(totals.kWh)} kWh</b></div>
      <div class="kpi hero"><span>Income returned to JMBs</span><b>${rm0(totals.jmbIncome)}</b></div>
      <div class="kpi"><span>CO₂ avoided vs petrol</span><b>${(totals.co2Kg / 1000).toFixed(1)} t</b></div>
      <div class="kpi"><span>Condo bay utilisation</span><b>${pct(totals.utilisation)}</b></div>
    </div>

    <section class="card" style="margin-bottom:16px"><h3>Condo by condo</h3>
      <div class="tbl"><table>
        <thead><tr><th>Condo</th><th class="n">Bays</th><th>Sharing</th><th class="n">Utilisation</th><th class="n">JMB income</th><th class="n">Saving per unit</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${esc(r.condo.name)}</td><td class="n">${r.condo.bays}</td>
          <td>${r.condo.sharing.enabled ? '<span class="chip on">On</span>' : '<span class="chip off">Off</span>'}</td>
          <td class="n">${pct(r.utilisation)}</td><td class="n">${rm0(r.jmbIncome)}</td><td class="n">${rm(r.perUnitSaving)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="muted">${esc(compare)}</p>
    </section>

    <div class="grid2">
      <section class="card"><h3>Scale across SDP townships</h3>
        <label class="field">Townships using the platform <output id="s-n-out">${townships}</output>
          <input id="s-n" type="range" min="1" max="${CONST.sdpTownships}" step="1" value="${townships}"></label>
        <dl class="stats" id="s-stats"></dl>
        <p class="muted">Assumes each township performs like ${esc(APP.township)}. National target: ${num(CONST.nationalTarget2030)} public chargers by 2030.</p>
      </section>
      <section class="card"><h3>Pilot readiness</h3>
        <ul class="checklist">${PILOT.map((p) => `<li><span class="chip ${p.cls}">${esc(p.status)}</span><b>${esc(p.label)}</b><span class="note">${esc(p.note)}</span></li>`).join('')}</ul>
      </section>
    </div>
  </div>`;

  const slider = root.querySelector('#s-n');
  const drawStats = () => {
    const s = scaleUp(totals, townships);
    root.querySelector('#s-n-out').textContent = townships;
    root.querySelector('#s-stats').innerHTML = `
      <div><dt>Shared condo bays</dt><dd>${num(s.bays)}</dd></div>
      <div><dt>JMB income a year</dt><dd>${rm0(s.jmbIncomeYear)}</dd></div>
      <div><dt>CO₂ avoided a year</dt><dd>${num(s.co2TonnesYear)} t</dd></div>
      <div><dt>Share of national target</dt><dd>${(s.shareOfNationalTarget * 100).toFixed(1)}%</dd></div>`;
  };
  slider.addEventListener('input', (e) => { townships = Number(e.target.value); drawStats(); });
  drawStats();
}
