// Phase 8: proposal-aligned acceptance checks against the *real* Express API.
// The HTTP server, JSON store, model, and clock are fully isolated. No real
// chargers, live user data, provider credentials, or payment services are used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { CONDOS } from '../data/condos.js';

process.env.TZ = 'Asia/Kuala_Lumpur';
const SLOT = Date.parse('2026-10-21T11:00:00+08:00');
const TWO_HOURS = 2 * 60 * 60 * 1000;
const pilot = {
  ...CONDOS.find(c => c.id === 'lumina'),
  bays: 4,
  units: 20,
  sharing: { enabled: true, mode: 'hours', days: 'weekdays', start: 9, end: 17,
    reservedBays: 1, visitorPrice: 1.1 },
};

async function launch({ ai = null, fetchFn = async () => { throw new Error('External network disabled'); } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cassama-phase8-'));
  const app = createApp({
    dataDir: dir, secret: 'isolated-phase8-secret', pins: { lumina: '4821' },
    condos: [pilot], now: () => SLOT + 5 * 60_000, ai, fetchFn,
  });
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    async request(method, route, body, token) {
      const response = await fetch(base + route, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, headers: response.headers, body: await response.json() };
    },
    async close() {
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const session = (role, anonId, at = SLOT) => ({
  at, anonId, role, mode: 'balanced', chargerId: 'cs-lumina',
  condoId: 'lumina', topPickId: 'cs-lumina', nearestId: 'klem-dc',
  choice: 'pick1', kWh: 14, costRm: 15.4, nearestCostRm: 18.2, minutesVsNearest: 3,
});
const reserve = (role, anonId, start = SLOT, key) => ({
  session: session(role, anonId, start),
  booking: { chargerId: 'cs-lumina', start, end: start + TWO_HOURS },
  ...(role === 'visitor' ? { pass: { plate: `EV${anonId}1234`, consent: true } } : {}),
  ...(key ? { residentKey: key } : {}),
});
async function login(s) {
  const response = await s.request('POST', '/api/jmb/login', { condoId: 'lumina', pin: '4821' });
  assert.equal(response.status, 200);
  return response.body.token;
}
async function issueKey(s, token, unitId) {
  const response = await s.request('POST', '/api/jmb/lumina/resident-keys',
    unitId ? { unitId } : {}, token);
  assert.equal(response.status, 201);
  return response.body;
}

test('Phase 8 A1: sharing hours, capacity, authenticated resident priority and cancellation', async () => {
  const s = await launch();
  try {
    assert.equal((await s.request('GET', '/api/health')).body.ok, true);
    assert.equal((await s.request('GET', '/api/config')).body.ai, false);
    const token = await login(s);
    const key = await issueKey(s, token, 'A-12-08');
    assert.equal(key.votingEligible, true);

    // An outside driver cannot reserve a residential bay after visitor hours.
    const closed = await s.request('POST', '/api/bookings', reserve('visitor', 'V1', Date.parse('2026-10-21T20:00:00+08:00')));
    assert.equal(closed.status, 409);
    assert.equal((await s.request('POST', '/api/bookings', reserve('resident', 'R1'))).status, 403);

    const visitors = [];
    for (let n = 1; n <= 3; n++) {
      const booked = await s.request('POST', '/api/bookings', reserve('visitor', `V${n}`));
      assert.equal(booked.status, 201, `Visitor ${n}: ${JSON.stringify(booked.body)}`);
      assert.ok(booked.body.cancelToken);
      visitors.push(booked);
    }
    const full = await s.request('POST', '/api/bookings', reserve('visitor', 'V4'));
    assert.equal(full.status, 409);
    assert.ok(full.body.alternatives?.length, 'A full bay pool should provide an alternative');

    const resident = await s.request('POST', '/api/bookings', reserve('resident', 'R1', SLOT, key.residentKey));
    assert.equal(resident.status, 201, 'A valid resident uses the reserved fourth bay');
    assert.equal((await s.request('POST', '/api/bookings', reserve('resident', 'R2', SLOT, key.residentKey))).status, 409);

    const id = visitors[0].body.bookingId;
    assert.equal((await s.request('DELETE', `/api/bookings/${id}`, { cancelToken: 'not-an-owner' })).status, 403);
    assert.equal((await s.request('DELETE', `/api/bookings/${id}`, { cancelToken: visitors[0].body.cancelToken })).status, 200);
    assert.equal((await s.request('POST', '/api/bookings', reserve('visitor', 'V4'))).status, 201,
      'Cancelling a visitor reservation should free capacity immediately');

    assert.equal((await s.request('GET', '/api/jmb/lumina')).status, 401);
    const jmb = await s.request('GET', '/api/jmb/lumina', undefined, token);
    assert.equal(jmb.status, 200);
    assert.ok(jmb.body.passes.length >= 3);
    const world = await s.request('GET', '/api/world');
    assert.equal(world.status, 200);
    assert.ok(!JSON.stringify(world.body).includes(key.residentKey));
    assert.ok(!JSON.stringify(world.body).includes(visitors[1].body.cancelToken));

    // No charging session means no *recorded* receipts, regardless of forecasts.
    assert.equal((await s.request('GET', '/api/jmb/lumina/charging-revenue')).status, 401);
    const report = await s.request('GET', '/api/jmb/lumina/charging-revenue?month=2026-10', undefined, token);
    assert.equal(report.status, 200);
    assert.equal(report.body.sessionCount, 0);
    assert.equal(report.body.financials.revenue, 0);

    const revoke = await s.request('DELETE', `/api/jmb/lumina/resident-keys/${key.keyId}`, undefined, token);
    assert.equal(revoke.status, 200);
    const later = await s.request('POST', '/api/bookings', reserve('resident', 'R3', Date.parse('2026-10-22T11:00:00+08:00'), key.residentKey));
    assert.equal(later.status, 403, 'Revoked keys must no longer work for resident reservations');
    console.log('ACCEPTANCE EVIDENCE A1: three simultaneous visitor bookings, visitor overflow 409, resident fourth bay, non-owner cancellation 403, valid cancellation frees visitor capacity, zero unmetered revenue, revoked key 403');
  } finally { await s.close(); }
});

test('Phase 8 A2: one verified unit = one vote; sample votes do not count; JMB applies passed proposal', async () => {
  const s = await launch();
  try {
    const token = await login(s);
    const a = await issueKey(s, token, 'A-01');
    const aSecond = await issueKey(s, token, 'A-01');
    const b = await issueKey(s, token, 'B-02');
    const unverified = await issueKey(s, token);
    assert.equal(unverified.votingEligible, false);
    const proposed = { ...pilot.sharing, start: 10, end: 16 };
    const create = await s.request('POST', '/api/jmb/lumina/proposal', { settings: proposed }, token);
    assert.equal(create.status, 201);
    assert.equal(create.body.tally.cast, 0);
    const voteUrl = '/api/condos/lumina/proposal/vote';
    assert.equal((await s.request('POST', voteUrl, { vote: 'yes' })).status, 403);
    assert.equal((await s.request('POST', voteUrl, { vote: 'yes', residentKey: unverified.residentKey })).status, 403);
    const preview = await s.request('POST', '/api/jmb/lumina/proposal/sample', {}, token);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.tally.cast, 0, 'Synthetic preview cannot count as a real resident vote');

    assert.equal((await s.request('POST', voteUrl, { vote: 'yes', residentKey: a.residentKey })).status, 200);
    const changed = await s.request('POST', voteUrl, { vote: 'no', residentKey: aSecond.residentKey });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.tally.cast, 1, 'Multiple keys for the same unit must not increase turnout');
    assert.equal(changed.body.tally.no, 1, 'The unit can update its vote');
    const second = await s.request('POST', voteUrl, { vote: 'yes', residentKey: b.residentKey });
    assert.equal(second.status, 200);
    assert.equal(second.body.tally.cast, 2);
    assert.equal(second.body.tally.quorumMet, true);
    assert.equal(second.body.tally.passing, false, 'A tie is not a majority');
    assert.equal((await s.request('POST', voteUrl, { vote: 'yes', residentKey: a.residentKey })).status, 200);
    const closed = await s.request('POST', '/api/jmb/lumina/proposal/close', {}, token);
    assert.equal(closed.status, 200);
    assert.equal(closed.body.proposal.status, 'passed');
    assert.equal((await s.request('POST', voteUrl, { vote: 'no', residentKey: b.residentKey })).status, 409);

    const jmb = await s.request('GET', '/api/jmb/lumina', undefined, token);
    assert.equal(jmb.body.sharing.start, 10);
    assert.equal(jmb.body.sharing.end, 16);
    const publicProposal = await s.request('GET', '/api/condos/lumina/proposal');
    assert.equal(publicProposal.status, 200);
    assert.equal(JSON.stringify(publicProposal.body).includes(a.residentKey), false);
    assert.equal(JSON.stringify(publicProposal.body).includes('unitHash'), false);
    console.log('ACCEPTANCE EVIDENCE A2: unverified voters blocked; synthetic vote preview excluded; duplicate unit counts once; quorum and majority enforced; passed sharing rules applied');
  } finally { await s.close(); }
});

test('Phase 8 A3: mocked Gemini-style agent calls tools, offers confirmation only and blocks sensitive input', async () => {
  const messages = [];
  let providerCalls = 0;
  const fakeProvider = async (url, options) => {
    assert.match(String(url), /\/chat\/completions$/);
    const b = JSON.parse(options.body);
    messages.push(b);
    providerCalls++;
    const hasTool = b.messages.some(x => x.role === 'tool');
    const lastUser = [...b.messages].reverse().find(x => x.role === 'user')?.content || '';
    let message;
    if (hasTool) message = { role: 'assistant', content: 'Here is what the CasSama charging tools found. Please confirm any booking yourself.' };
    else if (/book/i.test(lastUser)) message = { role: 'assistant', content: null, tool_calls: [{
      id: 'b1', type: 'function', function: { name: 'propose_booking', arguments: JSON.stringify({ charger_id: 'cs-lumina' }) },
    }] };
    else message = { role: 'assistant', content: null, tool_calls: [{
      id: 'r1', type: 'function', function: { name: 'find_chargers', arguments: JSON.stringify({ battery_pct: 35, destination: 'KL East Mall', park_for: '2h' }) },
    }] };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message }] }) };
  };
  const s = await launch({ ai: { key: 'MOCK_NOT_A_REAL_KEY', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', models: ['gemini-2.5-flash'] }, fetchFn: fakeProvider });
  try {
    assert.equal((await s.request('GET', '/api/config')).body.ai, true);
    const ask = (text) => s.request('POST', '/api/agent', { text, context: {
      clock: new Date(SLOT).toISOString(), lat: pilot.lat, lng: pilot.lng, parkFor: '2h',
    } });
    const recommend = await ask('35% battery, find me an affordable charger near KL East Mall');
    assert.equal(recommend.status, 200);
    assert.equal(recommend.body.model, 'gemini-2.5-flash');
    assert.ok(recommend.body.steps.some(x => x.agent === 'Recommendation agent'));
    assert.ok(recommend.body.cards.some(x => x.kind === 'charger'));
    assert.equal(recommend.body.actions.length, 0, 'Ranking is not booking');
    assert.equal(messages[0].tools.some(x => x.function.name === 'find_chargers'), true);
    assert.ok(messages[1].messages.some(x => x.role === 'tool'));

    const proposed = await ask('Can you book a residential charger for me?');
    assert.equal(proposed.status, 200);
    assert.equal(proposed.body.actions[0]?.type, 'book');
    assert.equal(proposed.body.actions[0]?.chargerId, 'cs-lumina');
    assert.match(proposed.body.reply, /confirm/i);
    assert.equal((await s.request('GET', '/api/condos/lumina/summary')).body.count, 0,
      'A proposed Book action must not create a reservation');
    const callsBeforeGuard = providerCalls;
    const blocked = await ask('My card number is 4111111111111111 and CVV 123');
    assert.equal(blocked.status, 200);
    assert.match(blocked.body.reply, /never takes payments|don't share/i);
    assert.equal(providerCalls, callsBeforeGuard, 'A blocked secret must not reach the AI provider');
    console.log('ACCEPTANCE EVIDENCE A3: mocked provider reached tool orchestration, charger cards rendered, booking only proposed, payment secret blocked before provider');
  } finally { await s.close(); }
});
