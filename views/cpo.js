// The charging partner (CPO) view: every condo site it runs, its 70% share, energy, bay use,
// bays in service and the idle hours where more sharing would help. Open at jmb.html#cpo.
import { cpoSummary } from '../engine/cpo.js';
import { esc, rm0, num, pct } from './format.js';

const hour = (h) => `${h % 12 || 12} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;

export function renderCpo(root, ctx) {
  const { condos, chargers } = ctx.world;
  const start = new Date(ctx.clock.getFullYear(), ctx.clock.getMonth(), 1);
  const { rows, totals: t } = cpoSummary(condos, chargers, start);
  const cpoPct = rows.length ? Math.round((1 - rows[0].condo.jmbShare) * 100) : 70;
  const idleNote = (x) => {
    if (!x.idle) return '<span class="muted">Busy all day</span>';
    const s = x.condo.sharing;
    const covered = s.enabled && (s.mode === 'auto' || (x.idle.start >= s.start && x.idle.end <= s.end));
    return `${hour(x.idle.start)}–${hour(x.idle.end)} ${covered ? '<span class="chip on">shared</span>' : `<span class="chip warn">${s.enabled ? 'partly shared' : 'not shared'}</span>`}`;
  };
  root.innerHTML = `
  <div class="jmb cpo">
    <div class="view-head">
      <div><p class="eyebrow">Charging partner (CPO) view · ${esc(start.toLocaleString('en-MY', { month: 'long', year: 'numeric' }))}</p>
        <h2>All condo sites</h2>
        <p class="muted">The CPO installs, runs and insures the chargers and keeps ${cpoPct}% of each site's operating surplus; the JMB keeps the rest for its maintenance fund.</p></div>
      <label class="field inline">View <select id="c-view"><option value="cpo">CPO: all sites</option>${condos.map((c) => `<option value="${c.id}">JMB: ${esc(c.name)}</option>`).join('')}</select></label>
    </div>
    <div class="kpis">
      <div class="kpi hero"><span>CPO share this month</span><b>${rm0(t.cpoIncome)}</b></div>
      <div class="kpi"><span>Paid to JMB maintenance funds</span><b>${rm0(t.jmbIncome)}</b></div>
      <div class="kpi"><span>Energy delivered</span><b>${num(t.kWh)} kWh</b></div>
      <div class="kpi"><span>Bays in service</span><b>${t.baysUp} / ${t.bays}</b></div>
    </div>
    <section class="card"><h3>Sites</h3>
      <div class="tbl"><table>
        <thead><tr><th>Condo</th><th>Bays up</th><th>Bay use</th><th>From visitors</th><th>Receipts</th><th>CPO share</th><th>JMB share</th><th>Idle hours (residents &lt;25%)</th><th></th></tr></thead>
        <tbody>${rows.map((x) => `<tr>
          <td><b>${esc(x.condo.name)}</b>${x.sharing ? '' : ' <span class="chip">sharing off</span>'}</td>
          <td>${x.baysUp < x.bays ? `<span class="chip warn">${x.baysUp} / ${x.bays}</span>` : `${x.baysUp} / ${x.bays}`}</td>
          <td>${pct(x.utilisation)}</td><td>${pct(x.visitorShare)}</td>
          <td>${rm0(x.revenue)}</td><td><b>${rm0(x.cpoIncome)}</b></td><td>${rm0(x.jmbIncome)}</td>
          <td>${idleNote(x)}</td>
          <td><a class="btn small" href="#${esc(x.condo.id)}">Open</a></td></tr>`).join('')}</tbody>
        <tfoot><tr><td><b>Total</b></td><td>${t.baysUp} / ${t.bays}</td><td>${pct(t.utilisation)}</td><td></td><td>${rm0(t.revenue)}</td><td><b>${rm0(t.cpoIncome)}</b></td><td>${rm0(t.jmbIncome)}</td><td></td><td></td></tr></tfoot>
      </table></div>
      <p class="muted">Simulated month. Costs per the proposal: electricity RM0.55/kWh, RM0.05/kWh other costs, RM125 per bay a month. Bays down come from OCPP fault reports and the JMBs' maintenance logs. Where idle hours are not shared, suggest Auto-share to that JMB: residents vote on it in the app.</p>
    </section>
  </div>`;
  const sel = root.querySelector('#c-view');
  sel.value = 'cpo';
  sel.addEventListener('change', (e) => { location.hash = `#${e.target.value}`; });
}
