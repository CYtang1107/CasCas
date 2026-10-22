// JMB operations: maintenance cost recovery (proposal 6.2), quiet hours, the bay maintenance log
// and the monthly performance report.
import { CONST } from '../config.js';
import { KINDS, bayStatus, validateEntry } from '../engine/maintenance.js';
import { quietWindows } from '../engine/recovery.js';
import { simulateCondoMonth } from '../engine/economics.js';
import { monthlyReportCsv } from '../engine/report.js';
import { esc, rm, rm0, num, pct, fmtDay } from './format.js';

const hour = (h) => `${h % 12 || 12} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
const signed = (n) => (n < 0 ? `(${rm0(-n)})` : rm0(n));

export function downloadCsv(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Receipts → costs → surplus → split, led by the answer the JMB cares about.
export function recoveryHtml(condo, sim) {
  const r = sim.recovery;
  const line = (label, v, cls = '') => `<tr class="${cls}"><td>${label}</td><td>${v}</td></tr>`;
  const head = (label) => `<tr class="group"><th scope="rowgroup" colspan="2">${label}</th></tr>`;
  const costs = r.electricityCost + r.variableCost + r.fixedMonthly + r.maintenanceRm;
  const covered = r.breakEvenKwh ? r.kWh / r.breakEvenKwh : 0;
  const lead = r.operatingSurplus > 0
    ? `This month the JMB receives <b>${rm0(r.jmbIncome)}</b> for the maintenance fund: ${pct(condo.jmbShare)} of a ${rm0(r.operatingSurplus)} surplus, or <b>${rm(r.perUnit)} per unit</b>.`
    : `This month charging does not yet cover its costs (${signed(r.operatingSurplus)}), so nothing is paid out and residents are not charged for the gap.`;
  return `
    <section class="card recovery"><h3>Maintenance cost recovery</h3>
      <p class="recovery-lead">${lead}</p>
      <div class="tbl"><table><tbody>
        ${head('Charging receipts')}
        ${line('From residents', rm0(sim.residentRevenue))}
        ${line('From outside drivers (shared bays)', rm0(sim.visitorRevenue))}
        ${line('Total receipts', rm0(r.revenue), 'sub')}
        ${head('Costs, paid first')}
        ${line(`Electricity (${num(r.kWh)} kWh × ${rm(CONST.electricityCostPerKwh)}, sub-metered)`, `− ${rm0(r.electricityCost)}`)}
        ${line(`Payment, platform and other fees (${rm(CONST.otherCostPerKwh)}/kWh)`, `− ${rm0(r.variableCost)}`)}
        ${line(`Network, insurance and service (${condo.bays} bays × ${rm0(CONST.fixedPerBayMonthly)})`, `− ${rm0(r.fixedMonthly)}`)}
        ${line('Repairs and services logged this month', `− ${rm0(r.maintenanceRm)}`)}
        ${line('Total costs', `− ${rm0(costs)}`, 'sub')}
        ${line('Operating surplus', signed(r.operatingSurplus), 'total')}
        ${head('Split of the surplus')}
        ${line(`JMB maintenance fund (${pct(condo.jmbShare)})`, rm0(r.jmbIncome), 'hero-row')}
        ${line(`Charging partner, who funds and runs the chargers (${pct(1 - condo.jmbShare)})`, rm0(r.partnerIncome))}
      </tbody></table></div>
      ${r.breakEvenKwh ? `<div class="breakeven"><p><b>Break-even:</b> ${num(r.breakEvenKwh)} kWh a month · delivered ${num(r.kWh)} kWh (${covered >= 1 ? `${covered.toFixed(1)}× break-even` : `${pct(covered)} of the way`})</p>
        <div class="bar" role="img" aria-label="Energy delivered compared with break-even"><span style="width:${Math.min(100, covered * 100)}%"></span></div></div>`
        : '<p class="muted">Break-even is not reached at these prices.</p>'}
    </section>`;
}

// Hours when residents leave most bays idle, which of those hours are not shared yet, how many bays
// stand empty then, and what sharing them would add (the same monthly simulation as the dashboard).
export function quietHtml(condo, charger, sim, start) {
  const cap = condo.bays * charger.kw * CONST.drawFactor;
  // Only hours outside drivers actually come (7 AM to 10 PM) count.
  const resUse = sim.residentByHour.map((r, h) => (h >= 7 && h < 22 ? r / cap : 1));
  const idle = quietWindows(resUse, 0.25, 3)[0];
  if (!idle) return '<p class="muted">Residents keep the bays busy most of the day, so there are no idle hours to share.</p>';
  const s = condo.sharing;
  const span = `${hour(idle.start)}–${hour(idle.end)}`;
  const intro = `<b>Idle hours:</b> on a typical day residents use only ${pct(idle.avgUse)} of the bays from ${span}.`;
  if (s.enabled && s.mode === 'auto') {
    return `<p class="quiet ok">${intro} Auto-share already opens bays in these hours whenever residents are not expected to need them.</p>`;
  }
  const gaps = unsharedRanges(idle, s);
  if (!gaps.length) return `<p class="quiet ok">${intro} Your sharing hours (${hour(s.start)}–${hour(s.end)}) already cover them.</p>`;
  const gapHours = gaps.flatMap(([a, b]) => Array.from({ length: b - a }, (_, i) => a + i));
  const gapUse = gapHours.reduce((t, h) => t + resUse[h], 0) / gapHours.length;
  const freeBays = Math.max(0, Math.round(condo.bays * (1 - gapUse)) - s.reservedBays);
  const wider = { ...s, enabled: true, start: s.enabled ? Math.min(s.start, idle.start) : idle.start, end: s.enabled ? Math.max(s.end, idle.end) : idle.end };
  const extra = start ? simulateCondoMonth({ ...condo, sharing: wider }, charger, start, { maintenanceRm: sim.recovery?.maintenanceRm || 0 }).jmbIncome - sim.jmbIncome : 0;
  const list = gaps.map(([a, b]) => `${hour(a)}–${hour(b)}`).join(' and ');
  const now = s.enabled ? `You share ${hour(s.start)}–${hour(s.end)}, so ${list} ${gaps.length > 1 ? 'are' : 'is'} not shared yet` : `Sharing is off, so none of ${list} is shared`;
  const gain = extra >= 1 ? ` Sharing ${hour(wider.start)}–${hour(wider.end)} would add about <b>${rm0(extra)} a month</b> for the JMB (simulated).` : '';
  return `<p class="quiet">${intro} ${now}; about <b>${freeBays} of ${condo.bays} bays</b> stand empty then, after keeping ${s.reservedBays} for residents.${gain}</p>`;
}

// Hours of the idle window that fall outside the shared hours, as [start, end) ranges.
function unsharedRanges(idle, s) {
  const out = [];
  for (let h = idle.start; h < idle.end; h++) {
    const shared = s.enabled && h >= s.start && h < s.end;
    if (shared) continue;
    const last = out[out.length - 1];
    if (last && last[1] === h) last[1] = h + 1; else out.push([h, h + 1]);
  }
  return out;
}

export function maintenanceHtml(condo, entries, canEdit, clock) {
  if (!entries) {
    return `<section class="card"><h3>Maintenance log</h3><p class="muted">Log in with the condo PIN below to see and record faults, repairs and their costs.</p></section>`;
  }
  const status = bayStatus(entries, condo.bays);
  const down = status.filter((b) => b.status === 'fault');
  const recent = [...entries].sort((a, b) => b.at - a.at).slice(0, 8);
  const today = `${clock.getFullYear()}-${String(clock.getMonth() + 1).padStart(2, '0')}-${String(clock.getDate()).padStart(2, '0')}`;
  return `
    <section class="card maintenance"><h3>Maintenance log</h3>
      <p class="muted">${down.length ? `<span class="chip warn">${down.length} bay${down.length === 1 ? '' : 's'} out of service</span> Drivers cannot book ${down.length === 1 ? 'it' : 'them'} until a repair is logged.` : 'All bays in service.'} Costs logged here come out of this month's surplus.</p>
      ${canEdit ? `<form id="j-mnt" class="row" novalidate>
        <label class="field">Bay <select id="j-mnt-bay">${status.map((b) => `<option value="${b.bay}">Bay ${b.bay}${b.status === 'fault' ? ' (fault)' : ''}</option>`).join('')}</select></label>
        <label class="field">Type <select id="j-mnt-kind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="field">Cost (RM) <input id="j-mnt-cost" type="number" min="0" step="10" value="0"></label>
        <label class="field">Date <input id="j-mnt-date" type="date" value="${today}"></label>
        <label class="field grow">Note <input id="j-mnt-note" type="text" maxlength="120" placeholder="e.g. replaced cable on bay 3"></label>
        <button class="btn primary" type="submit">Add</button>
      </form>
      <p id="j-mnt-err" class="error" role="alert" hidden></p>` : ''}
      ${recent.length ? `<div class="tbl"><table>
        <thead><tr><th>Date</th><th>Bay</th><th>Type</th><th>Cost</th><th>Note</th></tr></thead>
        <tbody>${recent.map((e) => `<tr><td>${esc(fmtDay(new Date(e.at)))}</td><td>Bay ${e.bay}</td><td><span class="chip ${e.kind === 'fault' ? 'warn' : 'on'}">${KINDS[e.kind]}</span></td><td>${rm(e.costRm)}</td><td>${esc(e.note || '—')}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="empty">Nothing logged yet.</p>'}
    </section>`;
}

export function bindMaintenance(root, condo, ctx, add) {
  const form = root.querySelector('#j-mnt');
  if (!form || !add) return;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const $ = (s) => form.querySelector(s);
    const err = root.querySelector('#j-mnt-err');
    const day = new Date(`${$('#j-mnt-date').value}T12:00`);
    const entry = {
      bay: Number($('#j-mnt-bay').value), kind: $('#j-mnt-kind').value, costRm: Number($('#j-mnt-cost').value),
      at: Number.isNaN(day.getTime()) ? NaN : day.getTime(), note: $('#j-mnt-note').value.trim(),
    };
    const bad = validateEntry(entry, condo.bays);
    if (bad) { err.textContent = bad; err.hidden = false; return; }
    const r = await add(entry);
    if (r && !r.ok) { err.textContent = r.error; err.hidden = false; }
  });
}

export function reportCsv(condo, charger, sim, { month, sessions, entries }) {
  const r = sim.recovery;
  const faults = entries ? entries.filter((e) => e.kind === 'fault').length : 'n/a (log in)';
  return monthlyReportCsv({
    condoName: condo.name, month,
    rows: [
      ['Charging bays', condo.bays],
      ['Energy delivered (kWh)', Math.round(r.kWh)],
      ['To residents (kWh)', Math.round(sim.residentKwh)],
      ['To visitors (kWh)', Math.round(sim.visitorKwh)],
      ['Bay utilisation', `${(sim.utilisation * 100).toFixed(1)}%`],
      ['Gross receipts (RM)', r.revenue],
      ['TNB electricity (RM)', r.electricityCost],
      ['Other variable costs (RM)', r.variableCost],
      ['Fixed costs (RM)', r.fixedMonthly],
      ['Repairs and services (RM)', r.maintenanceRm],
      ['Operating surplus (RM)', r.operatingSurplus],
      ['JMB share (RM)', r.jmbIncome],
      ['Charging partner share (RM)', r.partnerIncome],
      ['Saving per unit (RM)', r.perUnit],
      ['Break-even (kWh)', r.breakEvenKwh ? Math.round(r.breakEvenKwh) : 'not reached'],
      ['CO2 avoided (kg)', Math.round(sim.co2AvoidedKg)],
      ['Bookings through CasSama this month', sessions],
      ['Faults logged (all time)', faults],
      ['Basis', 'Simulated demand plus demo bookings; costs per proposal section 6.2'],
    ],
  });
}
