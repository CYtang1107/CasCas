# Shared server implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Express service (Render free plan) serves the CasCas website and an `/api` so bookings, visitor plates, check-ins, sessions and sharing settings are shared across phones, with a PIN-protected JMB view.

**Architecture:** `server/` holds a small Express app that serves an allow-list of static files plus JSON endpoints, stores data in `server/data/store.json`, and reuses the pure engine modules for rules (plate checks, auto-approve, sharing validation, insights). The browser calls `api/health`; if it answers, the app runs in shared mode through `data/api.js`, otherwise it keeps today's local mode (GitHub Pages stays a working backup).

**Tech stack:** Node 20+ (local 25), Express 4, `node:test`, native `fetch`, `node:crypto` HMAC tokens, Render Blueprint.

Spec: `docs/superpowers/specs/2026-10-14-shared-server-design.md`. Commands run from `C:\Users\ASUS\cascas` in Git Bash.

## File map

| File | Status | Responsibility |
|---|---|---|
| `package.json`, `package-lock.json`, `.gitignore` | Modify | Express dependency, `start` script, ignore `server/data/` |
| `server/store.js` | Create | JSON file store with atomic writes and pruning |
| `server/auth.js` | Create | PIN login, rate limit, HMAC tokens |
| `server/pins.js` | Create | Demo PINs |
| `server/validate.js` | Create | Clean and validate request bodies |
| `server/app.js` | Create | Express app: static allow-list + API |
| `server/index.js` | Create | Start the server (TZ, env, port) |
| `data/api.js` | Create | Browser API client with timeouts |
| `engine/occupancy.js` | Modify | Booked bays add to occupancy |
| `app.js` | Modify | Shared/local mode, world from server |
| `views/driver.js` | Modify | Bookings, cancel, check-ins through the API |
| `views/jmb-insights.js` | Modify | Take sessions and passes as parameters |
| `views/jmb-shared.js` | Create | PIN login, logged-in JMB data, sharing save |
| `views/jmb.js` | Modify | Use the private section; read-only form when logged out |
| `index.html`, `styles.css` | Modify | Mode line; small styles |
| `render.yaml`, `README.md` | Create/Modify | Deploy and docs |
| `test/server-units.test.js`, `test/server.test.js`, `test/api-client.test.js` | Create | Tests |

---

### Task 1: Dependencies

- [ ] **Step 1:** `npm install express@4` (creates `package-lock.json`, adds `"dependencies": { "express": "^4.x" }`).
- [ ] **Step 2:** In `package.json` set `"scripts": { "test": "node --test", "start": "node server/index.js" }` and `"engines": { "node": ">=20" }`.
- [ ] **Step 3:** Append `server/data/` to `.gitignore`.
- [ ] **Step 4:** `npm test` → all pass. Commit `chore: add express for the shared server`.

### Task 2: Store, auth and demo PINs

**Files:** create `server/store.js`, `server/auth.js`, `server/pins.js`, `test/server-units.test.js`.

