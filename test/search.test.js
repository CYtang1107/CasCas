import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchSites, categoryOf, remember } from '../engine/search.js';

const site = (id, name, extra = {}) => ({ id, name, operator: 'Gentari', type: 'DC', category: 'Shopping mall', address: '', km: 1, ...extra });
const sites = [
  site('klem-dc', 'KL East Mall DC', { km: 0.5 }),
  site('klem-ac', 'KL East Mall AC', { type: 'AC', km: 0.4 }),
  site('melati', 'Taman Melati LRT AC', { type: 'AC', operator: 'ChargEV', category: 'Public', km: 1.2 }),
  site('cs-lumina', 'Residensi Lumina car park', { type: 'AC', operator: 'Condo CPO partner', category: 'Residential condo', km: 0.6 }),
];

test('empty search lists everything nearest first', () => {
  assert.deepEqual(searchSites(sites, '').map((s) => s.id), ['klem-ac', 'klem-dc', 'cs-lumina', 'melati']);
});

test('every word must match a name, operator, category, type or address, in any case', () => {
  assert.deepEqual(searchSites(sites, 'kl east dc').map((s) => s.id), ['klem-dc']);
  assert.deepEqual(searchSites(sites, 'CHARGEV').map((s) => s.id), ['melati']);
  assert.deepEqual(searchSites(sites, 'condo').map((s) => s.id), ['cs-lumina']);
  assert.deepEqual(searchSites(sites, 'mall ac').map((s) => s.id), ['klem-ac']);
  assert.deepEqual(searchSites(sites, 'tesla'), []);
});

test('a name that starts with the search comes before other matches', () => {
  const r = searchSites([site('a', 'Wangsa Walk Mall', { km: 3 }), site('b', 'Mall of Wangsa', { km: 1 })], 'wangsa');
  assert.deepEqual(r.map((s) => s.id), ['a', 'b']);
});

test('categories for each kind of site', () => {
  assert.equal(categoryOf({ siteType: 'condo' }), 'Residential condo');
  assert.equal(categoryOf({ siteType: 'mall' }), 'Shopping mall');
  assert.equal(categoryOf({ siteType: 'public', highway: true }), 'Highway');
  assert.equal(categoryOf({ siteType: 'public' }), 'Public');
});

test('search history keeps the newest six, without repeats or blanks', () => {
  let h = [];
  for (const q of ['dc', 'condo', 'DC ', '', 'mall', 'a', 'b', 'c', 'd']) h = remember(h, q);
  assert.deepEqual(h, ['d', 'c', 'b', 'a', 'mall', 'DC']); // the newer 'DC ' replaced 'dc'
});
