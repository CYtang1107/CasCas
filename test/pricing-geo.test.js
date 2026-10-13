import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPeak, tnbRate } from '../data/tariff.js';
import { priceAt, priceNote } from '../engine/pricing.js';
import { distanceKm, driveMinutes, detourMinutes } from '../engine/geo.js';

test('TNB peak is weekdays 14:00 to 21:59', () => {
  assert.equal(isPeak(new Date(2026, 9, 20, 14, 0)), true);
  assert.equal(isPeak(new Date(2026, 9, 20, 21, 59)), true);
  assert.equal(isPeak(new Date(2026, 9, 20, 22, 0)), false);
  assert.equal(isPeak(new Date(2026, 9, 20, 13, 59)), false);
  assert.equal(isPeak(new Date(2026, 9, 24, 18, 0)), false); // Saturday
  assert.equal(tnbRate(new Date(2026, 9, 20, 18, 0)), 0.2852);
  assert.equal(tnbRate(new Date(2026, 9, 20, 9, 0)), 0.2443);
});

const condo = { residentPrice: 0.9, peakSurcharge: 0.1, sharing: { visitorPrice: 1.1 } };
const condoSite = { siteType: 'condo', operator: 'Condo CPO partner', price: null };

test('condo price depends on resident status and TNB peak', () => {
  assert.equal(priceAt(condoSite, new Date(2026, 9, 21, 11), condo, true), 0.9);
  assert.equal(priceAt(condoSite, new Date(2026, 9, 21, 11), condo, false), 1.1);
  assert.equal(priceAt(condoSite, new Date(2026, 9, 20, 18, 30), condo, true), 1.0);
  assert.equal(priceAt(condoSite, new Date(2026, 9, 20, 18, 30), condo, false), 1.2);
  assert.equal(priceNote(condoSite, new Date(2026, 9, 21, 11), condo), 'Off-peak price');
  assert.equal(priceNote(condoSite, new Date(2026, 9, 20, 18, 30), condo), 'Peak-hour price');
});

test('Gentari early-bird is 15% off before 7 AM only', () => {
  const g = { siteType: 'public', operator: 'Gentari', type: 'DC', price: 1.4 };
  const gAc = { siteType: 'mall', operator: 'Gentari', type: 'AC', price: 1.0 };
  assert.equal(priceAt(gAc, new Date(2026, 9, 21, 2)), 1.0); // trial covered DC fast charging only
  assert.equal(priceNote(gAc, new Date(2026, 9, 21, 2), null), null);
  assert.equal(priceAt(g, new Date(2026, 9, 21, 2)), 1.19);
  assert.equal(priceAt(g, new Date(2026, 9, 21, 7)), 1.4);
  assert.equal(priceNote(g, new Date(2026, 9, 21, 2), null), 'Early-bird rate');
  const j = { siteType: 'public', operator: 'JomCharge', price: 1.3 };
  assert.equal(priceAt(j, new Date(2026, 9, 21, 2)), 1.3);
  assert.equal(priceNote(j, new Date(2026, 9, 21, 2), null), null);
});

test('distance and drive time', () => {
  const klem = { lat: 3.2126, lng: 101.7235 };
  const klcc = { lat: 3.1579, lng: 101.7123 };
  const d = distanceKm(klem, klcc);
  assert.ok(d > 5.5 && d < 7, `got ${d}`);
  assert.equal(driveMinutes(10), 26);
});

test('detour is zero when the charger is at the origin and positive otherwise', () => {
  const o = { lat: 3.2, lng: 101.7 };
  const dest = { lat: 3.21, lng: 101.7 };
  assert.ok(Math.abs(detourMinutes(o, o, dest)) < 1e-9);
  assert.ok(detourMinutes(o, { lat: 3.2, lng: 101.72 }, dest) > 0);
});
