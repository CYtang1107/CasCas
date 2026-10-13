import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadState, saveState, resetState } from '../state.js';
import { buildWorld } from '../engine/world.js';
import { esc, rm, rm0, pct } from '../views/format.js';
import { barChart24, lineChart } from '../views/charts.js';

const setStorage = (value) => Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
afterEach(() => setStorage(undefined));

test('review focus: corrupt storage falls back to blank state', () => {
  setStorage({ getItem: () => '{bad json', setItem() {}, removeItem() {} });
  const s = loadState();
  assert.deepEqual(s, { checkins: {}, booking: null, sharing: {} });
});

test('review focus: storage that throws never breaks saving or reset', () => {
  setStorage({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } });
  const s = loadState();
  s.booking = { chargerId: 'x' };
  assert.doesNotThrow(() => saveState(s));
  assert.equal(loadState().booking.chargerId, 'x'); // kept in memory
  assert.deepEqual(resetState(), { checkins: {}, booking: null, sharing: {} });
});

test('saved state round-trips through storage', () => {
  const store = {};
  setStorage({ getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } });
  const s = resetState();
  s.sharing.lumina = { enabled: false };
  saveState(s);
  assert.equal(loadState().sharing.lumina.enabled, false);
});

test('buildWorld applies sharing overrides and check-ins', () => {
  const condos = [{ id: 'c1', bays: 10, sharing: { enabled: true, days: 'weekdays', start: 9, end: 17, reservedBays: 2, visitorPrice: 1.1 } }];
  const chargers = [{ id: 'x', reliability: 0.9 }];
  const state = { checkins: { x: Array(5).fill({ ok: false }) }, booking: null, sharing: { c1: { start: 10 } } };
  const w = buildWorld(state, condos, chargers);
  assert.equal(w.condos[0].sharing.start, 10);
  assert.equal(w.condos[0].sharing.end, 17);
  assert.ok(w.chargers[0].reliability < 0.75);
  assert.equal(condos[0].sharing.start, 9); // source data untouched
});

test('format helpers', () => {
  assert.equal(esc('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
  assert.equal(rm(1.1), 'RM1.10');
  assert.equal(rm0(3528.4), 'RM3,528');
  assert.equal(pct(0.294), '29%');
});

test('charts render one bar pair per hour and one path per series', () => {
  const svg = barChart24({ a: Array(24).fill(1), b: Array(24).fill(0.5), shade: [14, 15], aLabel: 'Residents', bLabel: 'Visitors' });
  assert.equal((svg.match(/class="sa"/g) || []).length, 24);
  assert.equal((svg.match(/class="sb"/g) || []).length, 24);
  assert.equal((svg.match(/class="shade"/g) || []).length, 2);
  const line = lineChart({ labels: ['May', 'Jun'], series: [{ label: 'A', values: [1, 2], cls: 'la' }, { label: 'B', values: [0, 1], cls: 'lb' }] });
  assert.equal((line.match(/<path /g) || []).length, 2);
  assert.ok(!svg.includes('NaN') && !line.includes('NaN'));
});
