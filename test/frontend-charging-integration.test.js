import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../data/api.js';
import { recordedRevenueHtml, recordedRevenueDetails } from '../views/jmb-recorded.js';

test('driver booking-linked calls send the cancel token and correct bay', async () => {
  const calls = [];
  const api = createApi({ fetchFn: async (url, options) => {
    calls.push({ url, ...options });
    return { ok: true, json: async () => ({ status: 'awaiting_charge' }) };
  } });
  await api.bookingCheckIn('book/1', 'secret', 2);
  await api.bookingChargingStatus('book/1', 'secret');
  assert.equal(calls[0].url, 'api/bookings/book%2F1/check-in');
  assert.deepEqual(JSON.parse(calls[0].body), { cancelToken: 'secret', bay: 2 });
  assert.equal(calls[1].url, 'api/bookings/book%2F1/charging-status');
  assert.deepEqual(JSON.parse(calls[1].body), { cancelToken: 'secret' });
});

test('JMB recorded report is private, month-scoped and returned separately', async () => {
  let request;
  const api = createApi({ fetchFn: async (url, options) => {
    request = { url, ...options };
    return { ok: true, json: async () => ({ sessionCount: 0 }) };
  } });
  const res = await api.jmbChargingRevenue('lumina', 'jmb-token', '2026-10');
  assert.equal(res.data.sessionCount, 0);
  assert.equal(request.url, 'api/jmb/lumina/charging-revenue?month=2026-10');
  assert.equal(request.headers.authorization, 'Bearer jmb-token');
});

test('recorded revenue display separates estimated costs and escapes source text', () => {
  const report = recordedRevenueDetails({
    sessionCount: 1,
    sessions: [{ bay: 1, role: '<img src=x onerror=alert(1)>', endedAt: 1792640000000, energyKwh: 12.5, revenueRm: 13.75 }],
    financials: { kWh: 12.5, revenue: 13.75, jmbIncome: 0, electricityCost: 6.88,
      variableCost: 0.63, fixedMonthly: 500, maintenanceRm: 0, operatingSurplus: -493.76, partnerIncome: 0 },
    warning: 'Not audited <script>alert(1)</script>',
  });
  assert.match(report, /Metered sessions/);
  assert.match(report, /Not audited &lt;script&gt;/);
  assert.doesNotMatch(report, /<img/);
  assert.match(recordedRevenueHtml({}, "lumina"), /Recorded charging activity/);
});
