import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, detectServer } from '../data/api.js';
import { occupancyAt } from '../engine/occupancy.js';

const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });

test('success, server errors and network failures have one shape', async () => {
  assert.deepEqual(await createApi({ fetchFn: reply(200, { ok: true }) }).health(), { ok: true, data: { ok: true } });
  assert.deepEqual(await createApi({ fetchFn: reply(409, { error: 'Not sharing' }) }).book({}), { ok: false, status: 409, error: 'Not sharing' });
  const down = createApi({ fetchFn: async () => { throw new Error('offline'); } });
  assert.deepEqual(await down.world(1), { ok: false, status: 0, error: 'Server unavailable' });
});

test('requests use relative URLs, tokens and bodies as the server expects', async () => {
  const calls = [];
  const api = createApi({ fetchFn: async (url, opts) => { calls.push({ url, ...opts }); return { ok: true, status: 200, json: async () => ({}) }; } });
  await api.world(123);
  await api.jmb('lumina', 'tok');
  await api.cancel('b 1', 'secret');
  await api.saveSharing('lumina', 'tok', { enabled: true });
  assert.equal(calls[0].url, 'api/world?at=123');
  assert.equal(calls[1].headers.authorization, 'Bearer tok');
  assert.equal(calls[2].url, 'api/bookings/b%201');
  assert.equal(calls[2].method, 'DELETE');
  assert.deepEqual(JSON.parse(calls[2].body), { cancelToken: 'secret' });
  assert.equal(calls[3].method, 'PUT');
  assert.deepEqual(JSON.parse(calls[3].body), { sharing: { enabled: true } });
});

test('detectServer: true only for a real CasCas health reply', async () => {
  assert.equal(await detectServer(createApi({ fetchFn: reply(200, { ok: true }) })), true);
  assert.equal(await detectServer(createApi({ fetchFn: reply(404, null) })), false); // GitHub Pages
  assert.equal(await detectServer(createApi({ fetchFn: async () => { throw new Error('x'); } })), false);
});

test('booked bays add to occupancy, capped at full', () => {
  const ch = { id: 'x', siteType: 'public', bays: 4 };
  const at = new Date(2026, 9, 21, 3); // quiet hour
  const base = occupancyAt(ch, at).total;
  assert.ok(Math.abs(occupancyAt({ ...ch, bookedBays: 2 }, at).total - Math.min(1, base + 0.5)) < 1e-9);
  assert.equal(occupancyAt({ ...ch, bookedBays: 10 }, at).total, 1);
});
