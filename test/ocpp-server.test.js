import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createApp } from '../server/app.js';
import { startSimulator } from '../server/ocpp-sim.js';
import { CONDOS } from '../data/condos.js';

const PW = 'test-pw';

async function start() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascas-ocpp-'));
  const app = createApp({ dataDir, secret: 'test', pins: { lumina: '4821', azalea: '3017' }, ocppPassword: PW, fetchFn: async () => { throw new Error('offline'); } });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  app.locals.attachOcpp(server);
  const port = server.address().port;
  const http = async (method, url, body, token) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const sockets = [];
  // A minimal OCPP charger: answers SetChargingProfile, records the limits it was given.
  const charger = (id, pw = PW) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ocpp/${id}`, 'ocpp1.6', { headers: { authorization: `Basic ${Buffer.from(`${id}:${pw}`).toString('base64')}` } });
    sockets.push(ws);
    const waiting = new Map();
    const limits = [];
    let n = 0;
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m[0] === 2) {
        if (m[2] === 'SetChargingProfile') limits.push(m[3].csChargingProfiles.chargingSchedule.chargingSchedulePeriod[0].limit);
        ws.send(JSON.stringify([3, m[1], { status: 'Accepted' }]));
      } else waiting.get(m[1])?.(m);
    });
    const rpc = (action, payload) => new Promise((r) => { const id2 = `m${n++}`; waiting.set(id2, r); ws.send(JSON.stringify([2, id2, action, payload])); });
    ws.on('open', () => resolve({ ws, rpc, limits }));
    ws.on('unexpected-response', (req, res) => reject(new Error(String(res.statusCode))));
    ws.on('error', reject);
  });
  const close = async () => {
    for (const s of sockets) s.terminate();
    await new Promise((r) => server.close(r));
  };
  return { http, charger, close, app, port };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('OCPP: chargers need the right id and password', async () => {
  const s = await start();
  try {
    await assert.rejects(s.charger('lumina-1', 'wrong'), /401/);
    await assert.rejects(s.charger('lumina-99'), /404/);
    await assert.rejects(s.charger('nowhere-1'), /404/);
    const c = await s.charger('lumina-1');
    const boot = await c.rpc('BootNotification', { chargePointVendor: 'Test', chargePointModel: 'T1' });
    assert.equal(boot[0], 3);
    assert.equal(boot[2].status, 'Accepted');
    const bad = await c.rpc('DataTransfer', { vendorId: 'x' });
    assert.equal(bad[0], 4);
    assert.equal(bad[2], 'NotImplemented');
  } finally { await s.close(); }
});

test('OCPP: a Faulted status logs a fault, takes the bay out of service, and Available logs the repair', async () => {
  const s = await start();
  try {
    const c = await s.charger('lumina-4');
    await c.rpc('BootNotification', { chargePointVendor: 'Test', chargePointModel: 'T1' });
    await c.rpc('StatusNotification', { connectorId: 1, status: 'Faulted', errorCode: 'GroundFailure' });
    const world = (await s.http('GET', '/api/world')).body;
    assert.equal(world.faultBays['cs-lumina'], 1);
    assert.equal(world.live['cs-lumina'].faulted, 1);
    const token = (await s.http('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' })).body.token;
    let log = (await s.http('GET', '/api/jmb/lumina', null, token)).body.maintenance;
    assert.equal(log.length, 1);
    assert.deepEqual([log[0].bay, log[0].kind], [4, 'fault']);
    assert.match(log[0].note, /GroundFailure/);
    await c.rpc('StatusNotification', { connectorId: 1, status: 'Available', errorCode: 'NoError' });
    log = (await s.http('GET', '/api/jmb/lumina', null, token)).body.maintenance;
    assert.equal(log.at(-1).kind, 'repair');
    assert.equal((await s.http('GET', '/api/world')).body.faultBays['cs-lumina'] ?? 0, 0);
  } finally { await s.close(); }
});

test('OCPP: smart charging shares the site limit when many bays charge', async () => {
  const s = await start();
  try {
    const cs = [];
    for (let b = 1; b <= 8; b++) cs.push(await s.charger(`lumina-${b}`));
    for (const c of cs) {
      await c.rpc('StartTransaction', { connectorId: 1, idTag: 'X', meterStart: 1000, timestamp: new Date().toISOString() });
      await c.rpc('StatusNotification', { connectorId: 1, status: 'Charging', errorCode: 'NoError' });
    }
    await cs[0].rpc('MeterValues', { connectorId: 1, meterValue: [{ timestamp: 'T', sampledValue: [{ value: '3500', measurand: 'Energy.Active.Import.Register', unit: 'Wh' }, { value: '5000', measurand: 'Power.Active.Import', unit: 'W' }] }] });
    await wait(100);
    for (const c of cs) assert.equal(c.limits.at(-1), 5250, 'Lumina: 42 kW shared by 8 bays');
    const snap = (await s.http('GET', '/api/ocpp/lumina')).body;
    assert.equal(snap.protocol, 'OCPP 1.6-J');
    assert.equal(snap.limitKw, 42);
    assert.equal(snap.summary.charging, 8);
    assert.equal(snap.summary.offline, 2);
    assert.equal(snap.points[0].powerKw, 5);
    assert.equal(snap.points[0].sessionKwh, 2.5);
  } finally { await s.close(); }
});

test('OCPP simulator: chargers connect, charge and can be faulted from the JMB page', async () => {
  const s = await start();
  const sim = startSimulator({ url: `ws://127.0.0.1:${s.port}`, password: PW, condos: CONDOS.filter((c) => c.id === 'azalea'), tickMs: 40, pStart: 1, pStop: 0 });
  s.app.locals.sim = sim;
  try {
    await wait(600);
    const snap = (await s.http('GET', '/api/ocpp/azalea')).body;
    assert.equal(snap.points.length, 6);
    assert.equal(snap.simulated, true);
    assert.ok(snap.summary.charging >= 1, JSON.stringify(snap.summary));
    assert.ok(snap.loadKw <= snap.limitKw + 1e-9, `${snap.loadKw} > ${snap.limitKw}`);
    const token = (await s.http('POST', '/api/jmb/login', { condoId: 'azalea', pin: '3017' })).body.token;
    assert.equal((await s.http('POST', '/api/jmb/azalea/ocpp/2', { action: 'fault' })).status, 401);
    assert.equal((await s.http('POST', '/api/jmb/azalea/ocpp/2', { action: 'fault' }, token)).status, 200);
    await wait(200);
    assert.equal((await s.http('GET', '/api/world')).body.faultBays['cs-azalea'], 1);
  } finally { sim.stop(); await s.close(); }
});
