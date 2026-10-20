import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOLS, runTool, guardInput, amountsGrounded } from '../engine/agent.js';
import { createAgent } from '../server/agent.js';
import { createApp } from '../server/app.js';
import { CONDOS } from '../data/condos.js';
import { CARS } from '../data/cars.js';
import { START } from '../data/places.js';
import { DEMO_CHARGERS } from '../data/chargers-demo.js';
import { CONDO_SITES } from '../data/chargers.js';

const WED11 = new Date(2026, 9, 21, 11);
const env = {
  world: { chargers: [...CONDO_SITES, ...DEMO_CHARGERS], condos: CONDOS },
  car: CARS[0], origin: { ...START, name: 'KL East' }, clock: WED11, homeId: null, parkFor: '2h', prefs: {},
};

test('every tool has a runner, and runners use the real engines', () => {
  for (const t of TOOLS) assert.ok(!runTool(t.function.name, {}, env)?.error?.startsWith('Unknown tool'), t.function.name);
  const r = runTool('find_chargers', { battery_pct: 20 }, env);
  assert.ok(r.picks.length > 0 && r.picks[0].price_per_kwh > 0);
  const trip = runTool('plan_trip', { destination: 'Melaka', battery_pct: 60 }, env);
  assert.equal(trip.ok, true);
  assert.equal(trip.destination, 'Melaka');
  assert.equal(runTool('plan_trip', { destination: 'Atlantis', battery_pct: 60 }, env).ok, false);
  const cost = runTool('estimate_cost', { charger_id: 'cs-lumina', kwh: 10 }, env);
  assert.equal(cost.cost_rm, Math.round(cost.price_per_kwh * 10 * 100) / 100);
  assert.ok(runTool('condo_revenue', { condo_id: 'lumina' }, env).jmb_income_rm > 0);
  assert.equal(runTool('search_knowledge', { query: 'overstay fee' }, env).passages[0].id, 'kb-overstay');
});

test('the assistant can only propose a booking, never make one', () => {
  const r = runTool('propose_booking', { charger_id: 'cs-lumina' }, env);
  assert.equal(r.proposed, true);
  assert.match(r.note, /nothing is booked/);
});

test('guardrails block card numbers, passwords and empty input', () => {
  assert.equal(guardInput('my card is 4111 1111 1111 1111').block, true);
  assert.equal(guardInput('what is my password').block, true);
  assert.equal(guardInput('  ').block, true);
  assert.equal(guardInput('x'.repeat(700)).block, true);
  assert.equal(guardInput('where should I charge at 20%').block, false);
});

test('amounts must come from tools', () => {
  assert.equal(amountsGrounded('It costs RM15.40.', ['{"cost_rm":15.4}']).ok, true);
  assert.equal(amountsGrounded('About RM15.', ['{"cost_rm":15.4}']).ok, true);
  assert.deepEqual(amountsGrounded('It costs RM99.', ['{"cost_rm":15.4}']).missing, [99]);
});

// A fake DashScope: replies in order from a script, recording each request.
function fakeAi(script) {
  const seen = [];
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push(body);
    const next = script.shift();
    if (typeof next === 'number') return { ok: false, status: next, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: next }] }) };
  };
  return { fetchFn, seen };
}
const call = (name, args, id = 'c1') => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const ctx = { clock: WED11, carName: 'Test car', originName: 'KL East' };

test('orchestrator calls tools, then answers with citations and actions', async () => {
  const kwh = 10;
  const price = runTool('estimate_cost', { charger_id: 'cs-lumina', kwh }, env).cost_rm;
  const { fetchFn, seen } = fakeAi([
    call('search_knowledge', { query: 'overstay' }),
    call('estimate_cost', { charger_id: 'cs-lumina', kwh }, 'c2'),
    call('propose_booking', { charger_id: 'cs-lumina' }, 'c3'),
    { role: 'assistant', content: `10 kWh at Lumina costs RM${price.toFixed(2)}. Overstay is RM1 per 10 minutes.` },
  ]);
  const agent = createAgent({ key: 'k', fetchFn });
  const r = await agent.ask({ text: 'cost of 10 kWh at lumina?', env, context: ctx });
  assert.match(r.reply, /RM/);
  assert.deepEqual(r.citations.map((c) => c.id).includes('kb-overstay'), true);
  assert.equal(r.actions[0].type, 'book');
  assert.ok(r.steps.some((s) => s.agent === 'Cost estimation agent'));
  assert.equal(seen[0].tools.length, TOOLS.length);
  assert.ok(seen[1].messages.some((m) => m.role === 'tool'));
});

