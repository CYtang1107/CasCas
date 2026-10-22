import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createApp } from '../server/app.js';
import { chargingRevenueReport, malaysiaMonth, settleMeteredCharge } from '../engine/charging.js';
import { CONDOS } from '../data/condos.js';

const WED11 = new Date(2026, 9, 21, 11).getTime();
const fixture = () => ({
  session: {
    at: WED11, anonId: 'V12', role: 'visitor', mode: 'balanced', chargerId: 'cs-lumina', condoId: 'lumina',
    topPickId: 'cs-lumina', nearestId: 'klem-dc', choice: 'pick1', kWh: 14, costRm: 15.4,
    nearestCostRm: 18.2, minutesVsNearest: 3,
  },
  booking: { chargerId: 'cs-lumina', start: WED11, end: WED11 + 150 * 60000 },
  pass: { plate: 'WXY1234', consent: true },
});
async function setup({ dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cassama-ledger-')), clock = { t: WED11 + 5 * 60000 } } = {}) {
  const app = createApp({ dataDir: dir, secret: 'test', pins: { lumina: '4821', serini: '7305' },
    ocppPassword: 'test-password', now: () => clock.t, fetchFn: async () => { throw new Error('offline'); } });
  const httpServer = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  app.locals.attachOcpp(httpServer);
  const base = `http://127.0.0.1:${httpServer.address().port}`;
  const requests = async (method, url, body, token) => {
    const response = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const sockets = [];
  async function charger(bay = 1) {
    const id = `lumina-${bay}`;
    const ws = new WebSocket(base.replace('http', 'ws') + '/ocpp/' + id, 'ocpp1.6', { headers: { authorization: 'Basic ' + Buffer.from(`${id}:test-password`).toString('base64') } });
    sockets.push(ws);
    let counter = 1;
    const pending = new Map();
    ws.on('message', d => {
      const message = JSON.parse(String(d));
      if (message[0] === 2) ws.send(JSON.stringify([3, message[1], { status: 'Accepted' }]));
      else pending.get(message[1])?.(message);
    });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const rpc = (action, payload = {}) => new Promise(resolve => {
      const id = `client-${counter++}`;
      pending.set(id, resolve);
      ws.send(JSON.stringify([2, id, action, payload]));
    });
    await rpc('BootNotification', { chargePointModel: 'Test' });
    await rpc('StatusNotification', { connectorId: 1, status: 'Available' });
    return { rpc, ws };
  }
  const close = async () => { for (const ws of sockets) ws.terminate(); await new Promise(resolve => httpServer.close(resolve)); };
  return { requests, charger, close, clock, dir };
}

const owned = (r, payload) => ({ cancelToken: r.body.cancelToken, ...payload });

test('booked OCPP transaction generates an auditable, private JMB revenue record', async () => {
  const s = await setup();
  try {
    const charger = await s.charger(1);
    const booked = await s.requests('POST', '/api/bookings', fixture());
    assert.equal(booked.status, 201);
    const before = await s.requests('POST', `/api/bookings/${booked.body.bookingId}/charging-status`, owned(booked));
    assert.deepEqual(before.body, { status: 'not_checked_in' });
    const fail = await s.requests('POST', `/api/bookings/${booked.body.bookingId}/check-in`, { bay: 1, cancelToken: 'not-owner' });
    assert.equal(fail.status, 403);
    const check = await s.requests('POST', `/api/bookings/${booked.body.bookingId}/check-in`, owned(booked, { bay: 1 }));
    assert.equal(check.status, 201);
    assert.match(check.body.idTag, /^CS[a-f0-9]{16}$/);
    assert.equal((await s.requests('POST', `/api/bookings/${booked.body.bookingId}/check-in`, owned(booked, { bay: 2 }))).status, 409);
    const invalid = await charger.rpc('Authorize', { idTag: 'CS0000000000000000' });
    assert.equal(invalid[2].idTagInfo.status, 'Invalid');
    const good = await charger.rpc('Authorize', { idTag: check.body.idTag });
    assert.equal(good[2].idTagInfo.status, 'Accepted');
    const started = await charger.rpc('StartTransaction', { connectorId: 1, idTag: check.body.idTag, meterStart: 10000 });
    assert.equal(started[2].idTagInfo.status, 'Accepted');
    const transactionId = started[2].transactionId;
    const running = await s.requests('POST', `/api/bookings/${booked.body.bookingId}/charging-status`, owned(booked));
    assert.equal(running.body.status, 'charging');
    assert.equal((await s.requests('DELETE', `/api/bookings/${booked.body.bookingId}`, owned(booked))).status, 409);
    await charger.rpc('MeterValues', { connectorId: 1, transactionId, meterValue: [{ sampledValue: [{ value: '20000', unit: 'Wh', measurand: 'Energy.Active.Import.Register' }] }] });
    s.clock.t += 25 * 60000;
    const stopped = await charger.rpc('StopTransaction', { transactionId, meterStop: 22500 });
    assert.equal(stopped[2].idTagInfo.status, 'Accepted');
    const finished = await s.requests('POST', `/api/bookings/${booked.body.bookingId}/charging-status`, owned(booked));
    assert.equal(finished.body.status, 'completed');
    assert.equal(finished.body.energyKwh, 12.5);
    assert.equal(finished.body.revenueRm, 13.75);
    const month = malaysiaMonth(s.clock.t);
    assert.equal((await s.requests('GET', `/api/jmb/lumina/charging-revenue?month=${month}`)).status, 401);
    const login = await s.requests('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' });
    const report = await s.requests('GET', `/api/jmb/lumina/charging-revenue?month=${month}`, undefined, login.body.token);
    assert.equal(report.status, 200);
    assert.equal(report.body.sessionCount, 1);
    assert.equal(report.body.financials.kWh, 12.5);
    assert.equal(report.body.financials.revenue, 13.75);
    assert.equal(report.body.financials.electricityCost, 6.88);
    assert.ok(!JSON.stringify(report.body).includes(booked.body.cancelToken));
    assert.ok(!JSON.stringify(report.body).includes(check.body.idTag));
    assert.ok(!JSON.stringify(report.body).includes('WXY1234'));
    const serini = await s.requests('POST', '/api/jmb/login', { condoId: 'serini', pin: '7305' });
    assert.equal((await s.requests('GET', `/api/jmb/lumina/charging-revenue?month=${month}`, undefined, serini.body.token)).status, 401);
    const restart = await s.requests('POST', `/api/bookings/${booked.body.bookingId}/charging-status`, owned(booked));
    assert.equal(restart.body.status, 'completed');
  } finally { await s.close(); }
});

test('non-booked simulator transactions never contribute to booked revenue', async () => {
  const s = await setup();
  try {
    const ch = await s.charger(1);
    const start = await ch.rpc('StartTransaction', { connectorId: 1, idTag: 'CASSAMA', meterStart: 1000 });
    await ch.rpc('StopTransaction', { transactionId: start[2].transactionId, meterStop: 21000 });
    const auth = await s.requests('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' });
    const report = await s.requests('GET', '/api/jmb/lumina/charging-revenue?month=2026-10', undefined, auth.body.token);
    assert.equal(report.body.sessionCount, 0);
    assert.equal(report.body.financials.revenue, 0);
  } finally { await s.close(); }
});

