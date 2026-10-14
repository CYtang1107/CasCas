import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSession, followRate, savings, weeklyTrend, byMode, byRole, filterSessions, toCsv, anonLabel, CHOICE_LABEL,
} from '../engine/insights.js';

const res = (id, km, cost, timeMin, extra = {}) => ({ charger: { id }, km, cost, timeMin, kWh: 20, condo: null, isResident: false, ...extra });
const ranking = { mode: 'saver', results: [res('a', 3, 18, 20), res('b', 1, 24, 15), res('c', 5, 19, 25), res('d', 0.5, 26, 12)] };

test('buildSession compares the choice with the nearest charger', () => {
  const s = buildSession({ ranking, chosenId: 'a', at: 1000, anonNo: 12, resident: false });
  assert.deepEqual(s, {
    at: 1000, anonId: 'V12', role: 'visitor', mode: 'saver', chargerId: 'a', condoId: null,
    topPickId: 'a', nearestId: 'd', choice: 'pick1', kWh: 20, costRm: 18, nearestCostRm: 26, minutesVsNearest: 8,
  });
  assert.equal(buildSession({ ranking, chosenId: 'c', at: 1, anonNo: 3, resident: true }).choice, 'pick3');
  assert.equal(buildSession({ ranking, chosenId: 'c', at: 1, anonNo: 3, resident: true }).anonId, 'R3');
  assert.equal(buildSession({ ranking, chosenId: 'd', at: 1, anonNo: 3, resident: false }).choice, 'own');
});

test('a booking at a condo bay records the condo, never a plate', () => {
  const r = { mode: 'balanced', results: [res('cs-lumina', 1, 10, 10, { condo: { id: 'lumina' } })] };
  const s = buildSession({ ranking: r, chosenId: 'cs-lumina', at: 1, anonNo: 5, resident: false });
  assert.equal(s.condoId, 'lumina');
  assert.ok(!('plate' in s));
});

const S = (at, choice, extra = {}) => ({ at, choice, mode: 'balanced', role: 'resident', condoId: 'lumina', costRm: 10, nearestCostRm: 12, minutesVsNearest: 2, kWh: 20, anonId: 'R1', ...extra });

test('follow rate and savings', () => {
  const list = [S(1, 'pick1'), S(2, 'pick2'), S(3, 'own', { nearestCostRm: 10, minutesVsNearest: 0 }), S(4, 'pick3')];
  assert.equal(followRate(list), 0.75);
  assert.equal(followRate([]), 0);
  assert.deepEqual(savings(list), { avgRm: 1.5, totalRm: 6, avgMinutes: 2 });
  assert.deepEqual(savings([]), { avgRm: 0, totalRm: 0, avgMinutes: 0 });
});

test('weekly trend buckets by Monday, across a month boundary', () => {
  const end = new Date(2026, 10, 4, 12).getTime(); // Wed 4 Nov 2026
  const list = [
    S(new Date(2026, 9, 31, 10).getTime(), 'own'),   // Sat 31 Oct → week of Mon 26 Oct
    S(new Date(2026, 10, 1, 22).getTime(), 'pick1'), // Sun 1 Nov → week of Mon 26 Oct
    S(new Date(2026, 10, 2, 0, 30).getTime(), 'pick2'), // Mon 2 Nov → week of Mon 2 Nov
  ];
  const t = weeklyTrend(list, end, 2);
  assert.equal(t.length, 2);
  assert.equal(t[0].weekStart, new Date(2026, 9, 26).getTime());
  assert.equal(t[0].count, 2);
  assert.equal(t[0].followRate, 0.5);
  assert.equal(t[1].weekStart, new Date(2026, 10, 2).getTime());
  assert.equal(t[1].count, 1);
  assert.equal(t[1].followRate, 1);
});

test('breakdowns by mode and role', () => {
  const list = [S(1, 'pick1', { mode: 'urgent' }), S(2, 'own', { mode: 'urgent' }), S(3, 'pick1', { mode: 'saver', role: 'visitor' })];
  assert.deepEqual(byMode(list), [
    { key: 'urgent', count: 2, followRate: 0.5 },
    { key: 'balanced', count: 0, followRate: 0 },
    { key: 'saver', count: 1, followRate: 1 },
  ]);
  assert.deepEqual(byRole(list).map((g) => g.count), [2, 1]);
});

test('filters by condo, role and date range', () => {
  const list = [S(10, 'pick1'), S(20, 'own', { role: 'visitor' }), S(30, 'pick1', { condoId: 'serini' })];
  assert.equal(filterSessions(list, { condoId: 'lumina' }).length, 2);
  assert.equal(filterSessions(list, { role: 'visitor' }).length, 1);
  assert.equal(filterSessions(list, { role: 'all' }).length, 3);
  assert.deepEqual(filterSessions(list, { from: 15, to: 30 }).map((s) => s.at), [20]);
});

test('CSV export has a header, one row per session and no plates', () => {
  const csv = toCsv([S(Date.UTC(2026, 9, 21, 3), 'pick1', { chargerId: 'cs-lumina' })]);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'time,anonymous_id,role,mode,charger,kwh,cost_rm,choice,saved_vs_nearest_rm,minutes_vs_nearest');
  assert.equal(lines.length, 2);
  assert.ok(lines[1].startsWith('2026-10-21T03:00:00.000Z,R1,resident,balanced,cs-lumina,20.0,10.00,Top pick,2.00,2'));
});

test('labels', () => {
  assert.equal(anonLabel('R12'), 'Resident #12');
  assert.equal(anonLabel('V48'), 'Visitor #48');
  assert.equal(CHOICE_LABEL.own, 'Own choice');
});
