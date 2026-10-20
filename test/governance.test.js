import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProposal, castVote, tally, closeProposal, QUORUM } from '../engine/governance.js';
import { residentStatement } from '../engine/governance.js';

const T = 1_800_000_000_000;
const settings = { enabled: true, mode: 'auto', days: 'weekdays', start: 9, end: 17, reservedBays: 2, visitorPrice: 1.2 };

test('a proposal is open for 7 days and holds the settings residents vote on', () => {
  const p = createProposal({ id: 'p1', condoId: 'lumina', settings, now: T });
  assert.equal(p.status, 'open');
  assert.equal(p.closesAt, T + 7 * 864e5);
  assert.deepEqual(p.settings, settings);
});

test('one vote per resident; they may change it; no votes after closing', () => {
  let p = createProposal({ id: 'p1', condoId: 'lumina', settings, now: T });
  ({ proposal: p } = castVote(p, 'r1', 'yes', T + 1));
  ({ proposal: p } = castVote(p, 'r2', 'no', T + 2));
  ({ proposal: p } = castVote(p, 'r1', 'no', T + 3));
  assert.deepEqual(tally(p, 100), { yes: 0, no: 2, cast: 2, quorum: 10, quorumMet: false, passing: false });
  assert.match(castVote(p, 'r3', 'maybe', T).error, /yes or no/);
  assert.match(castVote(p, 'r3', 'yes', T + 8 * 864e5).error, /closed/);
});

test(`passes on a simple majority with at least ${QUORUM * 100}% of units voting`, () => {
  let p = createProposal({ id: 'p1', condoId: 'lumina', settings, now: T });
  for (let i = 0; i < 12; i++) ({ proposal: p } = castVote(p, `y${i}`, 'yes', T + i));
  for (let i = 0; i < 5; i++) ({ proposal: p } = castVote(p, `n${i}`, 'no', T + i));
  const t = tally(p, 120);
  assert.equal(t.quorumMet, true);
  assert.equal(t.passing, true);
  const closed = closeProposal(p, 120, T + 100);
  assert.equal(closed.status, 'passed');
  assert.equal(closed.result.yes, 12);
  const tie = closeProposal(createProposal({ id: 'p2', condoId: 'lumina', settings, now: T }), 120, T + 1);
  assert.equal(tie.status, 'failed');
});

test('the resident statement splits this month by where the money came from', () => {
  const sim = { revenue: 10000, visitorRevenue: 3000, jmbIncome: 4000, perUnitSaving: 13.33, recovery: { operatingSurplus: 5714, electricityCost: 2600, variableCost: 500, fixedMonthly: 1250, maintenanceRm: 0 } };
  const s = residentStatement(sim, { units: 300, monthlyFee: 400, jmbShare: 0.7 });
  assert.equal(s.jmbIncome, 4000);
  assert.equal(s.fromVisitors, 1200);
  assert.equal(s.perUnit, 13.33);
  assert.equal(s.feeWithout, 413.33);
  assert.equal(s.yearPerUnit, 159.96);
});