test('falls back to the next model on 429', async () => {
  const { fetchFn, seen } = fakeAi([429, { role: 'assistant', content: 'Hello, ask me about charging.' }]);
  const r = await createAgent({ key: 'k', fetchFn, models: ['a', 'b'] }).ask({ text: 'hi', env, context: ctx });
  assert.equal(r.model, 'b');
  assert.deepEqual(seen.map((s) => s.model), ['a', 'b']);
});

test('an invented amount is corrected, then removed', async () => {
  const fixed = fakeAi([{ role: 'assistant', content: 'It is RM42.' }, { role: 'assistant', content: 'I need a charger to price that.' }]);
  const r1 = await createAgent({ key: 'k', fetchFn: fixed.fetchFn }).ask({ text: 'price?', env, context: ctx });
  assert.equal(r1.reply, 'I need a charger to price that.');
  const stuck = fakeAi([{ role: 'assistant', content: 'It is RM42.' }, { role: 'assistant', content: 'Still RM42.' }]);
  const r2 = await createAgent({ key: 'k', fetchFn: stuck.fetchFn }).ask({ text: 'price?', env, context: ctx });
  assert.doesNotMatch(r2.reply, /RM42/);
});

test('blocked input never reaches the model', async () => {
  const { fetchFn, seen } = fakeAi([]);
  const r = await createAgent({ key: 'k', fetchFn }).ask({ text: 'card 4111111111111111 cvv 123', env, context: ctx });
  assert.match(r.reply, /never takes payments/);
  assert.equal(seen.length, 0);
});

test('rate limit per address', () => {
  const agent = createAgent({ key: 'k', perIp: 2, now: () => 0 });
  assert.equal(agent.allow('a'), true);
  assert.equal(agent.allow('a'), true);
  assert.equal(agent.allow('a'), false);
  assert.equal(agent.allow('b'), true);
});

test('POST /api/agent: off without a key, answers with one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cassama-ai-'));
  const run = async (ai, fetchFn) => {
    const app = createApp({ dataDir: dir, secret: 's', pins: {}, ai, fetchFn });
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const cfg = await (await fetch(`${base}/api/config`)).json();
    const res = await fetch(`${base}/api/agent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hi', context: { clock: WED11.toISOString() } }) });
    const body = await res.json();
    await new Promise((r) => server.close(r));
    return { cfg, status: res.status, body };
  };
  const off = await run(null, async () => { throw new Error('offline'); });
  assert.equal(off.cfg.ai, false);
  assert.equal(off.status, 404);
  const ai = async (url) => (String(url).includes('chat/completions')
    ? { ok: true, status: 200, json: async () => ({ choices: [{ message: { role: 'assistant', content: 'Hi! Ask me about charging.' } }] }) }
    : Promise.reject(new Error('offline')));
  const on = await run({ key: 'k' }, ai);
  assert.equal(on.cfg.ai, true);
  assert.equal(on.status, 200);
  assert.equal(on.body.reply, 'Hi! Ask me about charging.');
});

test('chat replies render a safe subset of Markdown', async () => {
  const { richText } = await import('../views/chat.js');
  assert.equal(richText('Go to **Lumina**.'), '<p>Go to <b>Lumina</b>.</p>');
  assert.equal(richText('Options:\n- **A** cheap\n- B fast'), '<p>Options:</p><ul><li><b>A</b> cheap</li><li>B fast</li></ul>');
  assert.equal(richText('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
});

test('charger names in capitals are tidied for the reply', async () => {
  const { tidyName } = await import('../engine/agent.js');
  assert.equal(tidyName('SMILE HOTEL WANGSA MAJU'), 'Smile Hotel Wangsa Maju');
  assert.equal(tidyName('KL East Mall DC'), 'KL East Mall DC');
});
