// Six months of simulated sessions for one condo bay, so the JMB dashboard has history on day one.
// Seeded, so the same inputs always give the same output.
import { round2 } from './pricing.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedOf(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const MODE_SPLIT = [['urgent', 0.15], ['balanced', 0.5], ['saver', 0.35]];
// Following a pick: what it saves (RM) and costs in time (min) vs the nearest charger, by mode.
const EFFECT = { urgent: { rm: [-1, 1], min: [-3, 0] }, balanced: { rm: [0.5, 3], min: [0, 4] }, saver: { rm: [1, 6], min: [2, 8] } };

const between = (r, [lo, hi]) => lo + r * (hi - lo);
function weighted(r, list) {
  let x = r;
  for (const [k, w] of list) { x -= w; if (x < 0) return k; }
  return list.at(-1)[0];
}

export function simulateHistory(condo, charger, endMs, { seed = seedOf(condo.id), days = 182 } = {}) {
  const rand = mulberry32(seed);
  const today = new Date(endMs);
  today.setHours(0, 0, 0, 0);
  const shares = !!condo.sharing?.enabled;
  const residentIds = Math.max(5, Math.round(condo.units * 0.1));
  const out = [];

  for (let d = days; d >= 1; d--) {
    const day = new Date(today);
    day.setDate(day.getDate() - d);
    const followP = 0.55 + 0.2 * ((days - d) / days); // drivers trust the picks more over time
    const n = 2 + Math.floor(rand() * Math.max(2, condo.bays * 0.6));
    for (let i = 0; i < n; i++) {
      const visitor = shares && rand() < 0.3;
      const hour = visitor
        ? Math.floor(between(rand(), [condo.sharing.start, condo.sharing.end]))
        : (rand() < 0.7 ? 18 + Math.floor(rand() * 5) : Math.floor(rand() * 24));
      const at = new Date(day);
      at.setHours(Math.min(23, hour), Math.floor(rand() * 60));
      const mode = weighted(rand(), MODE_SPLIT);
      const follow = rand() < followP;
      const r = rand();
      const choice = follow ? (r < 0.6 ? 'pick1' : r < 0.85 ? 'pick2' : 'pick3') : 'own';
      const kWh = round2(between(rand(), [8, 35]));
      const costRm = round2(kWh * (visitor ? condo.sharing.visitorPrice : condo.residentPrice));
      const saved = follow ? round2(between(rand(), EFFECT[mode].rm)) : 0;
      const minutes = follow ? Math.round(between(rand(), EFFECT[mode].min)) : 0;
      const idNo = 1 + Math.floor(rand() * (visitor ? 60 : residentIds));
      out.push({
        at: at.getTime(), anonId: `${visitor ? 'V' : 'R'}${idNo}`, role: visitor ? 'visitor' : 'resident',
        mode, chargerId: charger.id, condoId: condo.id, topPickId: null, nearestId: null,
        choice, kWh, costRm, nearestCostRm: round2(costRm + saved), minutesVsNearest: minutes, simulated: true,
      });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
