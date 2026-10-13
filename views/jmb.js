import { CONST } from '../config.js';
import { TNB } from '../data/tariff.js';
import { simulateCondoMonth, rampSeries } from '../engine/economics.js';
import { validateSharing } from '../engine/sharing.js';
import { barChart24, lineChart } from './charts.js';
import { esc, rm, rm0, num, pct, monthLabel } from './format.js';

let condoId = null;
const PEAK_HOURS = Array.from({ length: TNB.peakEndHour - TNB.peakStartHour }, (_, i) => TNB.peakStartHour + i);

export function renderJmb(root, ctx) {
  const { condos, chargers } = ctx.world;
  if (!condos.some((c) => c.id === condoId)) condoId = condos[0].id;
  const condo = condos.find((c) => c.id === condoId);
  const charger = chargers.find((ch) => ch.condoId === condo.id);
  const start = new Date(ctx.clock.getFullYear(), ctx.clock.getMonth(), 1);
  const sim = simulateCondoMonth(condo, charger, start);
  const s = condo.sharing;
  const sinkingYear = 0.1 * condo.monthlyFee * condo.units * 12;
  const boost = (sim.jmbIncome * 12) / sinkingYear;
  const months = Array.from({ length: 6 }, (_, i) => monthLabel(new Date(start.getFullYear(), start.getMonth() - 5 + i, 1)));
  const checkins = ctx.state.checkins[charger.id] || [];
  const problems = checkins.filter((c) => !c.ok);

  root.innerHTML = `
  <div class="jmb">
    <div class="view-head">
      <div><p class="eyebrow">JMB dashboard · ${esc(start.toLocaleString('en-MY', { month: 'long', year: 'numeric' }))}</p>
        <h2>${esc(condo.name)}</h2>
        <p class="muted">${condo.units} units · ${condo.bays} charging bays · the JMB keeps ${pct(condo.jmbShare)} of the margin, the charging partner keeps the rest</p></div>
      <label class="field inline">Condo <select id="j-condo">${condos.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
    </div>

    <div class="kpis">
      <div class="kpi"><span>Charging income this month</span><b>${rm0(sim.revenue)}</b></div>
      <div class="kpi"><span>JMB share after electricity</span><b>${rm0(sim.jmbIncome)}</b></div>
      <div class="kpi hero"><span>Saving per unit per month</span><b>${rm(sim.perUnitSaving)}</b></div>
      <div class="kpi"><span>Energy delivered</span><b>${num(sim.kWhSold)} kWh</b></div>
    </div>

    <div class="grid2">
      <section class="card"><h3>An average day: who charges when</h3>
        ${barChart24({ a: sim.residentByHour, b: sim.visitorByHour, shade: PEAK_HOURS, aLabel: 'Residents', bLabel: 'Outside drivers (shared bays)' })}
        <p class="muted">Shaded hours are TNB peak (weekdays 2–10 PM). Residents charge in the evening; outside drivers fill the bays they leave empty during the day.</p>
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
      </section>
      <section class="card"><h3>Sharing with outside drivers</h3>
        <form id="j-share" class="form" novalidate>
          <label class="check"><input type="checkbox" id="j-en" ${s.enabled ? 'checked' : ''}> Open idle bays to outside drivers</label>
          <label class="field">Days <select id="j-days">
            <option value="weekdays">Weekdays</option><option value="weekends">Weekends</option><option value="all">Every day</option></select></label>
          <div class="row">
            <label class="field">Opens (hour) <input id="j-start" type="number" min="0" max="23" step="1" value="${s.start}"></label>
            <label class="field">Closes (hour) <input id="j-end" type="number" min="1" max="24" step="1" value="${s.end}"></label>
          </div>
          <div class="row">
            <label class="field">Bays kept for residents <input id="j-res" type="number" min="0" max="${condo.bays}" step="1" value="${s.reservedBays}"></label>
            <label class="field">Visitor price (RM/kWh) <input id="j-price" type="number" min="0.5" max="3" step="0.05" value="${s.visitorPrice}"></label>
          </div>
          <p id="j-err" class="error" role="alert" hidden></p>
          <p class="muted">Residents pay ${rm(condo.residentPrice)}/kWh. TNB peak hours add ${rm(condo.peakSurcharge)}. Changes update this dashboard and the driver map.</p>
        </form>
      </section>
    </div>

    <section class="card"><h3>Charger health</h3>
      <p class="muted">Reliability ${pct(charger.reliability)} · ${checkins.length} check-ins from drivers on this device.</p>
      <div class="tbl"><table>
        <thead><tr><th>Bay</th><th>Status</th><th>Latest report</th></tr></thead>
        <tbody>${Array.from({ length: condo.bays }, (_, i) => {
          const p = problems[problems.length - 1 - i];
          return `<tr><td>Bay ${i + 1}</td><td>${p ? '<span class="chip warn">Problem reported</span>' : '<span class="chip on">Working</span>'}</td><td>${p ? esc(p.note || 'No details given') : '—'}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
    </section>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  $('#j-condo').value = condo.id;
  $('#j-days').value = s.days;
  $('#j-condo').addEventListener('change', (e) => { condoId = e.target.value; ctx.rerender(); });
  $('#j-share').addEventListener('submit', (e) => e.preventDefault());
  $('#j-share').addEventListener('change', () => {
    const next = {
      enabled: $('#j-en').checked,
      days: $('#j-days').value,
      start: Number($('#j-start').value),
      end: Number($('#j-end').value),
      reservedBays: Number($('#j-res').value),
      visitorPrice: Number($('#j-price').value),
    };
    const err = validateSharing(next, condo.bays);
    const box = $('#j-err');
    if (err) { box.textContent = err; box.hidden = false; return; }
    box.hidden = true;
    ctx.state.sharing[condo.id] = next;
    ctx.save();
    ctx.rerender();
  });
}
