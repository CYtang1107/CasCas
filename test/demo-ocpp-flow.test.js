// Reproducible demo-only booking -> simulated OCPP -> completed financial entry.
// All chargers, credentials, storage, and time are isolated; no physical equipment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { startSimulator } from '../server/ocpp-sim.js';
import { CONDOS } from '../data/condos.js';
import { malaysiaMonth } from '../engine/charging.js';

process.env.TZ = 'Asia/Kuala_Lumpur';
const NOW = Date.parse('2026-10-21T11:05:00+08:00');
const START = Date.parse('2026-10-21T11:00:00+08:00');
const condo = { ...CONDOS.find(c => c.id === 'lumina'), bays: 4,
  sharing: { enabled: true, mode: 'hours', days: 'weekdays', start: 9, end: 17,
    reservedBays: 1, visitorPrice: 1.1 },
};

async function launch({ enabled, tickMs = 5000 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cassama-demo-ocpp-'));
  const password = 'isolated-simulator-pass';
  const app = createApp({ dataDir: dir, secret: 'isolated-demo-secret', pins: { lumina: '4821' },
    condos: [condo], ocppPassword: password, now: () => NOW, demoOcpp: enabled,
    fetchFn: async () => { throw Error('No external network in demo tests'); },
  });
  const server = await new Promise(resolve => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  app.locals.attachOcpp(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const sim = startSimulator({ url: `ws://127.0.0.1:${server.address().port}`,
    password, condos: [condo], pStart: 0, pStop: 0, tickMs });
  app.locals.sim = sim;
  const request = async (method, pathname, body, token) => {
    const r = await fetch(base + pathname, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, data: await r.json() };
  };
  return {
    request,
    async available() {
      for (let i = 0; i < 35; i++) {
        const r = await request('GET', '/api/ocpp/lumina');
        if (r.data.points.length === 4 && r.data.points.every(p => p.status === 'Available')) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('OCPP simulator failed to connect');
    },
    async close() {
      sim.stop();
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const visitor = () => ({
  session: { at: START, anonId: 'V1', role: 'visitor', mode: 'balanced',
    chargerId: 'cs-lumina', condoId: 'lumina', topPickId: 'cs-lumina', nearestId: 'klem-dc',
    choice: 'pick1', kWh: 7, costRm: 7.7, nearestCostRm: 8.5, minutesVsNearest: 2 },
  booking: { chargerId: 'cs-lumina', start: START, end: START + 60 * 60_000 },
  pass: { plate: 'DMO1234', consent: true },
});

test('demo opt-in: simulate a booked OCPP transaction through completion and labelled JMB receipts', async () => {
  const s = await launch({ enabled: true });
  try {
    await s.available();
    const config = await s.request('GET', '/api/config');
    assert.equal(config.data.demoOcpp, true);
    const booked = await s.request('POST', '/api/bookings', visitor());
    assert.equal(booked.status, 201, JSON.stringify(booked.data));
    const route = `/api/bookings/${booked.data.bookingId}`;
    const own = { cancelToken: booked.data.cancelToken };
    const checked = await s.request('POST', `${route}/check-in`, { ...own, bay: 1 });
    assert.equal(checked.status, 201);
    assert.equal((await s.request('POST', `${route}/demo-ocpp`, { ...own, idTag: 'CSaaaaaaaaaaaaaaaa', action: 'start' })).status, 403);
    assert.equal((await s.request('POST', `${route}/demo-ocpp`, { cancelToken: 'invalid', idTag: checked.data.idTag, action: 'start' })).status, 403);
    const payload = { ...own, idTag: checked.data.idTag };
    const started = await s.request('POST', `${route}/demo-ocpp`, { ...payload, action: 'start' });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    const active = await s.request('POST', `${route}/charging-status`, own);
    assert.equal(active.data.status, 'charging');
    assert.equal(active.data.demoOcpp, true);
    assert.equal(active.data.simulated, true);
    assert.ok(active.data.liveEnergyKwh >= 0);
    assert.equal((await s.request('POST', `${route}/demo-ocpp`, { ...payload, action: 'start' })).status, 409);
    const finished = await s.request('POST', `${route}/demo-ocpp`, { ...payload, action: 'finish', energyKwh: 9999 });
    assert.equal(finished.status, 200, JSON.stringify(finished.data));
    assert.equal(finished.data.status, 'completed');
    assert.ok(finished.data.energyKwh > 0 && finished.data.energyKwh <= 5);
    assert.ok(finished.data.revenueRm > 0);
    const done = await s.request('POST', `${route}/charging-status`, own);
    assert.equal(done.data.status, 'completed');
    assert.equal(done.data.simulated, true);
    assert.equal((await s.request('POST', `${route}/demo-ocpp`, { ...payload, action: 'finish' })).status, 409);
    assert.equal((await s.request('DELETE', route, own)).status, 409);

    const login = await s.request('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' });
    assert.equal(login.status, 200);
    const report = await s.request('GET', `/api/jmb/lumina/charging-revenue?month=${malaysiaMonth(NOW)}`, undefined, login.data.token);
    assert.equal(report.status, 200);
    assert.equal(report.data.sessionCount, 1);
    assert.equal(report.data.simulatedSessionCount, 1);
    assert.equal(report.data.sessions[0].simulated, true);
    assert.equal(report.data.financials.revenue, finished.data.revenueRm);
    assert.equal(report.data.reconciliation.reviewCount, 0);
    assert.ok(!JSON.stringify(report.data).includes(checked.data.idTag));
    assert.ok(!JSON.stringify(report.data).includes(own.cancelToken));
  } finally { await s.close(); }
});

test('default-off: demo start is not available even when simulator chargers are connected', async () => {
  const s = await launch({ enabled: false });
  try {
    await s.available();
    assert.equal((await s.request('GET', '/api/config')).data.demoOcpp ?? false, false);
    const booked = await s.request('POST', '/api/bookings', visitor());
    assert.equal(booked.status, 201, JSON.stringify(booked.data));
    const route = `/api/bookings/${booked.data.bookingId}`;
    const own = { cancelToken: booked.data.cancelToken };
    const check = await s.request('POST', `${route}/check-in`, { ...own, bay: 1 });
    assert.equal(check.status, 201);
    assert.equal((await s.request('POST', `${route}/demo-ocpp`, { ...own, idTag: check.data.idTag, action: 'start' })).status, 403);
    assert.equal((await s.request('POST', `${route}/charging-status`, own)).data.status, 'awaiting_charge');
  } finally { await s.close(); }
});


test('demo meter: battery display can follow interim OCPP readings without premature JMB revenue', async () => {
  const s = await launch({ enabled: true, tickMs: 100 });
  try {
    await s.available();
    const booked = await s.request('POST', '/api/bookings', visitor());
    assert.equal(booked.status, 201);
    const route = `/api/bookings/${booked.data.bookingId}`;
    const own = { cancelToken: booked.data.cancelToken };
    const checked = await s.request('POST', `${route}/check-in`, { ...own, bay: 1 });
    assert.equal(checked.status, 201);
    const payload = { ...own, idTag: checked.data.idTag };
    assert.equal((await s.request('POST', `${route}/demo-ocpp`, { ...payload, action: 'start' })).status, 200);
    let running;
    for (let i = 0; i < 20; i++) {
      running = await s.request('POST', `${route}/charging-status`, own);
      if (running.data.liveEnergyKwh > 0) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(running.data.status, 'charging');
    assert.ok(running.data.liveEnergyKwh > 0, JSON.stringify(running.data));
    assert.ok(running.data.liveEnergyKwh <= 5, 'demo meter must remain within 5 kWh cap');
    assert.ok(running.data.livePowerKw >= 0);
    assert.equal(running.data.revenueRm, undefined, 'no receipt before StopTransaction');
    const login = await s.request('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' });
    const before = await s.request('GET', `/api/jmb/lumina/charging-revenue?month=${malaysiaMonth(NOW)}`, undefined, login.data.token);
    assert.equal(before.data.sessionCount, 0);
    const finished = await s.request('POST', `${route}/demo-ocpp`, { ...payload, action: 'finish' });
    assert.equal(finished.status, 200, JSON.stringify(finished.data));
    assert.ok(finished.data.energyKwh >= running.data.liveEnergyKwh, 'StopTransaction must include displayed progress');
    assert.ok(finished.data.energyKwh <= 5);
    const after = await s.request('GET', `/api/jmb/lumina/charging-revenue?month=${malaysiaMonth(NOW)}`, undefined, login.data.token);
    assert.equal(after.data.sessionCount, 1);
    assert.equal(after.data.sessions[0].energyKwh, finished.data.energyKwh);
    assert.equal(after.data.sessions[0].simulated, true);
  } finally { await s.close(); }
});
