import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { DEMO_CHARGERS } from '../data/chargers-demo.js';
import { CONDO_SITES } from '../data/chargers.js';
import { CONDOS } from '../data/condos.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/ocm-sample.json', import.meta.url), 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cascas-srv-'));
const WED11 = new Date(2026, 9, 21, 11).getTime();
const WED20 = new Date(2026, 9, 21, 20).getTime();

async function start(opts = {}) {
  const app = createApp({ dataDir: opts.dataDir || tmp(), secret: 'test', pins: { lumina: '4821', serini: '7305' },
    condos: opts.condos || CONDOS, ocmKey: opts.ocmKey ?? '', fetchFn: opts.fetchFn || (async () => { throw new Error('offline'); }), now: opts.now });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, token) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
  };
  const raw = (method, url, body) => fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body });
  return { call, raw, base, close: () => new Promise((r) => server.close(r)) };
}

const session = (extra = {}) => ({ at: WED11, anonId: 'V12', role: 'visitor', mode: 'balanced', chargerId: 'cs-lumina', condoId: 'lumina',
  topPickId: 'cs-lumina', nearestId: 'klem-dc', choice: 'pick1', kWh: 14, costRm: 15.4, nearestCostRm: 18.2, minutesVsNearest: 3, overstayMin: 0, ...extra });
const booking = (start = WED11) => ({ chargerId: 'cs-lumina', start, end: start + 150 * 60000 });

test('health, static files and no data files served', async () => {
  const s = await start();
  assert.deepEqual((await s.call('GET', '/api/health')).body, { ok: true });
  const page = await s.raw('GET', '/');
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('CasSama'));
  assert.equal(page.headers.get('cache-control'), 'no-cache');
  assert.equal((await s.raw('GET', '/server/data/store.json')).status, 404);
  assert.equal((await s.raw('GET', '/package.json')).status, 404);
  assert.equal((await s.raw('GET', '/engine/access.js')).status, 200);
  assert.equal((await s.call('GET', '/api/nope')).status, 404);
  await s.close();
});

test('chargers: demo without a key, live with a working key, key never sent to the browser', async () => {
  const off = await start();
  const demo = (await off.call('GET', '/api/chargers')).body;
  assert.equal(demo.source, 'demo');
  assert.equal(demo.chargers.length, CONDO_SITES.length + DEMO_CHARGERS.length);
  await off.close();
  const on = await start({ ocmKey: 'secret-key', fetchFn: async () => ({ ok: true, json: async () => fixture }) });
  const live = await on.call('GET', '/api/chargers');
  assert.equal(live.body.source, 'live');
  assert.ok(!JSON.stringify(live.body).includes('secret-key'));
  await on.close();
});

test('a visitor booking inside sharing hours is approved and fills a bay', async () => {
  const s = await start();
  const r = await s.call('POST', '/api/bookings', { session: session(), booking: booking(), pass: { plate: 'wxy 1234', consent: true } });
  assert.equal(r.status, 201);
  assert.equal(r.body.pass.plate, 'WXY1234');
  assert.ok(r.body.bookingId && r.body.cancelToken);
  const world = (await s.call('GET', `/api/world?at=${WED11 + 60000}`)).body;
  assert.equal(world.activeBays['cs-lumina'], 1);
  assert.equal((await s.call('GET', `/api/world?at=${WED11 + 200 * 60000}`)).body.activeBays['cs-lumina'], undefined);
  await s.close();
});

