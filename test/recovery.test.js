import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costRecovery, quietWindows } from '../engine/recovery.js';
import { bayStatus, validateEntry, maintenanceCost } from '../engine/maintenance.js';
import { monthlyReportCsv } from '../engine/report.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('proposal 6.2 base case: RM0.90, 4,050 kWh, RM500 fixed gives RM715 surplus', () => {
  const r = costRecovery({ kWh: 4050, revenue: 4050 * 0.9, electricityCost: 4050 * 0.55, variablePerKwh: 0.05, fixedMonthly: 500, maintenanceRm: 0, jmbShare: 0.3, units: 100 });
  close(r.operatingSurplus, 715);
  close(r.jmbIncome, 214.5);
  close(r.partnerIncome, 500.5);
  close(r.perUnit, 2.145);
  assert.equal(Math.round(r.breakEvenKwh), 1667);
});

test('a deficit pays the JMB nothing and maintenance spend counts as a cost', () => {
  const r = costRecovery({ kWh: 1350, revenue: 1215, electricityCost: 742.5, variablePerKwh: 0.05, fixedMonthly: 500, maintenanceRm: 0, jmbShare: 0.3, units: 100 });
  close(r.operatingSurplus, -95);
  assert.equal(r.jmbIncome, 0);
  const m = costRecovery({ kWh: 4050, revenue: 3645, electricityCost: 2227.5, variablePerKwh: 0.05, fixedMonthly: 500, maintenanceRm: 200, jmbShare: 0.3, units: 100 });
  close(m.operatingSurplus, 515);
});

test('no margin per kWh means break-even is never reached', () => {
  const r = costRecovery({ kWh: 100, revenue: 50, electricityCost: 50, variablePerKwh: 0.05, fixedMonthly: 500, maintenanceRm: 0, jmbShare: 0.7, units: 10 });
  assert.equal(r.breakEvenKwh, null);
});

test('quiet windows find long idle stretches', () => {
  const use = Array(24).fill(0.6);
  for (let h = 9; h < 17; h++) use[h] = 0.1;
  use[3] = 0.1;
  const w = quietWindows(use, 0.25, 2);
  assert.equal(w.length, 1);
  assert.deepEqual({ start: w[0].start, end: w[0].end }, { start: 9, end: 17 });
  close(w[0].avgUse, 0.1);
});

const entry = (bay, kind, at, costRm = 0) => ({ bay, kind, at, costRm, note: '' });

test('a bay with an unrepaired fault is out of service', () => {
  const s = bayStatus([entry(2, 'fault', 1), entry(3, 'fault', 2), entry(3, 'repair', 3, 150), entry(1, 'service', 4, 80)], 4);
  assert.deepEqual(s.map((b) => b.status), ['ok', 'fault', 'ok', 'ok']);
  assert.equal(s[1].last.kind, 'fault');
  assert.equal(s[2].last.kind, 'repair');
});

test('maintenance entries are validated', () => {
  assert.equal(validateEntry(entry(1, 'repair', 5, 120), 4), null);
  assert.match(validateEntry(entry(9, 'repair', 5), 4), /bay/i);
  assert.match(validateEntry(entry(1, 'paint', 5), 4), /type/i);
  assert.match(validateEntry(entry(1, 'repair', 5, -3), 4), /cost/i);
});

test('maintenance cost sums a period', () => {
  const list = [entry(1, 'service', 10, 80), entry(2, 'repair', 20, 150), entry(2, 'repair', 40, 99)];
  assert.equal(maintenanceCost(list, 0, 30), 230);
});

test('the monthly report lists the headline figures', () => {
  const csv = monthlyReportCsv({ condoName: 'Residensi Lumina', month: 'October 2026', rows: [['Energy delivered (kWh)', 4050], ['Operating surplus (RM)', 715.5], ['Note', 'a, b']] });
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'metric,value');
  assert.equal(lines[1], 'Condo,Residensi Lumina');
  assert.equal(lines[2], 'Month,October 2026');
  assert.ok(lines.includes('Energy delivered (kWh),4050'));
  assert.ok(lines.includes('Operating surplus (RM),715.50'));
  assert.ok(lines.includes('Note,"a, b"'));
});