- [ ] **Step 1: Failing tests** — `test/server-units.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createAuth } from '../server/auth.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cascas-'));
const DAY = 864e5;

test('store starts empty, saves atomically and reloads', () => {
  const dir = tmp();
  const a = createStore(dir);
  assert.deepEqual(a.data, { sharing: {}, checkins: {}, sessions: [], passes: [], bookings: [] });
  a.data.sessions.push({ at: 1 });
  a.save();
  assert.ok(!fs.existsSync(path.join(dir, 'store.json.tmp')));
  assert.deepEqual(createStore(dir).data.sessions, [{ at: 1 }]);
});

test('a corrupt store file starts empty instead of crashing', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'store.json'), '{bad');
  assert.deepEqual(createStore(dir).data.passes, []);
});

test('prune drops passes 30 days after the slot and bookings made over 2 days ago', () => {
  const s = createStore(tmp());
  const now = 100 * DAY;
  s.data.passes = [{ id: 'old', slotEnd: now - 31 * DAY }, { id: 'new', slotEnd: now + DAY }];
  s.data.bookings = [{ id: 'b1', createdAt: now - 3 * DAY }, { id: 'b2', createdAt: now - DAY }];
  s.prune(now);
  assert.deepEqual(s.data.passes.map((p) => p.id), ['new']);
  assert.deepEqual(s.data.bookings.map((b) => b.id), ['b2']);
});

test('PIN login gives a token for that condo only; tokens expire', () => {
  let t = 1000;
  const auth = createAuth({ secret: 's3cret', pins: { lumina: '4821', serini: '7305' }, now: () => t });
  assert.equal(auth.login('lumina', '0000').status, 401);
  const ok = auth.login('lumina', '4821');
  assert.equal(ok.status, 200);
  assert.ok(auth.verify(`Bearer ${ok.token}`, 'lumina'));
  assert.ok(!auth.verify(`Bearer ${ok.token}`, 'serini'));
  assert.ok(!auth.verify(`Bearer ${ok.token.slice(0, -2)}xx`, 'lumina'));
  assert.ok(!auth.verify(undefined, 'lumina'));
  t += 12 * 3600e3 + 1;
  assert.ok(!auth.verify(`Bearer ${ok.token}`, 'lumina'));
});

test('ten wrong PINs in 10 minutes lock that condo', () => {
  let t = 0;
  const auth = createAuth({ secret: 'x', pins: { lumina: '4821' }, now: () => t });
  for (let i = 0; i < 10; i++) assert.equal(auth.login('lumina', '1').status, 401);
  assert.equal(auth.login('lumina', '4821').status, 429);
  t += 10 * 60e3 + 1;
  assert.equal(auth.login('lumina', '4821').status, 200);
});
```

- [ ] **Step 2:** `node --test test/server-units.test.js` → FAIL (modules missing).
- [ ] **Step 3: `server/store.js`**

```js
// JSON file store. Small, single process; writes go to a temp file then rename.
import fs from 'node:fs';
import path from 'node:path';
import { purgePasses } from '../engine/access.js';

const empty = () => ({ sharing: {}, checkins: {}, sessions: [], passes: [], bookings: [] });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'store.json');
  let data = empty();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (isObj(raw)) {
      for (const k of ['sharing', 'checkins']) if (isObj(raw[k])) data[k] = raw[k];
      for (const k of ['sessions', 'passes', 'bookings']) if (Array.isArray(raw[k])) data[k] = raw[k].filter(isObj);
    }
  } catch { /* missing or corrupt: start empty */ }

  return {
    get data() { return data; },
    save() {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    },
    prune(nowMs) {
      data.passes = purgePasses(data.passes, nowMs);
      data.bookings = data.bookings.filter((b) => nowMs - b.createdAt < 2 * 864e5);
    },
  };
}
```

- [ ] **Step 4: `server/auth.js`**

```js
// JMB login: PIN per condo → signed token valid 12 h for that condo only.
import crypto from 'node:crypto';

const TOKEN_MS = 12 * 3600e3;
const WINDOW_MS = 10 * 60e3;
const MAX_TRIES = 10;

export function createAuth({ secret, pins, now = () => Date.now() }) {
  const tries = new Map();
  const sign = (condoId, exp) => crypto.createHmac('sha256', secret).update(`${condoId}.${exp}`).digest('hex');

  function login(condoId, pin) {
    const t = now();
    const recent = (tries.get(condoId) || []).filter((x) => t - x < WINDOW_MS);
    tries.set(condoId, recent);
    if (recent.length >= MAX_TRIES) return { status: 429 };
    if (!pins[condoId] || String(pin) !== String(pins[condoId])) { recent.push(t); return { status: 401 }; }
    tries.delete(condoId);
    const expiresAt = t + TOKEN_MS;
    return { status: 200, token: `${condoId}.${expiresAt}.${sign(condoId, expiresAt)}`, expiresAt };
  }

  function verify(header, condoId) {
    const m = /^Bearer (\S+)$/.exec(header || '');
    if (!m) return false;
    const [id, exp, sig] = m[1].split('.');
    if (id !== condoId || !(Number(exp) > now())) return false;
    const a = Buffer.from(sig || '', 'hex');
    const b = Buffer.from(sign(id, Number(exp)), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  return { login, verify };
}
```

