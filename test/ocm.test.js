import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadChargers, ocmUrl } from '../data/ocm.js';
import { CONDO_SITES } from '../data/chargers.js';
import { DEMO_CHARGERS } from '../data/chargers-demo.js';

const DAY = 864e5;
const fixture = JSON.parse(readFileSync(new URL('./fixtures/ocm-sample.json', import.meta.url), 'utf8'));
const memStore = () => {
  const m = {};
  return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; }, removeItem: (k) => { delete m[k]; }, m };
};
const okFetch = async () => ({ ok: true, json: async () => fixture });
const badFetch = async () => { throw new Error('offline'); };

test('the request asks for full operator and connector details', () => {
  const url = ocmUrl('abc');
  assert.ok(url.startsWith('https://api.openchargemap.io/v3/poi?'));
  assert.ok(url.includes('compact=false') && url.includes('key=abc') && url.includes('distance=15'));
});

test('live success: real chargers plus pilot condos, and a saved copy', async () => {
  const storage = memStore();
  const r = await loadChargers({ fetchFn: okFetch, storage, now: 0, key: 'k' });
  assert.equal(r.source, 'live');
  assert.equal(r.chargers.length, CONDO_SITES.length + 6);
  assert.ok(storage.m['cascas.ocm.v1']);
});

test('network failure uses a fresh saved copy', async () => {
  const storage = memStore();
  await loadChargers({ fetchFn: okFetch, storage, now: 0, key: 'k' });
  const r = await loadChargers({ fetchFn: badFetch, storage, now: 2 * DAY, key: 'k' });
  assert.equal(r.source, 'saved');
  assert.equal(r.ageDays, 2);
  assert.equal(r.chargers.length, CONDO_SITES.length + 6);
});

test('a saved copy older than 7 days falls back to demo data', async () => {
  const storage = memStore();
  await loadChargers({ fetchFn: okFetch, storage, now: 0, key: 'k' });
  const r = await loadChargers({ fetchFn: badFetch, storage, now: 8 * DAY, key: 'k' });
  assert.equal(r.source, 'demo');
  assert.equal(r.chargers.length, CONDO_SITES.length + DEMO_CHARGERS.length);
});

test('no key skips the network; an empty or bad response is not saved', async () => {
  let called = false;
  const spy = async () => { called = true; return okFetch(); };
  const storage = memStore();
  const r = await loadChargers({ fetchFn: spy, storage, now: 0, key: '' });
  assert.equal(called, false);
  assert.equal(r.source, 'demo');
  const empty = await loadChargers({ fetchFn: async () => ({ ok: true, json: async () => [] }), storage, now: 0, key: 'k' });
  assert.equal(empty.source, 'demo');
  const notOk = await loadChargers({ fetchFn: async () => ({ ok: false }), storage, now: 0, key: 'k' });
  assert.equal(notOk.source, 'demo');
  assert.equal(storage.m['cascas.ocm.v1'], undefined);
});

test('storage that throws never breaks loading', async () => {
  const storage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const r = await loadChargers({ fetchFn: okFetch, storage, now: 0, key: 'k' });
  assert.equal(r.source, 'live');
});
