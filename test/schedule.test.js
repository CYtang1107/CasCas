import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargeWindows, bestWindow } from '../engine/schedule.js';

const condo = { id: 'c1', bays: 10, residentPrice: 0.9, peakSurcharge: 0.1,
  sharing: { enabled: true, days: 'weekdays', start: 9, end: 17, reservedBays: 2, visitorPrice: 1.1 } };
const site = { id: 'cs-c1', siteType: 'condo', condoId: 'c1', type: 'AC', kw: 7, bays: 10, operator: 'x', price: null };
const mall = { id: 'm', siteType: 'mall', type: 'DC', kw: 60, bays: 4, operator: 'ChargEV', price: 1.3 };
const tue1830 = new Date(2026, 9, 20, 18, 30);
const flat = () => ({ resident: 0.2, visitor: 0, total: 0.2 });

test('windows cover the next hours, starting now then on the hour', () => {
  const w = chargeWindows({ charger: mall, from: tue1830, hours: 6, kWh: 20, occupancyFn: flat });
  assert.equal(w.length, 6);
  assert.equal(w[0].at.getTime(), tue1830.getTime());
  assert.equal(w[1].at.getHours(), 19);
  assert.equal(w[1].at.getMinutes(), 0);
  assert.equal(w[0].cost, 26);
});

test('a resident at TNB peak is told to wait for the off-peak price', () => {
  const b = bestWindow({ charger: site, condo, isResident: true, from: tue1830, hours: 24, kWh: 20, occupancyFn: flat });
  assert.equal(b.now.price, 1.0);
  assert.equal(b.best.price, 0.9);
  assert.equal(b.best.at.getHours(), 22);
  assert.equal(b.savingRm, 2);
  assert.equal(b.isNow, false);
});

test('visitors only get hours when the condo is sharing', () => {
  const w = chargeWindows({ charger: site, condo, isResident: false, from: tue1830, hours: 24, kWh: 20, occupancyFn: flat });
  for (const x of w) if (x.open) assert.ok(x.at.getHours() >= 9 && x.at.getHours() < 17);
  const b = bestWindow({ charger: site, condo, isResident: false, from: tue1830, hours: 24, kWh: 20, occupancyFn: flat });
  assert.equal(b.best.at.getHours(), 9);
  assert.equal(b.now.open, false);
});

test('when now is already best, it says so', () => {
  const b = bestWindow({ charger: mall, from: new Date(2026, 9, 21, 11), hours: 12, kWh: 20, occupancyFn: flat });
  assert.equal(b.isNow, true);
  assert.equal(b.savingRm, 0);
});

test('at the same price a crowded hour loses, otherwise the earliest hour wins', () => {
  const occ = (ch, at) => ({ resident: 0, visitor: 0, total: at.getHours() === 20 ? 0.1 : 0.9 });
  const b = bestWindow({ charger: mall, from: new Date(2026, 9, 21, 18), hours: 4, kWh: 20, occupancyFn: occ });
  assert.equal(b.best.at.getHours(), 20);
});

test('an overnight resident is sent to tonight off-peak, not tomorrow morning', () => {
  const occ = (ch, at) => ({ resident: 0.5, visitor: 0, total: at.getHours() >= 7 && at.getHours() < 12 ? 0.1 : 0.6 });
  const b = bestWindow({ charger: site, condo, isResident: true, from: tue1830, hours: 24, kWh: 20, occupancyFn: occ });
  assert.equal(b.best.at.getHours(), 22);
  assert.equal(b.best.at.getDate(), 20);
});