test('the server refuses passes outside sharing hours or with a bad plate or no consent', async () => {
  const s = await start();
  const late = await s.call('POST', '/api/bookings', { session: session({ at: WED20 }), booking: booking(WED20), pass: { plate: 'WXY1234', consent: true } });
  assert.equal(late.status, 409);
  assert.equal((await s.call('POST', '/api/bookings', { session: session(), booking: booking(), pass: { plate: '1234', consent: true } })).status, 400);
  assert.equal((await s.call('POST', '/api/bookings', { session: session(), booking: booking(), pass: { plate: 'WXY1234' } })).status, 400);
  assert.equal((await s.call('POST', '/api/bookings', { session: { ...session(), anonId: 'hacker' }, booking: booking() })).status, 400);
  assert.equal((await s.call('POST', '/api/bookings', { session: session({ chargerId: 'klem-dc', condoId: null }), booking: booking(), pass: { plate: 'WXY1234', consent: true } })).status, 400);
  await s.close();
});

test('only the booker can cancel; cancelling removes the pass', async () => {
  const s = await start();
  const r = (await s.call('POST', '/api/bookings', { session: session(), booking: booking(), pass: { plate: 'WXY1234', consent: true } })).body;
  assert.equal((await s.call('DELETE', `/api/bookings/${r.bookingId}`, { cancelToken: 'nope' })).status, 403);
  assert.equal((await s.call('DELETE', `/api/bookings/${r.bookingId}`, { cancelToken: r.cancelToken })).status, 200);
  assert.equal((await s.call('DELETE', `/api/bookings/${r.bookingId}`, { cancelToken: r.cancelToken })).status, 404);
  const login = (await s.call('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' })).body;
  const afterCancel = (await s.call('GET', '/api/jmb/lumina', null, login.token)).body;
  assert.deepEqual(afterCancel.passes, []);
  assert.equal(afterCancel.sessions.length, 0, 'cancelled booking estimate must not remain in the session log');
  await s.close();
});

test('public summary has totals only; plates need the right PIN', async () => {
  const s = await start();
  await s.call('POST', '/api/bookings', { session: session(), booking: booking(), pass: { plate: 'WXY1234', consent: true } });
  const sum = await s.call('GET', '/api/condos/lumina/summary');
  assert.deepEqual(Object.keys(sum.body).sort(), ['count', 'followRate', 'overstayFeesRm', 'savedRm']);
  assert.ok(!JSON.stringify(sum.body).includes('WXY'));
  assert.equal((await s.call('GET', '/api/jmb/lumina')).status, 401);
  assert.equal((await s.call('POST', '/api/jmb/login', { condoId: 'lumina', pin: '0000' })).status, 401);
  const serini = (await s.call('POST', '/api/jmb/login', { condoId: 'serini', pin: '7305' })).body;
  assert.equal((await s.call('GET', '/api/jmb/lumina', null, serini.token)).status, 401);
  const lumina = (await s.call('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' })).body;
  const data = (await s.call('GET', '/api/jmb/lumina', null, lumina.token)).body;
  assert.equal(data.passes[0].plate, 'WXY1234');
  assert.equal(data.sessions.length, 1);
  assert.ok(!('plate' in data.sessions[0]));
  await s.close();
});

test('JMB sharing settings are validated, saved and visible in the world', async () => {
  const s = await start();
  const { token } = (await s.call('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' })).body;
  const good = { enabled: false, days: 'weekdays', start: 9, end: 17, reservedBays: 2, visitorPrice: 1.2 };
  assert.equal((await s.call('PUT', '/api/jmb/lumina/sharing', { sharing: { ...good, start: 18 } }, token)).status, 400);
  assert.equal((await s.call('PUT', '/api/jmb/lumina/sharing', { sharing: good }, token)).status, 200);
  assert.equal((await s.call('PUT', '/api/jmb/lumina/sharing', { sharing: good })).status, 401);
  assert.equal((await s.call('GET', '/api/world')).body.sharing.lumina.enabled, false);
  const blocked = await s.call('POST', '/api/bookings', { session: session(), booking: booking(), pass: { plate: 'WXY1234', consent: true } });
  assert.equal(blocked.status, 409);
  await s.close();
});

