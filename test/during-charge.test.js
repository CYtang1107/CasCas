import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankChargers } from '../engine/score.js';
import { walkMinutes } from '../engine/geo.js';
import { overstayFee } from '../engine/pricing.js';
import { overstayTotals, buildSession } from '../engine/insights.js';
import { simulateHistory } from '../engine/history.js';
import { CONDOS } from '../data/condos.js';
import { CHARGERS } from '../data/chargers.js';

const car = { batteryKwh: 60, efficiencyKwhPerKm: 0.15, acKw: 11, dcKw: 100, connectors: ['Type2', 'CCS2'] };
const origin = { lat: 3.2, lng: 101.7 };
const north = (km) => origin.lat + km / 111.32;
const mk = (id, km, extra = {}) => ({
  id, name: id, operator: 'Test', lat: north(km), lng: origin.lng, type: 'DC', kw: 100,
  connectors: ['CCS2'], bays: 4, siteType: 'public', reliability: 0.95, price: 1.3, ...extra,
});
const quiet = () => ({ resident: 0, visitor: 0, total: 0.2 });
const wed11 = new Date(2026, 9, 21, 11, 0);

test('walking time: about 16 min per km on foot (with the road factor)', () => {
  const m = walkMinutes({ lat: 3.2, lng: 101.7 }, { lat: north(1), lng: 101.7 });
  assert.ok(Math.abs(m - 16.25) < 0.1, String(m));
});

test('picks near the destination say how far the walk is', () => {
  const mall = { id: 'mall', name: 'KL East Mall', lat: north(3), lng: origin.lng };
  const r = rankChargers({ chargers: [mk('at-mall', 3.05), mk('far', 8)], car, batteryPct: 35, origin, destination: mall, date: wed11, occupancyFn: quiet });
  const near = r.results.find((c) => c.charger.id === 'at-mall');
  assert.ok(near.reasons.includes('1 min walk to KL East Mall'), near.reasons.join(' | '));
  const far = r.results.find((c) => c.charger.id === 'far');
  assert.ok(!far.reasons.some((x) => x.includes('walk')), 'no walk line beyond 20 min');
  const noDest = rankChargers({ chargers: [mk('a', 1)], car, batteryPct: 35, origin, date: wed11, occupancyFn: quiet });
  assert.ok(!noDest.results[0].reasons.some((x) => x.includes('walk')));
});

test('overstay fee: RM1 per started 10 minutes after the slot', () => {
  assert.equal(overstayFee(0), 0);
  assert.equal(overstayFee(-5), 0);
  assert.equal(overstayFee(1), 1);
  assert.equal(overstayFee(10), 1);
  assert.equal(overstayFee(25), 3);
});

test('new booking sessions start with no overstay', () => {
  const ranking = { mode: 'balanced', results: [{ charger: { id: 'a' }, km: 1, cost: 10, timeMin: 5, kWh: 10, condo: null }] };
  assert.equal(buildSession({ ranking, chosenId: 'a', at: 1, anonNo: 2, resident: false }).overstayMin, 0);
});

test('simulated history: some visitors overstay, residents never do', () => {
  const lumina = CONDOS.find((c) => c.id === 'lumina');
  const h = simulateHistory(lumina, CHARGERS.find((ch) => ch.condoId === 'lumina'), new Date(2026, 9, 21, 11).getTime());
  assert.ok(h.every((s) => Number.isInteger(s.overstayMin) && s.overstayMin >= 0));
  assert.ok(h.filter((s) => s.role === 'resident').every((s) => s.overstayMin === 0));
  assert.ok(h.some((s) => s.role === 'visitor' && s.overstayMin > 0));
});

test('overstay totals count sessions and fees', () => {
  const s = (overstayMin) => ({ overstayMin });
  assert.deepEqual(overstayTotals([s(0), s(25), s(5), {}]), { count: 2, feesRm: 4 });
});
