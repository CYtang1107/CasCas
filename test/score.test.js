import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankChargers, modeFor, effectiveReliability, formatDuration } from '../engine/score.js';
import { applyBalance } from '../engine/balance.js';

const car = { batteryKwh: 60, efficiencyKwhPerKm: 0.15, acKw: 11, dcKw: 100, connectors: ['Type2', 'CCS2'] };
const origin = { lat: 3.2, lng: 101.7 };
const north = (km) => origin.lat + km / 111.32;
const mk = (id, km, extra = {}) => ({
  id, name: id, operator: 'Test', lat: north(km), lng: origin.lng, type: 'DC', kw: 100,
  connectors: ['CCS2'], bays: 4, siteType: 'public', reliability: 0.95, price: 1.3, ...extra,
});
const quiet = () => ({ resident: 0, visitor: 0, total: 0.2 });
const wed11 = new Date(2026, 9, 21, 11, 0);
const run = (chargers, batteryPct, extra = {}) =>
  rankChargers({ chargers, car, batteryPct, origin, date: wed11, occupancyFn: quiet, ...extra });

test('battery sets the mode', () => {
  assert.equal(modeFor(5), 'urgent');
  assert.equal(modeFor(15), 'urgent');
  assert.equal(modeFor(16), 'balanced');
  assert.equal(modeFor(50), 'balanced');
  assert.equal(modeFor(51), 'saver');
});

test('urgent: the nearest charger wins even when it costs more', () => {
  const r = run([mk('near', 1, { price: 1.8 }), mk('far', 5, { price: 1.2 })], 5);
  assert.equal(r.mode, 'urgent');
  assert.equal(r.results[0].charger.id, 'near');
});

test('saver: a cheaper charger further away wins', () => {
  const r = run([mk('near', 1, { price: 1.8 }), mk('far', 5, { price: 1.2 })], 70);
  assert.equal(r.mode, 'saver');
  assert.equal(r.results[0].charger.id, 'far');
  assert.ok(r.results[0].reasons.some((x) => x.startsWith('RM')));
});

test('plug mismatch and out-of-range chargers are excluded with reasons', () => {
  const r = run([mk('chademo', 1, { connectors: ['CHAdeMO'] }), mk('toofar', 100)], 20);
  assert.equal(r.results.length, 0);
  const reasons = Object.fromEntries(r.excluded.map((x) => [x.charger.id, x.reason]));
  assert.match(reasons.chademo, /Plug/);
  assert.match(reasons.toofar, /Out of range/);
});

test('condo bays: residents always, outsiders only while sharing is open', () => {
  const condo = { id: 'c1', bays: 10, residentPrice: 0.9, peakSurcharge: 0.1,
    sharing: { enabled: true, days: 'weekdays', start: 9, end: 17, reservedBays: 2, visitorPrice: 1.1 } };
  const site = mk('cs', 0.5, { type: 'AC', kw: 7, connectors: ['Type2'], siteType: 'condo', condoId: 'c1', bays: 10, price: null });
  const night = new Date(2026, 9, 21, 20, 0);
  const outsiderNight = run([site], 40, { condos: [condo], date: night });
  assert.match(outsiderNight.excluded[0].reason, /Residents only/);
  const residentNight = run([site], 40, { condos: [condo], date: night, residentCondoId: 'c1' });
  assert.equal(residentNight.results[0].isResident, true);
  assert.equal(residentNight.results[0].price, 1.0);
  const outsiderDay = run([site], 40, { condos: [condo] });
  assert.equal(outsiderDay.results[0].isSharedVisit, true);
  assert.equal(outsiderDay.results[0].price, 1.1);
  assert.ok(outsiderDay.results[0].reasons.includes('Shared condo bay'));
});

test('review focus: full battery needs no charge and produces no NaN', () => {
  const r = run([mk('a', 1), mk('b', 2)], 100);
  assert.equal(r.kWh, 0);
  assert.ok(r.results.every((c) => Number.isFinite(c.score) && c.cost === 0));
});

test('review focus: nothing reachable returns empty results with distances', () => {
  const r = run([mk('far', 100)], 5);
  assert.equal(r.results.length, 0);
  assert.ok(r.excluded[0].km > 90);
});

test('review focus: problem check-ins pull reliability down', () => {
  assert.equal(effectiveReliability(0.9, []), 0.9);
  assert.ok(effectiveReliability(0.9, Array(5).fill({ ok: false })) < 0.75);
  assert.ok(effectiveReliability(0.9, Array(5).fill({ ok: true })) > 0.9);
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '1 min');
  assert.equal(formatDuration(27), '27 min');
  assert.equal(formatDuration(60), '1 h');
  assert.equal(formatDuration(95), '1 h 35 min');
});

const c = (id, score, cost, occupancy) => ({ charger: { id, name: id }, score, cost, occupancy });

test('balance: saver demotes a busy top pick and explains the saving', () => {
  const { results, note } = applyBalance([c('busy', 0.2, 10, 0.9), c('quiet', 0.3, 8, 0.3)], 'saver');
  assert.equal(results[0].charger.id, 'quiet');
  assert.match(note, /busy charger at busy/);
  assert.match(note, /RM2\.00/);
});

test('balance: urgent never penalises, and no note when the top pick holds', () => {
  const urgent = applyBalance([c('busy', 0.2, 10, 0.9), c('quiet', 0.3, 8, 0.3)], 'urgent');
  assert.equal(urgent.results[0].charger.id, 'busy');
  assert.equal(urgent.note, null);
  const holds = applyBalance([c('busy', 0.1, 10, 0.9), c('quiet', 0.5, 8, 0.3)], 'saver');
  assert.equal(holds.results[0].charger.id, 'busy');
  assert.equal(holds.note, null);
});

test('rankChargers attaches the balance note end to end', () => {
  // Worked numbers: before balancing busy scores 0.121 and quiet 0.188; the +0.25 penalty flips them.
  const busyFirst = (ch) => ({ resident: 0, visitor: 0, total: ch.id === 'busy' ? 0.8 : 0.2 });
  const chargers = [mk('busy', 1, { price: 1.0 }), mk('quiet', 1.2, { price: 1.15 }), mk('far', 5, { price: 1.5 })];
  const r = run(chargers, 70, { occupancyFn: busyFirst });
  assert.equal(r.results[0].charger.id, 'quiet');
  assert.match(r.balanceNote, /low-battery drivers/);
});

test('review fix: a charger with many problem reports leaves the picks in every mode', () => {
  const chargers = [mk('broken', 1, { price: 1.0, reliability: 0.5 }), mk('ok1', 2), mk('ok2', 3), mk('ok3', 4)];
  for (const pct of [8, 35, 70]) {
    const r = run(chargers, pct);
    assert.ok(!r.results.some((c) => c.charger.id === 'broken'), `battery ${pct}`);
    assert.match(r.excluded.find((x) => x.charger.id === 'broken').reason, /problem reports/);
  }
});