test('check-ins are shared; bad JSON and bad check-ins get 400', async () => {
  const s = await start();
  assert.equal((await s.call('POST', '/api/checkins', { chargerId: 'klem-dc', ok: false, note: 'x'.repeat(500), at: WED11 })).status, 201);
  const w = (await s.call('GET', '/api/world')).body;
  assert.equal(w.checkins['klem-dc'][0].note.length, 120);
  assert.equal((await s.call('POST', '/api/checkins', { chargerId: 'klem-dc', ok: 'yes', at: WED11 })).status, 400);
  const bad = await s.raw('POST', '/api/checkins', '{bad');
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: 'Invalid JSON' });
  await s.close();
});

test('data survives a server restart', async () => {
  const dir = tmp();
  const a = await start({ dataDir: dir });
  await a.call('POST', '/api/bookings', { session: session(), booking: booking(), pass: { plate: 'WXY1234', consent: true } });
  await a.close();
  const b = await start({ dataDir: dir });
  assert.equal((await b.call('GET', `/api/world?at=${WED11 + 60000}`)).body.activeBays['cs-lumina'], 1);
  await b.close();
});

test('JMB maintenance log: PIN only, validated, and fault bays leave service for drivers', async () => {
  const s = await start();
  const fault = { bay: 2, kind: 'fault', costRm: 0, at: WED11, note: 'Cable damaged' };
  assert.equal((await s.call('POST', '/api/jmb/lumina/maintenance', { entry: fault })).status, 401);
  const token = (await s.call('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' })).body.token;
  assert.equal((await s.call('POST', '/api/jmb/lumina/maintenance', { entry: { ...fault, bay: 99 } }, token)).status, 400);
  assert.equal((await s.call('POST', '/api/jmb/lumina/maintenance', { entry: fault }, token)).status, 201);
  assert.equal((await s.call('GET', '/api/world')).body.faultBays['cs-lumina'], 1);
  const jmb = (await s.call('GET', '/api/jmb/lumina', null, token)).body;
  assert.equal(jmb.maintenance.length, 1);
  assert.equal(jmb.maintenance[0].note, 'Cable damaged');
  await s.call('POST', '/api/jmb/lumina/maintenance', { entry: { ...fault, kind: 'repair', costRm: 180, at: WED11 + 3600e3 } }, token);
  assert.equal((await s.call('GET', '/api/world')).body.faultBays['cs-lumina'] ?? 0, 0);
  const serini = (await s.call('POST', '/api/jmb/login', { condoId: 'serini', pin: '7305' })).body.token;
  assert.equal((await s.call('POST', '/api/jmb/lumina/maintenance', { entry: fault }, serini)).status, 401);
  await s.close();
});

test('the JMB portal has its own page; the driver app no longer has a JMB tab', async () => {
  const s = await start();
  const portal = await s.raw('GET', '/jmb.html');
  assert.equal(portal.status, 200);
  const html = await portal.text();
  assert.ok(html.includes('data-app="jmb"'));
  const app = await (await s.raw('GET', '/')).text();
  assert.ok(!app.includes('data-role="jmb"'));
  assert.ok(app.includes('data-role="activity"'));
  await s.close();
});

test('traffic tiles: off without a key; with one, proxied and the key never reaches the browser', async () => {
  const off = await start();
  assert.deepEqual((await off.call('GET', '/api/config')).body, { traffic: false, ai: false });
  assert.equal((await off.raw('GET', '/api/traffic/12/3245/2010.png')).status, 404);
  await off.close();
  const seen = [];
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const app = createApp({ dataDir: tmp(), secret: 's', pins: {}, trafficKey: 'tt-secret',
    fetchFn: async (url) => { seen.push(String(url)); return { ok: true, status: 200, arrayBuffer: async () => png }; } });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(`${base}/api/config`)).json(), { traffic: true, ai: false });
  const tile = await fetch(`${base}/api/traffic/12/3245/2010.png`);
  assert.equal(tile.status, 200);
  assert.equal(tile.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await tile.arrayBuffer()), png);
  assert.match(seen[0], /api\.tomtom\.com\/traffic\/map\/4\/tile\/flow\/relative0\/12\/3245\/2010\.png\?key=tt-secret/);
  await fetch(`${base}/api/traffic/12/3245/2010.png`);
  assert.equal(seen.length, 1, 'cached for a minute');
  assert.equal((await fetch(`${base}/api/traffic/99/1/1.png`)).status, 400);
  await new Promise((r) => server.close(r));
});

