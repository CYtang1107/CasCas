// Recorded booking-linked OCPP charging only. Forecast KPIs remain separate in jmb.js.
import { esc, rm, num } from './format.js';

const malaysiaMonth = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
const selectedMonths = new Map();

export function recordedRevenueHtml(api, condoId) {
  return `<section class="card" id="j-s-recorded" aria-label="Recorded charging revenue">
    <h3>Recorded charging activity</h3>
    <p class="muted">Meter-confirmed, booking-linked OCPP sessions only. Receipts are calculated amounts, not confirmed payments.</p>
    <label class="field">Month (Malaysia time) <input id="j-recorded-month" type="month" value="${selectedMonths.get(condoId) || malaysiaMonth()}"></label>
    <div id="j-recorded-body" aria-live="polite">${api ? 'Log in with the condo PIN to view actual session records.' : 'Connect to the shared server to view recorded charging.'}</div>
  </section>`;
}

export function recordedRevenueDetails(data) {
  const f = data.financials;
  const rows = data.sessions.map(s => `<tr>
    <td>Bay ${num(s.bay)}</td><td>${esc(s.role)}</td>
    <td>${esc(new Date(s.endedAt).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}</td>
    <td class="n">${Number(s.energyKwh).toFixed(2)}</td><td class="n">${rm(s.revenueRm)}</td>
  </tr>`).join('');
  return `<div class="kpis recorded-kpis">
    <div class="kpi"><span>Metered sessions</span><b>${num(data.sessionCount)}</b></div>
    <div class="kpi"><span>Metered energy</span><b>${Number(f.kWh).toFixed(2)} kWh</b></div>
    <div class="kpi"><span>Calculated receipts</span><b>${rm(f.revenue)}</b></div>
    <div class="kpi"><span>Estimated JMB allocation</span><b>${rm(f.jmbIncome)}</b></div>
  </div>
  <p class="muted">Estimated expenses: electricity ${rm(f.electricityCost)}, variable ${rm(f.variableCost)}, fixed ${rm(f.fixedMonthly)}, maintenance ${rm(f.maintenanceRm)}.
    Estimated operating surplus: <b>${rm(f.operatingSurplus)}</b>. CPO/partner allocation: ${rm(f.partnerIncome)}.</p>
  <div class="tbl"><table><thead><tr><th>Bay</th><th>Driver</th><th>Completed (MYT)</th><th class="n">kWh</th><th class="n">Calculated receipt</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5">No completed booking-linked sessions for this month.</td></tr>'}</tbody></table></div>
  <p class="muted">${esc(data.warning)}</p>`;
}

export function bindRecordedRevenue(root, ctx, condoId, token) {
  const section = root.querySelector('#j-s-recorded');
  const field = section?.querySelector('#j-recorded-month');
  const body = section?.querySelector('#j-recorded-body');
  if (!ctx.api || !token || !field || !body) return;
  let request = 0;
  const fetchReport = async () => {
    const currentRequest = ++request;
    const month = field.value;
    selectedMonths.set(condoId, month);
    body.textContent = 'Loading recorded sessions…';
    const r = await ctx.api.jmbChargingRevenue(condoId, token, month);
    if (request !== currentRequest || !section.isConnected || field.value !== month) return;
    if (!r.ok) { body.textContent = `Could not load recorded sessions: ${r.error}`; return; }
    body.innerHTML = recordedRevenueDetails(r.data);
  };
  field.addEventListener('change', fetchReport);
  fetchReport();
}
