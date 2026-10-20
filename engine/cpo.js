// The charging partner's (CPO's) view across every condo it runs, and the idle-hours check the
// Revenue agent and the JMB portal share.
import { CONST } from '../config.js';
import { simulateCondoMonth } from './economics.js';
import { quietWindows } from './recovery.js';

// The longest stretch (7 AM–10 PM) when residents use under a quarter of the bays.
export function idleWindow(condo, charger, sim) {
  const cap = condo.bays * charger.kw * CONST.drawFactor;
  const resUse = sim.residentByHour.map((r, h) => (h >= 7 && h < 22 ? r / cap : 1));
  return quietWindows(resUse, 0.25, 3)[0] || null;
}

// One row per condo site, plus totals. faultBays come from the live world (OCPP and the JMB log).
export function cpoSummary(condos, chargers, start) {
  const rows = condos.map((condo) => {
    const site = chargers.find((c) => c.condoId === condo.id);
    if (!site) return null;
    const sim = simulateCondoMonth(condo, site, start);
    const r = sim.recovery;
    const down = Math.min(condo.bays, site.faultBays || 0);
    return {
      condo, site, kWh: r.kWh, revenue: r.revenue, surplus: r.operatingSurplus,
      cpoIncome: r.partnerIncome, jmbIncome: r.jmbIncome, utilisation: sim.utilisation,
      visitorShare: sim.kWhSold ? sim.visitorKwh / sim.kWhSold : 0,
      baysUp: condo.bays - down, bays: condo.bays, reliability: site.reliability,
      sharing: condo.sharing.enabled, idle: idleWindow(condo, site, sim),
    };
  }).filter(Boolean);
  const sum = (k) => rows.reduce((s, x) => s + x[k], 0);
  const bays = sum('bays');
  return {
    rows,
    totals: {
      sites: rows.length, bays, baysUp: sum('baysUp'), kWh: sum('kWh'), revenue: sum('revenue'),
      cpoIncome: sum('cpoIncome'), jmbIncome: sum('jmbIncome'),
      utilisation: bays ? rows.reduce((s, x) => s + x.utilisation * x.bays, 0) / bays : 0,
    },
  };
}