- [ ] **Step 5: `server/pins.js`**

```js
// Demo PINs for the public prototype (listed in the README for judges). Set JMB_PINS in production.
export const DEMO_PINS = { lumina: '4821', serini: '7305', kenanga: '1946', vista: '5582', azalea: '3017', teratai: '6643' };
```

- [ ] **Step 6:** `npm test` → all pass. Commit `feat(server): JSON store and JMB PIN tokens`.

### Task 3: Validation and the Express app

**Files:** create `server/validate.js`, `server/app.js`, `server/index.js`, `test/server.test.js`.

- [ ] **Step 1: Failing tests** — `test/server.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { DEMO_CHARGERS } from '../data/chargers-demo.js';
import { CONDO_SITES } from '../data/chargers.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/ocm-sample.json', import.meta.url), 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cascas-srv-'));
const WED11 = new Date(2026, 9, 21, 11).getTime();
const WED20 = new Date(2026, 9, 21, 20).getTime();

async function start(opts = {}) {
  const app = createApp({ dataDir: opts.dataDir || tmp(), secret: 'test', pins: { lumina: '4821', serini: '7305' },
    ocmKey: opts.ocmKey ?? '', fetchFn: opts.fetchFn || (async () => { throw new Error('offline'); }), now: opts.now });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, token) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
  };
  const raw = (method, url, body) => fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body });
  return { call, raw, close: () => new Promise((r) => server.close(r)) };
}

const session = (extra = {}) => ({ at: WED11, anonId: 'V12', role: 'visitor', mode: 'balanced', chargerId: 'cs-lumina', condoId: 'lumina',
  topPickId: 'cs-lumina', nearestId: 'klem-dc', choice: 'pick1', kWh: 14, costRm: 15.4, nearestCostRm: 18.2, minutesVsNearest: 3, overstayMin: 0, ...extra });
const booking = (start = WED11) => ({ chargerId: 'cs-lumina', start, end: start + 150 * 60000 });

test('health, static files and no data files served', async () => {
  const s = await start();
  assert.deepEqual((await s.call('GET', '/api/health')).body, { ok: true });
  const page = await s.raw('GET', '/');
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('CasCas'));
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
  assert.deepEqual((await s.call('GET', '/api/jmb/lumina', null, login.token)).body.passes, []);
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
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: `server/validate.js`, `server/app.js`, `server/index.js`** — implement exactly the endpoints in the spec (code written in the execution step; contracts are fixed by the tests above): static allow-list (`index.html`, `app.js`, `config.js`, `state.js`, `styles.css`, `/data`, `/engine`, `/views`) with `Cache-Control: no-cache`; JSON body limit 50 kB; JSON error handler; 404 JSON for unknown `/api`; charger source = `loadChargers()` with a file-backed storage and a 24 h (live) / 10 min (fallback) memo; `TZ=Asia/Kuala_Lumpur` set in `index.js` so sharing hours match Malaysia.
- [ ] **Step 4:** `npm test` → all pass. Commit `feat(server): shared API for bookings, passes, check-ins and JMB`.

### Task 4: Browser API client and booked bays

**Files:** create `data/api.js`, `test/api-client.test.js`; modify `engine/occupancy.js`.

- [ ] **Step 1: Failing tests** — `test/api-client.test.js`: `createApi` with a fake fetch returns `{ ok: true, data }` on 200, `{ ok: false, status, error }` on 4xx using the body's `error`, `{ ok: false, status: 0, error: 'Server unavailable' }` when fetch throws; sends `authorization: Bearer` for JMB calls and `cancelToken` in the DELETE body; URLs are relative (`api/...`) so GitHub Pages under `/CasCas/` gets a 404 and `detectServer` returns false. `occupancyAt` adds `bookedBays / bays` (capped at 1).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement `data/api.js` (`createApi({ base = '', fetchFn })` with `health, chargers, world(at), book(body), cancel(id, token), checkin(body), summary(condoId), login(condoId, pin), jmb(condoId, token), saveSharing(condoId, token, sharing)`; 5 s timeout) and `detectServer(api)`. In `engine/occupancy.js` use `const base = Math.min(1, baseOccupancy(charger, date) + (charger.bookedBays || 0) / charger.bays);`.
- [ ] **Step 4:** `npm test` → all pass. Commit `feat: browser API client and booked bays in occupancy`.

### Task 5: Shared mode in the app shell

**Files:** modify `app.js`, `index.html`, `styles.css`.

- [ ] `start()`: `detectServer(createApi())` → shared: chargers from `api.chargers()` (fallback `loadChargers()`), world from `api.world(clock)`; local: as today. `render()` builds the world from `{ ...state, sharing: world.sharing, checkins: world.checkins }` and chargers with `bookedBays` in shared mode. `ctx` gains `api` (null in local mode) and `refresh()` (refetch world, then render). Clock changes call `refresh()`. World fetch failure → local mode with the line "This device only (server unavailable)". `index.html` gets `<p id="data-mode" class="source"></p>`.
- [ ] Browser check with `npm start` → mode line "Shared demo: bookings are visible to everyone"; with the static server → "This device only". Commit.

### Task 6: Driver bookings through the server

**Files:** modify `views/driver.js`.

- [ ] `book()` becomes async: builds the session and slot (`slotEnd = arrival + max(60, ceil((hold + stopChargeMin)/30)*30)` min); shared mode posts `{ session, booking: { chargerId, start, end }, pass: { plate, consent: true } | undefined }` and uses the server's pass, `bookingId`, `cancelToken`; on failure shows the server's error (e.g. "Residensi Lumina is not sharing at that time") or "Couldn't save your booking, try again." and stays on the picks. Local mode unchanged. Cancel calls `api.cancel`; check-ins call `api.checkin`; both then `ctx.refresh()`.
- [ ] Browser check in shared mode: book a visitor bay → a second browser tab sees the bay count change. Commit.

### Task 7: JMB with PIN

**Files:** create `views/jmb-shared.js`; modify `views/jmb-insights.js`, `views/jmb.js`, `styles.css`.

- [ ] `insightsSection(condo, charger, ctx, realSessions)` and `visitorsHtml(condo, ctx, passes)` take data as parameters.
- [ ] `privateSection(condo, charger, ctx)` returns `{ canEdit, html, bind, save }`: local mode → today's cards from local state; shared without token → PIN form + public summary; shared with token (kept in `sessionStorage`, refetched when older than 10 s) → "Logged in" chip, Log out, expected visitors with plates, driver behaviour from server sessions; `save(sharing)` → `api.saveSharing` then `ctx.refresh()`.
- [ ] `jmb.js`: sharing form inside `<fieldset disabled>` when `!canEdit` with a "Log in with the condo PIN below" note; change handler saves through `priv.save` in shared mode.
- [ ] Browser check: wrong PIN → "Wrong PIN."; right PIN → plates visible; Log out hides them. Commit.

### Task 8: Deploy files and docs

- [ ] `render.yaml` (free web service, `npm ci`, `npm start`, `healthCheckPath: /api/health`, env `NODE_VERSION=20`, `TZ=Asia/Kuala_Lumpur`, `OCM_KEY` sync false, `JMB_SECRET` generated).
- [ ] README: "Shared demo on Render" (Blueprint steps, sleep after 15 min, resets on restart, do not enter real plates), demo PINs table, local `npm start`.
- [ ] `npm test` → all pass; full browser walk-through on `npm start`; commit; push (approved by the user) so GitHub Pages gets the local-mode-compatible build.