test('check-in respects its time window and excludes unavailable and faulty bays', async () => {
  const s = await setup();
  try {
    await s.charger(1);
    await s.charger(2);
    const booked = await s.requests('POST', '/api/bookings', fixture());
    s.clock.t = WED11 - 1;
    assert.equal((await s.requests('POST', `/api/bookings/${booked.body.bookingId}/check-in`, owned(booked, { bay: 1 }))).status, 409);
    s.clock.t = WED11 + 5 * 60000;
    const jmb = await s.requests('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' });
    const fault = await s.requests('POST', '/api/jmb/lumina/maintenance', { entry: { bay: 1, kind: 'fault', costRm: 0, at: s.clock.t, note: 'broken' } }, jmb.body.token);
    assert.equal(fault.status, 201);
    assert.equal((await s.requests('POST', `/api/bookings/${booked.body.bookingId}/check-in`, owned(booked, { bay: 1 }))).status, 409);
    assert.equal((await s.requests('POST', `/api/bookings/${booked.body.bookingId}/check-in`, owned(booked, { bay: 2 }))).status, 201);
    assert.equal((await s.requests('DELETE', `/api/bookings/${booked.body.bookingId}`, owned(booked))).status, 200);
    const auth = await s.requests('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' });
    const report = await s.requests('GET', '/api/jmb/lumina/charging-revenue?month=2026-10', undefined, auth.body.token);
    assert.equal(report.body.sessionCount, 0);
  } finally { await s.close(); }
});

