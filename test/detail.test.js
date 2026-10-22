import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeCharger, priceComparison, availability, monthSummary } from '../engine/detail.js';

const wed11 = new Date(2026, 9, 21, 11);
const charger = (extra = {}) => ({ id: 'a', name: 'KL East Mall DC', address: 'Jalan 1, KL', operator: 'Gentari', lat: 3.21, lng: 101.72,
  type: 'DC', kw: 60, connectors: ['CCS2'], bays: 4, siteType: 'mall', reliability: 0.9, price: 1.3, ...extra });
const result = (id, extra = {}) => ({ charger: { id }, price: 1.3, occupancy: 0.5, waitMin: 0, cost: 35.1, kWh: 27, deliveredKwh: 27, full: true,
  addedKm: 180, walkMin: 3, detourMin: 2, reasons: ['RM35.10 for 27 kWh', 'On your way'], ...extra });
const ranking = { kWh: 27, results: [result('x'), result('a', { reasons: ['RM35.10 for 27 kWh', 'On your way', '3 min walk to KL East Mall'] }), result('y'), result('z'), result('w')], excluded: [{ charger: { id: 'slow' }, reason: 'Too slow for a 30 min stop', km: 1 }] };

test('a ranked charger gets its verdict, trip numbers and booking', () => {
  const d = describeCharger({ charger: charger(), ranking, date: wed11, checkins: [] });
  assert.equal(d.rank, 2);
  assert.equal(d.verdict, 'CasSama pick #2');
  assert.equal(d.bookable, true);
  assert.deepEqual(d.trip, { cost: 35.1, kWh: 27, addedKm: 180, walkMin: 3, detourMin: 2, full: true });
  assert.equal(d.reliabilityPct, 90);
  assert.equal(d.occupancyPct, 50);
  assert.equal(d.directionsUrl, 'https://www.google.com/maps/dir/?api=1&destination=3.21,101.72');
  assert.ok(d.reasons.includes('3 min walk to KL East Mall'));
});

test('ranked below the top 3 says where it ranks', () => {
  const d = describeCharger({ charger: charger({ id: 'w' }), ranking, date: wed11, checkins: [] });
  assert.equal(d.verdict, 'Ranked #5 of 5');
  assert.equal(d.bookable, true);
});

test('an unsuitable charger explains why and cannot be booked', () => {
  const d = describeCharger({ charger: charger({ id: 'slow', type: 'AC', kw: 7 }), ranking, date: wed11, checkins: [] });
  assert.equal(d.verdict, 'Not suitable now: Too slow for a 30 min stop');
  assert.equal(d.bookable, false);
  assert.equal(d.tooSlow, true); // the panel offers a longer stay
  assert.equal(describeCharger({ charger: charger(), ranking, date: wed11, checkins: [] }).tooSlow, false);
  assert.equal(d.trip, null);
  assert.ok(d.priceNow > 0);
  assert.ok(d.occupancyPct >= 0 && d.occupancyPct <= 100);
});

test('the last three check-ins come newest first', () => {
  const checkins = [1, 2, 3, 4].map((at) => ({ ok: at % 2 === 0, note: `n${at}`, at }));
  const d = describeCharger({ charger: charger(), ranking, date: wed11, checkins });
  assert.equal(d.checkinCount, 4);
  assert.deepEqual(d.recentCheckins.map((c) => c.at), [4, 3, 2]);
});

test('condo bays say whether they are shared now', () => {
  const condo = { id: 'c1', name: 'Residensi Lumina', bays: 10, residentPrice: 0.9, peakSurcharge: 0.1,
    sharing: { enabled: true, days: 'weekdays', start: 9, end: 17, reservedBays: 2, visitorPrice: 1.1 } };
  const site = charger({ id: 'cs-c1', siteType: 'condo', condoId: 'c1', type: 'AC', kw: 7, price: null, pilot: true });
  assert.equal(describeCharger({ charger: site, ranking, condo, date: wed11, checkins: [] }).access, 'Shared now with visitors');
  assert.equal(describeCharger({ charger: site, ranking, condo, date: new Date(2026, 9, 21, 20), checkins: [] }).access, 'Residents only right now');
  assert.equal(describeCharger({ charger: site, ranking, condo, isResident: true, date: wed11, checkins: [] }).access, 'Your condo bay');
  assert.equal(describeCharger({ charger: charger(), ranking, date: wed11, checkins: [] }).access, null);
});

test('no charge needed is said plainly', () => {
  const d = describeCharger({ charger: charger(), ranking: { kWh: 0, results: [], excluded: [] }, date: wed11, checkins: [] });
  assert.equal(d.verdict, 'No charge needed for this trip');
});

test('price comparison lists every option cheapest first, with the gap to the cheapest', () => {
  const rows = priceComparison([
    { ...result('a', { cost: 30, price: 1.1 }), charger: charger({ id: 'a', name: 'A' }), km: 1.2 },
    { ...result('b', { cost: 20, price: 0.9 }), charger: charger({ id: 'b', name: 'B', type: 'AC', kw: 22 }), km: 3 },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ['b', 'a']);
  assert.equal(rows[0].cost, 20);
  assert.equal(rows[0].vsCheapest, 0);
  assert.equal(rows[1].vsCheapest, 10);
  assert.equal(rows[0].kind, 'AC 22 kW');
});

test('availability: free bays out of the total, never below zero', () => {
  assert.deepEqual(availability({ bays: 4 }, 0.5), { free: 2, total: 4 });
  assert.deepEqual(availability({ bays: 4 }, 0.6), { free: 1, total: 4 });
  assert.deepEqual(availability({ bays: 2 }, 1.2), { free: 0, total: 2 });
  assert.deepEqual(availability({}, 0.2), { free: 0, total: 0 });
});

test('month summary: sessions, energy, paid and CO2 for this month only', () => {
  const at = (d) => new Date(2026, 9, d, 10).getTime();
  const s = monthSummary([{ at: at(2), kWh: 20, costRm: 22 }, { at: at(15), kWh: 10, costRm: 9 }, { at: new Date(2026, 8, 30).getTime(), kWh: 50, costRm: 60 }], new Date(2026, 9, 21));
  assert.equal(s.sessions, 2);
  assert.equal(s.kWh, 30);
  assert.equal(s.paidRm, 31);
  assert.ok(s.co2Kg > 0);
});

test('live bays win over the estimate when we have them', () => {
  assert.deepEqual(availability({ bays: 4, liveAvail: { total: 2, available: 1 }, liveOcc: 0.5 }, 0.9), { free: 1, total: 2, live: true });
  assert.deepEqual(availability({ bays: 4, liveAvail: { total: 2, available: 1 } }, 0.5), { free: 2, total: 4 }, 'live data but a different demo time: estimate');
});
