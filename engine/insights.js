// Did drivers follow CasCas's recommendation, and what did it save them vs the nearest charger?
import { round2, overstayFee } from './pricing.js';

export const CHOICE_LABEL = { pick1: 'Top pick', pick2: '2nd pick', pick3: '3rd pick', own: 'Own choice' };

export function anonLabel(anonId) {
  return `${anonId.startsWith('R') ? 'Resident' : 'Visitor'} #${anonId.slice(1)}`;
}

// One record per booking. `ranking` is rankChargers() output; `resident` = the driver lives in a condo here.
export function buildSession({ ranking, chosenId, at, anonNo, resident }) {
  const results = ranking.results;
  const idx = results.findIndex((c) => c.charger.id === chosenId);
  const chosen = results[idx];
  const nearest = results.reduce((a, b) => (b.km < a.km ? b : a));
  return {
    at,
    anonId: `${resident ? 'R' : 'V'}${anonNo}`,
    role: resident ? 'resident' : 'visitor',
    mode: ranking.mode,
    chargerId: chosen.charger.id,
    condoId: chosen.condo ? chosen.condo.id : null,
    topPickId: results[0].charger.id,
    nearestId: nearest.charger.id,
    choice: idx >= 0 && idx < 3 ? `pick${idx + 1}` : 'own',
    kWh: round2(chosen.kWh),
    costRm: round2(chosen.cost),
    nearestCostRm: round2(nearest.cost),
    minutesVsNearest: Math.round(chosen.timeMin - nearest.timeMin),
    overstayMin: 0,
  };
}

export const followed = (s) => s.choice !== 'own';

export function followRate(sessions) {
  return sessions.length ? sessions.filter(followed).length / sessions.length : 0;
}

export function savings(sessions) {
  if (!sessions.length) return { avgRm: 0, totalRm: 0, avgMinutes: 0 };
  const total = sessions.reduce((s, x) => s + (x.nearestCostRm - x.costRm), 0);
  const minutes = sessions.reduce((s, x) => s + x.minutesVsNearest, 0);
  return { avgRm: round2(total / sessions.length), totalRm: round2(total), avgMinutes: Math.round(minutes / sessions.length) };
}

// Local midnight on the Monday of the week containing `ms`.
export function startOfWeek(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function weeklyTrend(sessions, endMs, weeks = 12) {
  const last = new Date(startOfWeek(endMs));
  return Array.from({ length: weeks }, (_, i) => {
    const start = new Date(last);
    start.setDate(start.getDate() - 7 * (weeks - 1 - i));
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const inWeek = sessions.filter((s) => s.at >= start.getTime() && s.at < end.getTime());
    return { weekStart: start.getTime(), followRate: followRate(inWeek), count: inWeek.length };
  });
}

function groupBy(sessions, key, keys) {
  return keys.map((k) => {
    const g = sessions.filter((s) => s[key] === k);
    return { key: k, count: g.length, followRate: followRate(g) };
  });
}

export const byMode = (sessions) => groupBy(sessions, 'mode', ['urgent', 'balanced', 'saver']);
export const byRole = (sessions) => groupBy(sessions, 'role', ['resident', 'visitor']);

// `to` is exclusive. A missing or null filter matches everything.
export function filterSessions(sessions, { condoId = null, role = null, from = null, to = null } = {}) {
  return sessions.filter((s) => (condoId == null || s.condoId === condoId)
    && (!role || role === 'all' || s.role === role)
    && (from == null || s.at >= from)
    && (to == null || s.at < to));
}

const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export function toCsv(sessions) {
  const head = 'time,anonymous_id,role,mode,charger,kwh,cost_rm,choice,saved_vs_nearest_rm,minutes_vs_nearest';
  const rows = sessions.map((s) => [
    new Date(s.at).toISOString(), s.anonId, s.role, s.mode, s.chargerId ?? '', s.kWh.toFixed(1), s.costRm.toFixed(2),
    CHOICE_LABEL[s.choice], (s.nearestCostRm - s.costRm).toFixed(2), s.minutesVsNearest,
  ].map(cell).join(','));
  return `${[head, ...rows].join('\n')}\n`;
}

export function overstayTotals(sessions) {
  const over = sessions.filter((s) => s.overstayMin > 0);
  return { count: over.length, feesRm: over.reduce((t, s) => t + overstayFee(s.overstayMin), 0) };
}
