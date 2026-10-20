import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadState, saveState, resetState, addSession, anonNumber, MAX_SESSIONS } from '../state.js';
import { buildWorld } from '../engine/world.js';
import { esc, rm, rm0, pct, fmtDay } from '../views/format.js';
import { barChart24, lineChart } from '../views/charts.js';

const setStorage = (value) => Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
afterEach(() => setStorage(undefined));

const BLANK = { checkins: {}, booking: null, sharing: {}, sessions: [], visitorPasses: [], anonNo: null, maintenance: {}, searchHistory: [], favourites: [], profile: { name: '', carId: null, homeId: '', prefs: null, theme: 'light' }, proposals: {}, voterId: '', myVotes: {} };

test('review focus: corrupt storage falls back to blank state', () => {
  setStorage({ getItem: () => '{bad json', setItem() {}, removeItem() {} });
  const s = loadState();
  assert.deepEqual(s, BLANK);
});

test('review focus: storage that throws never breaks saving or reset', () => {
  setStorage({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } });
  const s = loadState();
  s.booking = { chargerId: 'x' };
  assert.doesNotThrow(() => saveState(s));
  assert.equal(loadState().booking.chargerId, 'x'); // kept in memory
  assert.deepEqual(resetState(), BLANK);
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
  assert.equal(fmtDay(new Date(2026, 9, 21)), new Date(2026, 9, 21).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }));
});

test('charts render one bar pair per hour and one path per series', () => {
  const svg = barChart24({ a: Array(24).fill(1), b: Array(24).fill(0.5), shade: [14, 15], aLabel: 'Residents', bLabel: 'Visitors' });
  assert.equal((svg.match(/class="sa"/g) || []).length, 24);
  assert.equal((svg.match(/class="sb"/g) || []).length, 24);
  assert.equal((svg.match(/class="shade"/g) || []).length, 2);
  const line = lineChart({ labels: ['May', 'Jun'], series: [{ label: 'A', values: [1, 2], cls: 'la' }, { label: 'B', values: [0, 1], cls: 'lb' }] });
  assert.equal((line.match(/<path /g) || []).length, 2);
  assert.ok(!svg.includes('NaN') && !line.includes('NaN'));
  const pctLine = lineChart({ labels: ['a', 'b'], series: [{ label: 'Rate', values: [40, 60], cls: 'la' }], money: false, unit: '%', ariaLabel: 'Follow rate' });
  assert.ok(pctLine.includes('100%') && !pctLine.includes('RM') && pctLine.includes('aria-label="Follow rate"'));
});

test('review fix: stored JSON with the wrong shape is cleaned instead of crashing', () => {
  for (const raw of ['{"checkins":null}', '{"checkins":{"klem-dc":"x"},"sharing":[]}', '[]', 'null']) {
    setStorage({ getItem: () => raw, setItem() {}, removeItem() {} });
    resetState();
    const s = loadState();
    assert.equal(typeof s.checkins, 'object', raw);
    assert.ok(s.checkins && !Array.isArray(s.checkins), raw);
    assert.ok(Object.values(s.checkins).every(Array.isArray), raw);
    assert.ok(s.sharing && !Array.isArray(s.sharing), raw);
    assert.doesNotThrow(() => buildWorld(s), raw);
  }
});

test('sessions and visitor passes survive a reload; bad entries are dropped', () => {
  const raw = JSON.stringify({ sessions: [{ at: 1 }, 'x', null, { at: 2 }], visitorPasses: [{ id: 'p1' }, 7], anonNo: 12 });
  setStorage({ getItem: () => raw, setItem() {}, removeItem() {} });
  resetState();
  const s = loadState();
  assert.deepEqual(s.sessions, [{ at: 1 }, { at: 2 }]);
  assert.deepEqual(s.visitorPasses, [{ id: 'p1' }]);
  assert.equal(s.anonNo, 12);
});

test('addSession keeps only the latest MAX_SESSIONS records', () => {
  const s = resetState();
  for (let i = 0; i < MAX_SESSIONS + 10; i++) addSession(s, { at: i });
  assert.equal(s.sessions.length, MAX_SESSIONS);
  assert.equal(s.sessions[0].at, 10);
  assert.equal(s.sessions.at(-1).at, MAX_SESSIONS + 9);
});

test('anonNumber is picked once per device and then stays the same', () => {
  const s = resetState();
  const n = anonNumber(s, () => 0.5);
  assert.equal(n, 50);
  assert.equal(anonNumber(s, () => 0.1), 50);
});

test('the driver profile is cleaned: bad fields fall back, the name is trimmed and capped', () => {
  setStorage({ getItem: () => JSON.stringify({ profile: { name: '  Chee Yang  '.repeat(5), carId: 'atto3', homeId: 7, theme: 'neon', prefs: { maxPrice: 1.2, fastOnly: 'yes', operator: 'Gentari' } } }), setItem() {}, removeItem() {} });
  const p = loadState().profile;
  assert.ok(p.name.length <= 40);
  assert.equal(p.name.startsWith('Chee Yang'), true);
  assert.equal(p.carId, 'atto3');
  assert.equal(p.homeId, '');
  assert.equal(p.theme, 'light');
  assert.deepEqual(p.prefs, { maxPrice: 1.2, fastOnly: false, operator: 'Gentari' });
});
