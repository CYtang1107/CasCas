// JMB operations: maintenance cost recovery (proposal 6.2), quiet hours, the bay maintenance log
// and the monthly performance report.
import { CONST } from '../config.js';
import { KINDS, bayStatus, validateEntry } from '../engine/maintenance.js';
import { quietWindows } from '../engine/recovery.js';
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

export function recoveryHtml(condo, sim) {
  const r = sim.recovery;
  const line = (label, v, cls = '') => `<tr class="${cls}"><td>${label}</td><td>${v}</td></tr>`;
  return `
    <section class="card recovery"><h3>Maintenance cost recovery</h3>
      <p class="muted">Counted the way our proposal does (section 6.2): every cost comes out before the JMB is paid.</p>
      <div class="tbl"><table><tbody>
        ${line('Gross charging receipts', rm0(r.revenue))}
        ${line('− TNB electricity', rm0(r.electricityCost))}
        ${line(`− Other variable costs (${rm(CONST.otherCostPerKwh)}/kWh)`, rm0(r.variableCost))}
        ${line(`− Fixed costs (network, insurance, service: ${rm0(CONST.fixedPerBayMonthly)}/bay)`, rm0(r.fixedMonthly))}
        ${line('− Repairs and services logged this month', rm0(r.maintenanceRm))}
        ${line('Operating surplus', signed(r.operatingSurplus), 'total')}
        ${line(`JMB share (${pct(condo.jmbShare)}), to the maintenance fund`, rm0(r.jmbIncome), 'hero-row')}
        ${line('Charging partner (CPO) share', rm0(r.partnerIncome))}
      </tbody></table></div>
      <p class="muted">Break-even: ${r.breakEvenKwh ? `${num(r.breakEvenKwh)} kWh a month` : 'not reached at these prices'} · delivered ${num(r.kWh)} kWh · ${rm(r.perUnit)} per unit per month. Simulated demand, not measured.</p>
    </section>`;
}

// Hours when most bays sit idle, compared with the hours the JMB already shares.
export function quietHtml(condo, charger, sim) {
  const cap = condo.bays * charger.kw * CONST.drawFactor;
  const use = sim.residentByHour.map((r, h) => (r + sim.visitorByHour[h]) / cap);
  // Only hours outside drivers actually come (7 AM to 10 PM) count.
  const resUse = sim.residentByHour.map((r, h) => (h >= 7 && h < 22 ? r / cap : 1));
  const idle = quietWindows(resUse, 0.25, 3)[0];
  if (!idle) return '<p class="muted">Residents keep the bays busy most of the day.</p>';
  const s = condo.sharing;
  const shared = s.enabled ? `You share ${hour(s.start)} to ${hour(s.end)}.` : 'Sharing is off.';
  const filled = use.slice(idle.start, idle.end).reduce((a, b) => a + b, 0) / (idle.end - idle.start);
  const gap = !s.enabled || idle.start < s.start || idle.end > s.end
    ? ` Opening more of ${hour(idle.start)} to ${hour(idle.end)} to visitors would use bays that are otherwise idle.`
    : ' Your sharing hours already cover this window.';
  return `<p class="quiet"><b>Underused hours:</b> residents use only ${pct(idle.avgUse)} of the bays from ${hour(idle.start)} to ${hour(idle.end)}; with visitors it is ${pct(filled)}. ${shared}${gap}</p>`;
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
      ['Bookings through CasCas this month', sessions],
      ['Faults logged (all time)', faults],
      ['Basis', 'Simulated demand plus demo bookings; costs per proposal section 6.2'],
    ],
  });
}