test('TomTom data through the server: validated, cached, key kept on the server', async () => {
  const off = await start();
  assert.equal((await off.call('GET', '/api/tt/stations')).status, 404);
  await off.close();
  const calls = [];
  const reply = (url) => {
    if (url.includes('nearbySearch')) return { results: [{ id: 's1', poi: { name: 'ChargeN Go', brands: [{ name: 'ChargeN Go' }] }, position: { lat: 3.2, lon: 101.72 }, chargingPark: { connectors: [{ connectorType: 'IEC62196Type2Outlet', ratedPowerKW: 7, currentType: 'AC1' }] }, dataSources: { chargingAvailability: { id: 'av1' } } }] };
    if (url.includes('chargingAvailability')) return { connectors: [{ total: 1, availability: { current: { available: 1 } } }] };
    if (url.includes('calculateRoute')) return { routes: [] };
    return { incidents: [] };
  };
  const app = createApp({ dataDir: tmp(), secret: 's', pins: {}, trafficKey: 'tt-secret',
    fetchFn: async (url) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => reply(String(url)) }; } });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const st = await (await fetch(`${base}/api/tt/stations`)).json();
  assert.equal(st.stations[0].live.available, 1);
  assert.ok(!JSON.stringify(st).includes('tt-secret'));
  await fetch(`${base}/api/tt/stations`);
  assert.equal(calls.filter((c) => c.includes('nearbySearch')).length, 1, 'stations cached');
  assert.equal((await fetch(`${base}/api/tt/route?pts=3.2,101.7`)).status, 400);
  assert.equal((await fetch(`${base}/api/tt/route?pts=40.7,-74;3.2,101.7`)).status, 400, 'outside Malaysia');
  assert.equal((await fetch(`${base}/api/tt/route?pts=3.21651,101.72502;2.1896,102.2501&alt=1`)).status, 200);
  assert.match(calls.at(-1), /calculateRoute\/3\.217,101\.725:2\.19,102\.25\/json\?traffic=true.*maxAlternatives=1/);
  assert.equal((await fetch(`${base}/api/tt/incidents?bbox=101.6,3.1,101.8,3.3`)).status, 200);
  assert.match(calls.at(-1), /incidentDetails\?bbox=101\.60,3\.10,101\.80,3\.30/);
  assert.equal((await fetch(`${base}/api/tt/incidents?bbox=nope`)).status, 400);
  await new Promise((r) => server.close(r));
});

