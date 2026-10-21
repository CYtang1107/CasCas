// GreenGru §1.5 / §6: isolated, deterministic four-AC-bay residential pilot.
// No real charging equipment, credentials, payment, or development server data are used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createApp } from '../server/app.js';
import { CONDOS } from '../data/condos.js';
import { malaysiaMonth } from '../engine/charging.js';

process.env.TZ = 'Asia/Kuala_Lumpur';
const WED11 = new Date('2026-10-21T11:00:00+08:00').getTime();
const DURATION = 150 * 60000;
const pilot = {
  ...CONDOS.find(c => c.id === 'lumina'),
  bays: 4,
  loadLimitKw: 16, // EXAMPLE limit only; NOT an electrical assessment or safe engineering value.
  sharing: { enabled: true, mode: 'hours', days: 'weekdays', start: 9, end: 17,
    reservedBays: 1, visitorPrice: 1.1 },
};
const pilotSession = (anonId, role) => ({
  at: WED11, anonId, role, mode: 'balanced', chargerId: 'cs-lumina', condoId: 'lumina',
  topPickId: 'cs-lumina', nearestId: 'klem-dc', choice: 'pick1',
  kWh: 14, costRm: 15.4, nearestCostRm: 18.2, minutesVsNearest: 3,
});
const bookingRequest = (anonId, role, extra = {}) => ({
  session: pilotSession(anonId, role),
  booking: { chargerId: 'cs-lumina', start: WED11, end: WED11 + DURATION },
  ...(role === 'visitor' ? { pass: { plate: `PIL${anonId.slice(1).padStart(4, '0')}`, consent: true } } : {}),
  ...extra,
});

async function launch({ dir, clock }) {
  const app = createApp({ dataDir: dir, secret: 'isolated-pilot-only', pins: { lumina: '4821' },
    condos: [pilot], ocppPassword: 'pilot-ocpp-password', now: () => clock.t,
    fetchFn: async () => { throw Error('Pilot has no external charger data'); } });
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  app.locals.attachOcpp(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];
  const request = async (method, url, body, token) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  async function charger(bay) {
    const id = `lumina-${bay}`;
    const ws = new WebSocket(base.replace('http', 'ws') + `/ocpp/${id}`, 'ocpp1.6', {
      headers: { authorization: 'Basic ' + Buffer.from(`${id}:pilot-ocpp-password`).toString('base64') },
    });
    sockets.push(ws);
    let counter = 0;
    const pending = new Map();
    ws.on('message', raw => {
      const m = JSON.parse(String(raw));
      if (m[0] === 2) ws.send(JSON.stringify([3, m[1], { status: 'Accepted' }]));
      else if (pending.has(m[1])) { pending.get(m[1])(m); pending.delete(m[1]); }
    });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const rpc = (name, payload = {}) => new Promise((resolve, reject) => {
      const callId = `pilot-${bay}-${++counter}`;
      const timeout = setTimeout(() => { pending.delete(callId); reject(new Error(`OCPP ${name} timeout`)); }, 3000);
      pending.set(callId, data => { clearTimeout(timeout); resolve(data); });
      ws.send(JSON.stringify([2, callId, name, payload]));
    });
    assert.equal((await rpc('BootNotification', { chargePointModel: 'Pilot AC 7kW' }))[2].status, 'Accepted');
    await rpc('StatusNotification', { connectorId: 1, status: 'Available' });
    return { rpc };
  }
  const close = async () => {
    for (const ws of sockets) ws.terminate();
    await new Promise(resolve => server.close(resolve));
  };
  return { request, charger, close };
}

const owned = (b, extra = {}) => ({ cancelToken: b.body.cancelToken, ...extra });