test('invalid meter stop is flagged rather than counted as revenue', async () => {
  const s = await setup();
  try {
    const ch = await s.charger(3);
    const booked = await s.requests('POST', '/api/bookings', fixture());
    const check = await s.requests('POST', `/api/bookings/${booked.body.bookingId}/check-in`, owned(booked, { bay: 3 }));
    const start = await ch.rpc('StartTransaction', { connectorId: 1, idTag: check.body.idTag, meterStart: 10000 });
    await ch.rpc('StopTransaction', { transactionId: start[2].transactionId, meterStop: 9000 });
    const status = await s.requests('POST', `/api/bookings/${booked.body.bookingId}/charging-status`, owned(booked));
    assert.equal(status.body.status, 'needs_review');
    const login = await s.requests('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' });
    const report = await s.requests('GET', '/api/jmb/lumina/charging-revenue?month=2026-10', undefined, login.body.token);
    assert.equal(report.body.sessionCount, 0);
  } finally { await s.close(); }
});

test('metering settlement and monthly boundaries do not depend on browser forecasts', () => {
  assert.equal(settleMeteredCharge({ status: 'charging', meterStartWh: 1000, priceRmPerKwh: 1.1 }, 6000, WED11).revenueRm, 5.5);
  assert.equal(settleMeteredCharge({ status: 'charging', meterStartWh: 2000, priceRmPerKwh: 1.1 }, 1000, WED11).status, 'needs_review');
  assert.equal(malaysiaMonth(Date.UTC(2026, 8, 30, 16, 1)), '2026-10');
  assert.equal(chargingRevenueReport({ sessions: [], condo: CONDOS[0], maintenance: [], month: '2026-13' }), null);
});

test('an OCPP booking tag is valid only at its assigned bay and cannot be replayed', async () => {
  const s = await setup();
  try {
    const first = await s.charger(1);
    const second = await s.charger(2);
    const b = await s.requests('POST', '/api/bookings', fixture());
    const checked = await s.requests('POST', `/api/bookings/${b.body.bookingId}/check-in`, owned(b, { bay: 1 }));
    assert.equal(checked.status, 201);
    const otherBay = await second.rpc('Authorize', { idTag: checked.body.idTag });
    assert.equal(otherBay[2].idTagInfo.status, 'Invalid');
    assert.equal((await second.rpc('StartTransaction', { idTag: checked.body.idTag, meterStart: 200 }))[2].idTagInfo.status, 'Invalid');
    const started = await first.rpc('StartTransaction', { idTag: checked.body.idTag, meterStart: 200 });
    assert.equal(started[2].idTagInfo.status, 'Accepted');
    assert.equal((await first.rpc('StartTransaction', { idTag: checked.body.idTag, meterStart: 200 }))[2].idTagInfo.status, 'Invalid');
    await first.rpc('StopTransaction', { transactionId: started[2].transactionId, meterStop: 1200 });
    assert.equal((await first.rpc('Authorize', { idTag: checked.body.idTag }))[2].idTagInfo.status, 'Invalid');
  } finally { await s.close(); }
});

test('a metered charging result survives server restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cassama-restart-'));
  const clock = { t: WED11 + 5 * 60000 };
  const s = await setup({ dir, clock });
  try {
    const point = await s.charger(1);
    const booked = await s.requests('POST', '/api/bookings', fixture());
    const checked = await s.requests('POST', `/api/bookings/${booked.body.bookingId}/check-in`, owned(booked, { bay: 1 }));
    const start = await point.rpc('StartTransaction', { idTag: checked.body.idTag, meterStart: 20000 });
    clock.t += 60000;
    await point.rpc('StopTransaction', { transactionId: start[2].transactionId, meterStop: 30000 });
  } finally { await s.close(); }
  const reloaded = await setup({ dir, clock });
  try {
    const token = (await reloaded.requests('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' })).body.token;
    const report = (await reloaded.requests('GET', '/api/jmb/lumina/charging-revenue?month=2026-10', undefined, token)).body;
    assert.equal(report.sessionCount, 1);
    assert.equal(report.financials.kWh, 10);
  } finally { await reloaded.close(); }
});

