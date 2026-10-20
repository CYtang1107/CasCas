import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createAuth } from '../server/auth.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cascas-'));
const DAY = 864e5;

test('store starts empty, saves atomically and reloads', () => {
  const dir = tmp();
  const a = createStore(dir);
  assert.deepEqual(a.data, { sharing: {}, checkins: {}, maintenance: {}, proposals: {}, sessions: [], passes: [], bookings: [] });
  a.data.sessions.push({ at: 1 });
  a.save();
  assert.ok(!fs.existsSync(path.join(dir, 'store.json.tmp')));
  assert.deepEqual(createStore(dir).data.sessions, [{ at: 1 }]);
});

test('a corrupt store file starts empty instead of crashing', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'store.json'), '{bad');
  assert.deepEqual(createStore(dir).data.passes, []);
});

test('prune drops passes 30 days after the slot and bookings made over 2 days ago', () => {
  const s = createStore(tmp());
  const now = 100 * DAY;
  s.data.passes = [{ id: 'old', slotEnd: now - 31 * DAY }, { id: 'new', slotEnd: now + DAY }];
  s.data.bookings = [{ id: 'b1', createdAt: now - 3 * DAY }, { id: 'b2', createdAt: now - DAY }];
  s.prune(now);
  assert.deepEqual(s.data.passes.map((p) => p.id), ['new']);
  assert.deepEqual(s.data.bookings.map((b) => b.id), ['b2']);
});

test('PIN login gives a token for that condo only; tokens expire', () => {
  let t = 1000;
  const auth = createAuth({ secret: 's3cret', pins: { lumina: '4821', serini: '7305' }, now: () => t });
  assert.equal(auth.login('lumina', '0000').status, 401);
  const ok = auth.login('lumina', '4821');
  assert.equal(ok.status, 200);
  assert.ok(auth.verify(`Bearer ${ok.token}`, 'lumina'));
  assert.ok(!auth.verify(`Bearer ${ok.token}`, 'serini'));
  assert.ok(!auth.verify(`Bearer ${ok.token.slice(0, -2)}xx`, 'lumina'));
  assert.ok(!auth.verify(undefined, 'lumina'));
  t += 12 * 3600e3 + 1;
  assert.ok(!auth.verify(`Bearer ${ok.token}`, 'lumina'));
});

test('ten wrong PINs in 10 minutes lock that condo', () => {
  let t = 0;
  const auth = createAuth({ secret: 'x', pins: { lumina: '4821' }, now: () => t });
  for (let i = 0; i < 10; i++) assert.equal(auth.login('lumina', '1').status, 401);
  assert.equal(auth.login('lumina', '4821').status, 429);
  t += 10 * 60e3 + 1;
  assert.equal(auth.login('lumina', '4821').status, 200);
});