test('four-bay pilot: visitor cap, resident priority, measured sessions and private cost recovery', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cassama-four-bay-pilot-'));
  const clock = { t: WED11 + 5 * 60000 };
  const s = await launch({ dir, clock });
  try {
    // Capacity in this fixture is four physical AC bays, three open to visitors.
    const discovered = await s.request('GET', '/api/chargers');
    assert.equal(discovered.body.chargers.find(c => c.id === 'cs-lumina').bays, 4);
    const points = await Promise.all([1, 2, 3, 4].map(b => s.charger(b)));
    const live = await s.request('GET', '/api/ocpp/lumina');
    assert.equal(live.body.summary.total, 4);
    assert.equal(live.body.summary.available, 4);
    assert.equal(live.body.limitKw, 16); // Illustrative software control, not a certified safety limit.

    const visitors = [];
    for (let i = 1; i <= 3; i++) {
      const r = await s.request('POST', '/api/bookings', bookingRequest(`V${i}`, 'visitor'));
      assert.equal(r.status, 201, `Visitor ${i}: ${JSON.stringify(r.body)}`);
      visitors.push(r);
    }
    const rejected = await s.request('POST', '/api/bookings', bookingRequest('V4', 'visitor'));
    assert.equal(rejected.status, 409);
    assert.ok(rejected.body.alternatives?.length > 0, 'Offer later valid visitor time slots');

    const jmb = await s.request('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' });
    assert.equal(jmb.status, 200);
    const key = await s.request('POST', '/api/jmb/lumina/resident-keys', {}, jmb.body.token);
    assert.equal(key.status, 201);
    assert.equal((await s.request('POST', '/api/bookings', bookingRequest('R1', 'resident'))).status, 403);
    const resident = await s.request('POST', '/api/bookings', bookingRequest('R1', 'resident', { residentKey: key.body.residentKey }));
    assert.equal(resident.status, 201, 'Resident can use protected fourth bay');
    const extraResident = await s.request('POST', '/api/bookings', bookingRequest('R2', 'resident', { residentKey: key.body.residentKey }));
    assert.equal(extraResident.status, 409, 'Physical site is now completely booked');

    const visitorCheckIn = await s.request('POST', `/api/bookings/${visitors[0].body.bookingId}/check-in`, owned(visitors[0], { bay: 1 }));
    const residentCheckIn = await s.request('POST', `/api/bookings/${resident.body.bookingId}/check-in`, owned(resident, { bay: 4 }));
    assert.equal(visitorCheckIn.status, 201);
    assert.equal(residentCheckIn.status, 201);
    assert.equal((await points[1].rpc('Authorize', { idTag: visitorCheckIn.body.idTag }))[2].idTagInfo.status, 'Invalid', 'Tag is tied to one bay');

    const vStart = await points[0].rpc('StartTransaction', { connectorId: 1, idTag: visitorCheckIn.body.idTag, meterStart: 10000 });
    const rStart = await points[3].rpc('StartTransaction', { connectorId: 1, idTag: residentCheckIn.body.idTag, meterStart: 20000 });
    assert.equal(vStart[2].idTagInfo.status, 'Accepted');
    assert.equal(rStart[2].idTagInfo.status, 'Accepted');
    await points[0].rpc('StatusNotification', { connectorId: 1, status: 'Charging' });
    await points[3].rpc('StatusNotification', { connectorId: 1, status: 'Charging' });
    const charging = await s.request('GET', '/api/ocpp/lumina');
    assert.equal(charging.body.summary.charging, 2);
    assert.ok(charging.body.points.filter(p => p.status === 'Charging').every(p => p.limitKw <= 7));

    await points[0].rpc('MeterValues', { connectorId: 1, transactionId: vStart[2].transactionId,
      meterValue: [{ sampledValue: [{ value: '22500', unit: 'Wh', measurand: 'Energy.Active.Import.Register' }] }] });
    await points[3].rpc('MeterValues', { connectorId: 1, transactionId: rStart[2].transactionId,
      meterValue: [{ sampledValue: [{ value: '30000', unit: 'Wh', measurand: 'Energy.Active.Import.Register' }] }] });
    clock.t += 25 * 60000;
    assert.equal((await points[0].rpc('StopTransaction', { transactionId: vStart[2].transactionId, meterStop: 22500 }))[2].idTagInfo.status, 'Accepted');
    assert.equal((await points[3].rpc('StopTransaction', { transactionId: rStart[2].transactionId, meterStop: 30000 }))[2].idTagInfo.status, 'Accepted');
    const status = await s.request('POST', `/api/bookings/${visitors[0].body.bookingId}/charging-status`, owned(visitors[0]));
    assert.equal(status.body.status, 'completed');
    assert.equal(status.body.energyKwh, 12.5);

    const month = malaysiaMonth(clock.t);
    assert.equal((await s.request('GET', `/api/jmb/lumina/charging-revenue?month=${month}`)).status, 401);
    const report = await s.request('GET', `/api/jmb/lumina/charging-revenue?month=${month}`, undefined, jmb.body.token);
    assert.equal(report.status, 200);
    assert.equal(report.body.sessionCount, 2);
    assert.equal(report.body.financials.kWh, 22.5);
    assert.equal(report.body.financials.revenue, 22.75);
    assert.equal(report.body.financials.jmbIncome, 0, 'Pilot month has a fixed cost: cannot promise positive revenue');
    assert.equal(report.body.reconciliation.reviewCount, 0);
    const reportJson = JSON.stringify(report.body);
    assert.ok(!reportJson.includes(visitorCheckIn.body.idTag));
    assert.ok(!reportJson.includes(key.body.residentKey));
    assert.ok(!reportJson.includes('PIL0001'));

    // An OCPP charger fault blocks bay check-in; a repair restores it.
    const fault = await s.request('POST', '/api/jmb/lumina/maintenance', {
      entry: { bay: 2, kind: 'fault', costRm: 0, at: clock.t, note: 'Pilot fault drill' },
    }, jmb.body.token);
    assert.equal(fault.status, 201);
    assert.equal((await s.request('POST', `/api/bookings/${visitors[1].body.bookingId}/check-in`, owned(visitors[1], { bay: 2 }))).status, 409);
    const repair = await s.request('POST', '/api/jmb/lumina/maintenance', {
      entry: { bay: 2, kind: 'repair', costRm: 0, at: clock.t + 60000, note: 'Pilot repair drill' },
    }, jmb.body.token);
    assert.equal(repair.status, 201);
    assert.equal((await s.request('POST', `/api/bookings/${visitors[1].body.bookingId}/check-in`, owned(visitors[1], { bay: 2 }))).status, 201);

    console.log(`PILOT EVIDENCE: ${JSON.stringify({ bays: 4, residentProtected: 1, visitorBookings: 3,
      blockedExtraVisitor: true, completedMeteredSessions: report.body.sessionCount,
      kWh: report.body.financials.kWh, calculatedReceiptsRm: report.body.financials.revenue,
      estimatedOperatingSurplusRm: report.body.financials.operatingSurplus,
      estimatedJmbAllocationRm: report.body.financials.jmbIncome, reconciliationReviews: 0 })}`);
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pilot scenario 2: a compatible visiting EV is recommended the shared AC site only during approved hours', async () => {
  const { rankChargers } = await import('../engine/score.js');
  const { condoSitesFor } = await import('../data/chargers.js');
  const site = condoSitesFor([pilot])[0];
  const car = { batteryKwh: 60, efficiencyKwhPerKm: 0.15, acKw: 7, dcKw: 80, connectors: ['Type2', 'CCS2'] };
  const input = { chargers: [site], condos: [pilot], car, batteryPct: 40,
    origin: { lat: 3.21, lng: 101.72 }, parkFor: '4h',
    occupancyFn: () => ({ resident: 0, visitor: 0, total: 0.1 }) };
  const daytime = rankChargers({ ...input, date: new Date('2026-10-21T11:00:00+08:00') });
  assert.equal(daytime.results.length, 1);
  assert.equal(daytime.results[0].charger.id, 'cs-lumina');
  assert.equal(daytime.results[0].isSharedVisit, true);
  assert.ok(daytime.results[0].deliveredKwh > 0);
  const afterClosing = rankChargers({ ...input, date: new Date('2026-10-21T20:00:00+08:00') });
  assert.equal(afterClosing.results.length, 0);
  assert.match(afterClosing.excluded[0].reason, /Residents only/);
});