test('an interrupted charge is marked for review, never silently billed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cassama-restart-inflight-'));
  const clock = { t: WED11 + 5 * 60000 };
  const s = await setup({ dir, clock });
  try {
    const point = await s.charger(1);
    const booked = await s.requests('POST', '/api/bookings', fixture());
    const checked = await s.requests('POST', `/api/bookings/${booked.body.bookingId}/check-in`, owned(booked, { bay: 1 }));
    await point.rpc('StartTransaction', { idTag: checked.body.idTag, meterStart: 1000 });
  } finally { await s.close(); }
  const reload = await setup({ dir, clock });
  try {
    const token = (await reload.requests('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' })).body.token;
    const report = (await reload.requests('GET', '/api/jmb/lumina/charging-revenue?month=2026-10', undefined, token)).body;
    assert.equal(report.sessionCount, 0);
  } finally { await reload.close(); }
});

test('reconciliation excludes duplicate OCPP records rather than double-counting them', () => {
  const record = {
    id: 'session-a', bookingId: 'booking-a', condoId: 'lumina', status: 'completed',
    bay: 1, transactionId: 50, role: 'visitor', startedAt: WED11,
    endedAt: WED11 + 60000, meterStartWh: 1000, meterStopWh: 6000,
    energyKwh: 5, priceRmPerKwh: 0.90, revenueRm: 4.50, electricityCostRm: 2.75,
  };
  const common = { condo: CONDOS.find(c => c.id === 'lumina'), maintenance: [], month: '2026-10' };
  const clean = chargingRevenueReport({ ...common, sessions: [record] });
  assert.equal(clean.sessionCount, 1);
  assert.equal(clean.financials.revenue, 4.5);
  assert.equal(clean.reconciliation.reviewCount, 0);

  const duplicate = chargingRevenueReport({ ...common, sessions: [record, { ...record, id: 'session-b' }] });
  assert.equal(duplicate.sessionCount, 0);
  assert.equal(duplicate.financials.revenue, 0);
  assert.equal(duplicate.reconciliation.reviewCount, 2);
  assert.equal(duplicate.reconciliation.excludedCompletedCount, 2);
  assert.ok(duplicate.reconciliation.items.every(i => i.reason === 'duplicate_transaction'));
});

test('reconciliation catches edited meter totals and does not bill incomplete sessions', () => {
  const record = {
    id: 'session-1', bookingId: 'booking-1', condoId: 'lumina', status: 'completed',
    bay: 3, transactionId: 79, role: 'resident', startedAt: WED11,
    endedAt: WED11 + 60000, meterStartWh: 1000, meterStopWh: 6000,
    energyKwh: 5, priceRmPerKwh: 0.90, revenueRm: 9, electricityCostRm: 2.75,
  };
  const review = { id: 'session-2', bookingId: 'booking-2', condoId: 'lumina',
    status: 'needs_review', bay: 4, startedAt: WED11,
    reviewReason: 'Charger disconnected before StopTransaction' };
  const report = chargingRevenueReport({ sessions: [record, review],
    condo: CONDOS.find(c => c.id === 'lumina'), maintenance: [], month: '2026-10' });
  assert.equal(report.sessionCount, 0);
  assert.equal(report.financials.kWh, 0);
  assert.equal(report.financials.revenue, 0);
  assert.equal(report.reconciliation.reviewCount, 2);
  assert.equal(report.reconciliation.excludedCompletedCount, 1);
  assert.ok(report.reconciliation.items.some(i => i.reason === 'inconsistent_meter_or_pricing'));
  assert.ok(report.reconciliation.items.some(i => i.reason.includes('disconnected')));
  assert.ok(!JSON.stringify(report).includes('tagHash'));
});

test('OCPP transaction identifiers remain unique across server restarts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cassama-transaction-sequence-'));
  const clock = { t: WED11 + 5 * 60000 };
  const first = await setup({ dir, clock });
  let firstId;
  try {
    const charger = await first.charger(1);
    const started = await charger.rpc('StartTransaction', { idTag: 'CASSAMA', meterStart: 100 });
    firstId = started[2].transactionId;
    assert.ok(firstId > 0);
    await charger.rpc('StopTransaction', { transactionId: firstId, meterStop: 200 });
  } finally { await first.close(); }
  const second = await setup({ dir, clock });
  try {
    const charger = await second.charger(1);
    const started = await charger.rpc('StartTransaction', { idTag: 'CASSAMA', meterStart: 200 });
    assert.ok(started[2].transactionId > firstId);
    await charger.rpc('StopTransaction', { transactionId: started[2].transactionId, meterStop: 300 });
  } finally { await second.close(); }
});