test('a verified unit may vote once and change its vote; forged device IDs cannot vote', async () => {
  const pilot = { ...CONDOS.find(c => c.id === 'lumina'), units: 10 };
  const s = await start({ condos: [pilot] });
  try {
    const settings = { enabled: true, mode: 'auto', days: 'all', start: 9, end: 17, reservedBays: 2, visitorPrice: 1.2 };
    const login = await s.call('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' });
    const token = login.body.token;
    assert.equal((await s.call('POST', '/api/jmb/lumina/proposal', { settings }, token)).status, 201);

    assert.equal((await s.call('POST', '/api/condos/lumina/proposal/vote', { voterId: 'fake-device-100', vote: 'yes' })).status, 403);
    const legacyKey = await s.call('POST', '/api/jmb/lumina/resident-keys', {}, token);
    assert.equal(legacyKey.status, 201, 'booking-only keys still work');
    assert.equal(legacyKey.body.votingEligible, false);
    assert.equal((await s.call('POST', '/api/condos/lumina/proposal/vote', { residentKey: legacyKey.body.residentKey, vote: 'yes' })).status, 403);
    assert.equal((await s.call('POST', '/api/jmb/lumina/resident-keys', { unitId: 'no@unit' }, token)).status, 400);

    // JMB independently verifies the household/unit before issuing a voting key.
    const first = await s.call('POST', '/api/jmb/lumina/resident-keys', { unitId: 'A-12-08' }, token);
    const duplicate = await s.call('POST', '/api/jmb/lumina/resident-keys', { unitId: ' a-12-08 ' }, token);
    assert.equal(first.status, 201);
    assert.equal(duplicate.body.votingEligible, true);
    const vote = (key, choice) => s.call('POST', '/api/condos/lumina/proposal/vote', { residentKey: key, vote: choice });
    assert.equal((await vote(first.body.residentKey, 'yes')).status, 200);
    let result = await vote(duplicate.body.residentKey, 'no');
    assert.equal(result.status, 200);
    assert.deepEqual([result.body.tally.yes, result.body.tally.no, result.body.tally.cast], [0, 1, 1], 'two keys for the same unit count as one vote');
    assert.ok(!JSON.stringify(result.body).includes(first.body.residentKey));
    assert.ok(!JSON.stringify(result.body).includes('A-12-08'));
    result = await vote(first.body.residentKey, 'yes');
    assert.equal(result.body.tally.cast, 1);

    // Demo preview must not change the official tally or community settings.
    const sample = await s.call('POST', '/api/jmb/lumina/proposal/sample', {}, token);
    assert.equal(sample.status, 200);
    assert.ok(sample.body.proposal.demoPreview);
    assert.equal(sample.body.tally.cast, 1);
    const closed = await s.call('POST', '/api/jmb/lumina/proposal/close', {}, token);
    assert.equal(closed.body.proposal.status, 'passed', 'single unit meets 10% quorum when there are ten units');
    assert.equal((await s.call('GET', '/api/world')).body.sharing.lumina.mode, 'auto');
  } finally {
    await s.close();
  }
});

test('revocation and cross-condo credentials cannot influence voting', async () => {
  const s = await start();
  try {
    const lumina = (await s.call('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' })).body.token;
    const serini = (await s.call('POST', '/api/jmb/login', { condoId: 'serini', pin: '7305' })).body.token;
    const settings = { enabled: true, mode: 'auto', days: 'all', start: 9, end: 17, reservedBays: 2, visitorPrice: 1.2 };
    await s.call('POST', '/api/jmb/lumina/proposal', { settings }, lumina);
    const other = (await s.call('POST', '/api/jmb/serini/resident-keys', { unitId: 'A-12-08' }, serini)).body;
    const mine = (await s.call('POST', '/api/jmb/lumina/resident-keys', { unitId: 'A-12-08' }, lumina)).body;
    assert.equal((await s.call('POST', '/api/condos/lumina/proposal/vote', { residentKey: other.residentKey, vote: 'yes' })).status, 403);
    assert.equal((await s.call('DELETE', `/api/jmb/lumina/resident-keys/${mine.keyId}`, null, lumina)).status, 200);
    assert.equal((await s.call('POST', '/api/condos/lumina/proposal/vote', { residentKey: mine.residentKey, vote: 'yes' })).status, 403);
    assert.equal((await s.call('GET', '/api/condos/lumina/proposal')).body.tally.cast, 0);
  } finally {
    await s.close();
  }
});

test('simulated votes cannot enact sharing even when the preview predicts a pass', async () => {
  const pilot = { ...CONDOS.find(c => c.id === 'lumina'), units: 10 };
  const s = await start({ condos: [pilot] });
  try {
    const token = (await s.call('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' })).body.token;
    const settings = { enabled: true, mode: 'auto', days: 'all', start: 9, end: 17, reservedBays: 2, visitorPrice: 1.2 };
    await s.call('POST', '/api/jmb/lumina/proposal', { settings }, token);
    const sample = (await s.call('POST', '/api/jmb/lumina/proposal/sample', {}, token)).body;
    assert.ok(sample.proposal.sampleVotes);
    assert.equal(sample.tally.cast, 0);
    const closed = await s.call('POST', '/api/jmb/lumina/proposal/close', {}, token);
    assert.equal(closed.body.proposal.status, 'failed');
    assert.notEqual((await s.call('GET', '/api/world')).body.sharing.lumina?.mode, 'auto');
  } finally {
    await s.close();
  }
});

