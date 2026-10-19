import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  co2AvoidedKg, monthlyEconomics, simulateCondoMonth, rampSeries,
} from '../engine/economics.js';
import { CONDOS } from '../data/condos.js';
import { CHARGERS } from '../data/chargers.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('reference case from the research doc', () => {
  const e = monthlyEconomics({
    residentKwh: 8400, visitorKwh: 0, residentRevenue: 8400 * 0.9, visitorRevenue: 0,
    electricityCost: 8400 * 0.3, jmbShare: 0.7, units: 300, bays: 10,
  });
  close(e.margin, 5040);
  close(e.jmbIncome, 3528);
  close(e.perUnitSaving, 11.76);
  assert.equal(e.paybackMonths, 12);
});

test('no margin means no payback', () => {
  const e = monthlyEconomics({ residentKwh: 100, visitorKwh: 0, residentRevenue: 30, visitorRevenue: 0, electricityCost: 30, jmbShare: 0.7, units: 10, bays: 2 });
  assert.equal(e.paybackMonths, null);
});

test('CO2 avoided for 840 kWh is about 274 kg', () => close(co2AvoidedKg(840), 274.4, 0.1));

const condo = { id: 'c1', units: 300, bays: 10, jmbShare: 0.7, residentPrice: 0.9, peakSurcharge: 0.1,
  sharing: { enabled: true, days: 'weekdays', start: 9, end: 17, reservedBays: 2, visitorPrice: 1.1 } };
const site = { id: 'cs-c1', siteType: 'condo', condoId: 'c1', kw: 7, bays: 10, operator: 'x', price: null };
const oct = new Date(2026, 9, 1);

test('simulateCondoMonth with constant occupancy', () => {
  const sim = simulateCondoMonth(condo, site, oct, { occupancyFn: () => ({ resident: 0.2, visitor: 0, total: 0.2 }) });
  close(sim.residentKwh, 5040);
  close(sim.residentByHour[5], 7);
  close(sim.utilisation, 0.1);
  assert.equal(sim.visitorKwh, 0);
});

test('visitors raise JMB income', () => {
  const without = simulateCondoMonth(condo, site, oct, { occupancyFn: () => ({ resident: 0.2, visitor: 0, total: 0.2 }) });
  const withV = simulateCondoMonth(condo, site, oct, { occupancyFn: () => ({ resident: 0.2, visitor: 0.1, total: 0.3 }) });
  assert.ok(withV.jmbIncome > without.jmbIncome);
});

test('rampSeries ends at the current value', () => {
  const r = rampSeries(100);
  assert.equal(r.length, 6);
  assert.equal(r[5], 100);
  assert.ok(r[0] < r[5]);
});

test('simulated KL East: sharing condos earn more per unit than non-sharing ones', () => {
  const perCondo = CONDOS.map((c) => ({ condo: c, ...simulateCondoMonth(c, CHARGERS.find((ch) => ch.condoId === c.id), oct) }));
  const avg = (rows) => rows.reduce((s, r) => s + r.perUnitSaving, 0) / rows.length;
  const sharing = perCondo.filter((r) => r.condo.sharing.enabled);
  const closed = perCondo.filter((r) => !r.condo.sharing.enabled);
  assert.ok(avg(sharing) > avg(closed), `${avg(sharing)} vs ${avg(closed)}`);
  for (const r of perCondo) assert.ok(r.perUnitSaving > 3 && r.perUnitSaving < 40, `${r.condo.id}: ${r.perUnitSaving}`);
});

test('JMB income comes from the surplus after fixed, variable and maintenance costs', () => {
  const sim = simulateCondoMonth(condo, site, oct, { occupancyFn: () => ({ resident: 0.2, visitor: 0, total: 0.2 }) });
  const fixed = 125 * condo.bays;
  close(sim.recovery.operatingSurplus, sim.revenue - sim.electricityCost - sim.kWhSold * 0.05 - fixed, 1e-6);
  close(sim.jmbIncome, sim.recovery.operatingSurplus * condo.jmbShare, 1e-6);
  const repaired = simulateCondoMonth(condo, site, oct, { occupancyFn: () => ({ resident: 0.2, visitor: 0, total: 0.2 }), maintenanceRm: 300 });
  close(sim.jmbIncome - repaired.jmbIncome, 300 * condo.jmbShare, 1e-6);
});
