import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpoSummary, idleWindow } from '../engine/cpo.js';
import { simulateCondoMonth } from '../engine/economics.js';
import { CONDOS } from '../data/condos.js';
import { CONDO_SITES } from '../data/chargers.js';

const oct = new Date(2026, 9, 1);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);

test('CPO summary: one row per site, totals add up, CPO keeps 70% of a positive surplus', () => {
  const { rows, totals } = cpoSummary(CONDOS, CONDO_SITES, oct);
  assert.equal(rows.length, CONDOS.length);
  close(totals.cpoIncome, rows.reduce((s, r) => s + r.cpoIncome, 0));
  for (const r of rows) {
    if (r.surplus > 0) close(r.cpoIncome, r.surplus * (1 - r.condo.jmbShare));
    close(r.cpoIncome + r.jmbIncome, Math.max(0, r.surplus));
  }
  assert.equal(totals.baysUp, totals.bays);
});

test('bays reported down by OCPP or the JMB log show as out of service', () => {
  const sites = CONDO_SITES.map((c) => (c.condoId === 'lumina' ? { ...c, faultBays: 2 } : c));
  const lumina = cpoSummary(CONDOS, sites, oct).rows.find((r) => r.condo.id === 'lumina');
  assert.equal(lumina.baysUp, lumina.bays - 2);
});

test('idle window falls in the daytime, when residents are out', () => {
  const condo = CONDOS.find((c) => c.id === 'lumina');
  const site = CONDO_SITES.find((c) => c.condoId === 'lumina');
  const w = idleWindow(condo, site, simulateCondoMonth(condo, site, oct));
  assert.ok(w && w.start >= 7 && w.end <= 22 && w.end - w.start >= 3);
  assert.ok(w.avgUse < 0.25);
});