test('API prevents overbooking and releases cancelled slots', async () => {
  const s = await start();

  try {
    const confirmed = [];

    // Lumina has 10 bays, with 2 reserved for residents.
    // Therefore, only 8 simultaneous visitor bookings are allowed.
    for (let i = 0; i < 8; i++) {
      const result = await s.call('POST', '/api/bookings', {
        session: session({ anonId: `V${i + 1}` }),
        booking: booking(),
        pass: { plate: `WXY${1000 + i}`, consent: true }
      });

      assert.equal(result.status, 201);
      confirmed.push(result.body);
    }

    // Ninth visitor must be rejected.
    const ninth = await s.call('POST', '/api/bookings', {
      session: session({ anonId: 'V9' }),
      booking: booking(),
      pass: { plate: 'WXY9999', consent: true }
    });

    assert.equal(ninth.status, 409);

    // JMB logs in to issue resident access keys.
    const login = await s.call(
      'POST',
      '/api/jmb/login',
      { condoId: 'lumina', pin: '4821' }
    );

    assert.equal(login.status, 200);

    // Two verified residents can use their reserved capacity.
    for (let i = 0; i < 2; i++) {

      // JMB issues a unique key for each resident.
      const issued = await s.call(
        'POST',
        '/api/jmb/lumina/resident-keys',
        {},
        login.body.token
      );

      assert.equal(issued.status, 201);

      // Resident books using their issued key.
      const resident = await s.call(
        'POST',
        '/api/bookings',
        {
          session: session({
            anonId: `R${i + 1}`,
            role: 'resident'
          }),
          booking: booking(),
          residentKey: issued.body.residentKey
        }
      );

      assert.equal(resident.status, 201);
    }

    // Issue a valid key for the third resident.
    const thirdKey = await s.call(
      'POST',
      '/api/jmb/lumina/resident-keys',
      {},
      login.body.token
    );

    assert.equal(thirdKey.status, 201);

    // Third resident has valid access,
    // but all physical bays are occupied.
    const thirdResident = await s.call(
      'POST',
      '/api/bookings',
      {
        session: session({
          anonId: 'R3',
          role: 'resident'
        }),
        booking: booking(),
        residentKey: thirdKey.body.residentKey
      }
    );

    assert.equal(thirdResident.status, 409);

    // Cancel one visitor reservation.
    const cancelled = await s.call(
      'DELETE',
      `/api/bookings/${confirmed[0].bookingId}`,
      { cancelToken: confirmed[0].cancelToken }
    );

    assert.equal(cancelled.status, 200);

    // That slot should become available again.
    const replacement = await s.call('POST', '/api/bookings', {
      session: session({ anonId: 'V10' }),
      booking: booking(),
      pass: { plate: 'WXY8888', consent: true }
    });

    assert.equal(replacement.status, 201);

  } finally {
    await s.close();
  }
});

