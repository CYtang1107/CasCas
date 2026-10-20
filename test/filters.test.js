import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyFilters, countFilters, matchesFilters } from '../engine/filters.js';

const info = (extra = {}) => ({ type: 'DC', kw: 60, connectors: ['CCS2'], operator: 'Gentari', free: 2, condoSharedNow: false, price: 1.3, promo: null, ...extra });

test('no filters lets everything through', () => {
  const f = emptyFilters();
  assert.equal(countFilters(f), 0);
  assert.equal(matchesFilters(info(), f), true);
  assert.equal(matchesFilters(info({ free: 0, type: 'AC' }), f), true);
});

test('charger type: AC, DC and fast DC (50 kW and up); several types are OR-ed', () => {
  const f = { ...emptyFilters(), types: ['fast'] };
  assert.equal(matchesFilters(info({ kw: 60 }), f), true);
  assert.equal(matchesFilters(info({ kw: 40 }), f), false);
  assert.equal(matchesFilters(info({ type: 'AC', kw: 22 }), { ...f, types: ['ac', 'fast'] }), true);
  assert.equal(matchesFilters(info({ type: 'AC', kw: 22 }), { ...f, types: ['dc'] }), false);
});

test('plugs and brands match any of the chosen ones', () => {
  assert.equal(matchesFilters(info(), { ...emptyFilters(), plugs: ['Type2', 'CCS2'] }), true);
  assert.equal(matchesFilters(info(), { ...emptyFilters(), plugs: ['CHAdeMO'] }), false);
  assert.equal(matchesFilters(info({ operator: 'Gentari Sdn Bhd' }), { ...emptyFilters(), brands: ['Gentari'] }), true);
  assert.equal(matchesFilters(info(), { ...emptyFilters(), brands: ['ChargEV', 'JomCharge'] }), false);
});

test('available now, condo shared now, price cap and promotions are AND-ed', () => {
  const f = { ...emptyFilters(), available: true, maxPrice: 1.0 };
  assert.equal(countFilters(f), 2);
  assert.equal(matchesFilters(info({ price: 0.9 }), f), true);
  assert.equal(matchesFilters(info({ price: 0.9, free: 0 }), f), false);
  assert.equal(matchesFilters(info({ price: 1.1 }), f), false);
  assert.equal(matchesFilters(info({ condoSharedNow: true }), { ...emptyFilters(), condoShared: true }), true);
  assert.equal(matchesFilters(info(), { ...emptyFilters(), condoShared: true }), false);
  assert.equal(matchesFilters(info({ promo: 'Off-peak price' }), { ...emptyFilters(), promo: true }), true);
  assert.equal(matchesFilters(info(), { ...emptyFilters(), promo: true }), false);
});

test('count adds one per chosen option', () => {
  assert.equal(countFilters({ ...emptyFilters(), types: ['ac', 'dc'], brands: ['Gentari'], promo: true }), 4);
});
