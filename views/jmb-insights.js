// JMB cards: did drivers follow CasCas's picks (anonymous), and which visitors are expected (plates).
import { MODES } from '../engine/score.js';
import { simulateHistory } from '../engine/history.js';
import { filterSessions, followRate, savings, weeklyTrend, byMode, toCsv, CHOICE_LABEL, anonLabel, overstayTotals } from '../engine/insights.js';
import { overstayFee } from '../engine/pricing.js';
import { upcomingPasses, formatPlate } from '../engine/access.js';
import { lineChart } from './charts.js';
import { esc, rm, rm0, num, pct, fmtTime, fmtDay, fmtClock } from './format.js';

const DAY = 864e5;
const filters = { role: 'all', from: '', to: '' };
const signedRm = (n) => (n < -0.005 ? `−${rm(-n)}` : rm(Math.max(0, n)));
const DAYS_LABEL = { weekdays: 'weekdays', weekends: 'weekends', all: 'every day' };

const dayStart = (v) => {
  const d = new Date(`${v}T00:00`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
};

export function insightsSection(condo, charger, ctx) {
  const now = ctx.clock.getTime();
  const real = filterSessions(ctx.state.sessions, { condoId: condo.id });
  const all = [...simulateHistory(condo, charger, now), ...real].sort((a, b) => a.at - b.at);
  const recent = filterSessions(all, { from: now - 30 * DAY, to: now + 1 });
  const monthStart = new Date(ctx.clock.getFullYear(), ctx.clock.getMonth(), 1).getTime();
  const month = filterSessions(all, { from: monthStart, to: now + 1 });
  const s30 = savings(recent);
  const late = overstayTotals(recent);
  const trend = weeklyTrend(all, now, 12);
  const from = filters.from ? dayStart(filters.from) : null;
  const toDay = filters.to ? dayStart(filters.to) : null;
  const rows = filterSessions(all, { role: filters.role, from, to: toDay == null ? null : toDay + DAY }).reverse();

  const html = `
    <section class="card insights">
      <div class="card-head"><h3>Driver behaviour</h3><span class="chip">Simulated history + your demo bookings</span></div>
      <div class="kpis">
        <div class="kpi hero"><span>Took a CasCas pick (30 days)</span><b>${pct(followRate(recent))}</b></div>
        <div class="kpi"><span>Saved per session vs nearest</span><b>${rm(s30.avgRm)}</b></div>
        <div class="kpi"><span>Saved by drivers this month</span><b>${rm0(savings(month).totalRm)}</b></div>
        <div class="kpi"><span>Sessions (30 days)</span><b>${num(recent.length)}</b></div>
      </div>
      <div class="grid2">
        <div><h4>Share of bookings that took a CasCas pick, by week</h4>
          ${lineChart({
            labels: trend.map((w, i) => (i % 2 ? '' : fmtDay(new Date(w.weekStart)))),
            series: [{ label: 'Took a CasCas pick', values: trend.map((w) => Math.round(w.followRate * 100)), cls: 'la' }],
            money: false, unit: '%', ariaLabel: 'Weekly share of bookings that took a CasCas pick',
          })}
        </div>
        <div><h4>By battery mode (30 days)</h4>
          <div class="tbl"><table>
            <thead><tr><th>Mode</th><th>Sessions</th><th>Took a CasCas pick</th></tr></thead>
            <tbody>${byMode(recent).map((g) => `<tr><td>${MODES[g.key].label}</td><td>${num(g.count)}</td><td>${g.count ? pct(g.followRate) : '—'}</td></tr>`).join('')}</tbody>
          </table></div>
          <p class="muted">Average time vs the nearest charger: ${s30.avgMinutes > 0 ? '+' : ''}${s30.avgMinutes} min. Saver drivers accept a short detour for a lower price.</p>
          <p class="muted">Overstay fees (30 days): <b>${rm0(late.feesRm)}</b> from ${num(late.count)} late pick-ups, paid to the JMB. Drivers get a reminder 15 minutes before their slot ends.</p>
        </div>
      </div>
      <h4>Session log</h4>
      <form id="j-log" class="row log-filters" novalidate>
        <label class="field">Drivers <select id="j-role"><option value="all">All</option><option value="resident">Residents</option><option value="visitor">Visitors</option></select></label>
        <label class="field">From <input id="j-from" type="date" value="${esc(filters.from)}"></label>
        <label class="field">To <input id="j-to" type="date" value="${esc(filters.to)}"></label>
        <button id="j-csv" class="btn small" type="button">Export CSV (${num(rows.length)})</button>
      </form>
      <div class="tbl"><table>
        <thead><tr><th>Time</th><th>Driver</th><th>Mode</th><th>kWh</th><th>Cost</th><th>Choice</th><th>Saved vs nearest</th><th>Overstay</th></tr></thead>
        <tbody>${rows.slice(0, 50).map((r) => `<tr><td>${esc(fmtDay(new Date(r.at)))} ${esc(fmtClock(new Date(r.at)))}</td><td>${esc(anonLabel(r.anonId))}</td><td>${MODES[r.mode].label}</td><td>${r.kWh.toFixed(1)}</td><td>${rm(r.costRm)}</td><td>${CHOICE_LABEL[r.choice]}</td><td>${signedRm(r.nearestCostRm - r.costRm)}</td><td>${r.overstayMin ? `${r.overstayMin} min · ${rm(overstayFee(r.overstayMin))}` : '—'}</td></tr>`).join('') || '<tr><td colspan="8">No sessions match these filters.</td></tr>'}</tbody>
      </table></div>
      <p class="muted">Drivers appear by anonymous ID only. No names, phone numbers or plates are kept in this log.</p>
    </section>`;

  const bind = (root) => {
    const $ = (sel) => root.querySelector(sel);
    $('#j-role').value = filters.role;
    $('#j-log').addEventListener('submit', (e) => e.preventDefault());
    $('#j-log').addEventListener('change', () => {
      filters.role = $('#j-role').value;
      filters.from = $('#j-from').value;
      filters.to = $('#j-to').value;
      ctx.rerender();
    });
    $('#j-csv').addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([toCsv([...rows].reverse())], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `cascas-${condo.id}-sessions.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  };
  return { html, bind };
}

export function visitorsHtml(condo, ctx) {
  const s = condo.sharing;
  const passes = upcomingPasses(ctx.state.visitorPasses, condo.id, ctx.clock.getTime());
  const bayName = (id) => ctx.world.chargers.find((ch) => ch.id === id)?.name || id;
  const status = s.enabled
    ? `Visitors are approved automatically during sharing hours (${DAYS_LABEL[s.days]}, ${s.start}:00 to ${s.end}:00).`
    : 'Sharing is off, so visitors cannot book. Visits already approved stay on this list.';
  return `
    <section class="card visitors">
      <h3>Expected visitors</h3>
      <p class="muted">${esc(status)} The guardhouse checks plates against this list.</p>
      ${passes.length ? `<div class="tbl"><table>
        <thead><tr><th>Slot</th><th>Bay</th><th>Plate</th></tr></thead>
        <tbody>${passes.map((p) => `<tr><td>${esc(fmtTime(new Date(p.slotStart)))} to ${esc(fmtClock(new Date(p.slotEnd)))}</td><td>${esc(bayName(p.chargerId))}</td><td><b>${esc(formatPlate(p.plate))}</b></td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="empty">No visitor bookings yet.</p>'}
      <p class="muted">Plates are deleted 30 days after the visit.</p>
    </section>`;
}