test('Residents require JMB-issued access keys', async () => {
  const s = await start();

  try {
    const residentSession = session({
      role: 'resident',
      anonId: 'R12'
    });

    const payload = {
      session: residentSession,
      booking: booking()
    };

    // Claiming resident status is insufficient.
    const noKey = await s.call(
      'POST', '/api/bookings', payload
    );

    assert.equal(noKey.status, 403);

    // Visitors cannot issue their own access keys.
    const unauthorized = await s.call(
      'POST', '/api/jmb/lumina/resident-keys', {}
    );

    assert.equal(unauthorized.status, 401);

    // The JMB authenticates.
    const login = await s.call(
      'POST',
      '/api/jmb/login',
      { condoId: 'lumina', pin: '4821' }
    );

    // An approved resident receives a key.
    const issued = await s.call(
      'POST',
      '/api/jmb/lumina/resident-keys',
      {},
      login.body.token
    );

    assert.equal(issued.status, 201);

    // That key permits a resident reservation.
    const confirmed = await s.call(
      'POST',
      '/api/bookings',
      {
        ...payload,
        residentKey: issued.body.residentKey
      }
    );

    assert.equal(confirmed.status, 201);

  } finally {
    await s.close();
  }
});

test('Resident keys cannot access another condo', async () => {
  const s = await start();

  try {
    // JMB of Serini logs in.
    const login = await s.call(
      'POST',
      '/api/jmb/login',
      { condoId: 'serini', pin: '7305' }
    );

    assert.equal(login.status, 200);

    // Issue a Serini resident key.
    const issued = await s.call(
      'POST',
      '/api/jmb/serini/resident-keys',
      {},
      login.body.token
    );

    assert.equal(issued.status, 201);

    // Attempt to book at Lumina using the Serini key.
    const result = await s.call(
      'POST',
      '/api/bookings',
      {
        session: session({
          anonId: 'R1',
          role: 'resident'
        }),
        booking: booking(),
        residentKey: issued.body.residentKey
      }
    );

    assert.equal(result.status, 403);

  } finally {
    await s.close();
  }
});

test('Faulty bays reduce capacity until repaired', async () => {
  const s = await start();

  try {
    const login = await s.call(
      'POST',
      '/api/jmb/login',
      { condoId: 'lumina', pin: '4821' }
    );

    const token = login.body.token;

    // JMB reports Bay 1 as faulty.
    const fault = await s.call(
      'POST',
      '/api/jmb/lumina/maintenance',
      {
        entry: {
          bay: 1,
          kind: 'fault',
          costRm: 0,
          at: WED11,
          note: 'Charger offline'
        }
      },
      token
    );

    assert.equal(fault.status, 201);

    // With 1 faulty bay, only 7 visitor bays remain.
    for (let i = 0; i < 7; i++) {
      const result = await s.call(
        'POST',
        '/api/bookings',
        {
          session: session({
            anonId: `V${i + 1}`
          }),
          booking: booking(),
          pass: {
            plate: `WXY${1000 + i}`,
            consent: true
          }
        }
      );

      assert.equal(result.status, 201);
    }

    // The eighth visitor must be rejected.
    const rejected = await s.call(
      'POST',
      '/api/bookings',
      {
        session: session({ anonId: 'V8' }),
        booking: booking(),
        pass: {
          plate: 'WXY9999',
          consent: true
        }
      }
    );

    assert.equal(rejected.status, 409);

    // JMB repairs the charger.
    const repaired = await s.call(
      'POST',
      '/api/jmb/lumina/maintenance',
      {
        entry: {
          bay: 1,
          kind: 'repair',
          costRm: 150,
          at: WED11 + 60000,
          note: 'Charger repaired'
        }
      },
      token
    );

    assert.equal(repaired.status, 201);

    // Eighth visitor should now be accepted.
    const accepted = await s.call(
      'POST',
      '/api/bookings',
      {
        session: session({ anonId: 'V8' }),
        booking: booking(),
        pass: {
          plate: 'WXY9999',
          consent: true
        }
      }
    );

    assert.equal(accepted.status, 201);

  } finally {
    await s.close();
  }
});
test('JMB can list and revoke resident keys without exposing the secret', async () => {
  const s = await start();
  try {
    const login = await s.call('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' });
    const seriniLogin = await s.call('POST', '/api/jmb/login', { condoId: 'serini', pin: '7305' });
    const token = login.body.token;
    const issued = await s.call('POST', '/api/jmb/lumina/resident-keys', {}, token);
    assert.equal(issued.status, 201);
    assert.match(issued.body.keyId, /^[a-f0-9]{16}$/);
    assert.equal(issued.headers.get('cache-control'), 'no-store');

    assert.equal((await s.call('GET', '/api/jmb/lumina/resident-keys')).status, 401);
    assert.equal((await s.call('GET', '/api/jmb/lumina/resident-keys', null, seriniLogin.body.token)).status, 401);
    const listing = await s.call('GET', '/api/jmb/lumina/resident-keys', null, token);
    assert.equal(listing.status, 200);
    assert.equal(listing.body.keys.length, 1);
    assert.equal(listing.body.keys[0].active, true);
    assert.ok(!JSON.stringify(listing.body).includes(issued.body.residentKey));
    assert.equal((await s.call('DELETE', `/api/jmb/serini/resident-keys/${issued.body.keyId}`, null, seriniLogin.body.token)).status, 404);

    const access = () => s.call('POST', '/api/bookings', {
      session: session({ role: 'resident', anonId: 'R15' }), booking: booking(),
      residentKey: issued.body.residentKey,
    });
    assert.equal((await access()).status, 201);

    assert.equal((await s.call('DELETE', `/api/jmb/lumina/resident-keys/${issued.body.keyId}`)).status, 401);
    assert.equal((await s.call('DELETE', `/api/jmb/lumina/resident-keys/${issued.body.keyId}`, null, token)).status, 200);
    assert.equal((await access()).status, 403);
    const after = await s.call('GET', '/api/jmb/lumina/resident-keys', null, token);
    assert.equal(after.body.keys[0].active, false);
    assert.ok(after.body.keys[0].revokedAt != null);
  } finally { await s.close(); }
});

test('direct-server login does not trust spoofed X-Forwarded-For values', async () => {
  const s = await start();
  try {
    for (let i = 0; i < 10; i++) {
      const r = await fetch(s.base + '/api/jmb/login', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${i + 1}` },
        body: JSON.stringify({ condoId: 'lumina', pin: 'wrong' }),
      });
      assert.equal(r.status, 401);
    }
    const blocked = await fetch(s.base + '/api/jmb/login', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.5' },
      body: JSON.stringify({ condoId: 'lumina', pin: '4821' }),
    });
    assert.equal(blocked.status, 429);
  } finally { await s.close(); }
});

test('legacy device-ID proposals cannot be counted or enacted after upgrade', async () => {
  const dir = tmp();
  const settings = { enabled: true, mode: 'auto', days: 'all', start: 9, end: 17, reservedBays: 2, visitorPrice: 1.2 };
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({
    proposals: { lumina: { id: 'old-device-vote', condoId: 'lumina', status: 'open',
      settings, createdAt: 100, closesAt: Date.now() + 864e5,
      votes: { 'fake-device-a': 'yes', 'fake-device-b': 'yes' } } }
  }));
  const s = await start({ dataDir: dir });
  try {
    const pub = await s.call('GET', '/api/condos/lumina/proposal');
    assert.equal(pub.body.proposal.legacyUnverified, true);
    assert.equal(pub.body.tally.cast, 0, 'legacy votes have no verified eligibility');
    assert.equal((await s.call('POST', '/api/condos/lumina/proposal/vote', { voterId: 'fake-device-c', vote: 'yes' })).status, 409);
    const token = (await s.call('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' })).body.token;
    assert.equal((await s.call('POST', '/api/jmb/lumina/proposal/close', {}, token)).status, 409);
    assert.notEqual((await s.call('GET', '/api/world')).body.sharing.lumina?.mode, 'auto');
    const replacement = await s.call('POST', '/api/jmb/lumina/proposal', { settings }, token);
    assert.equal(replacement.status, 201);
    assert.equal(replacement.body.proposal.votingScheme, 'verified-unit-v1');
  } finally {
    await s.close();
  }
});
