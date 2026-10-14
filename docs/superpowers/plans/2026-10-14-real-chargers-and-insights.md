# Real chargers, driver insights and visitor access: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the SDP view, load real public chargers live from Open Charge Map with a safe fallback, record whether drivers follow CasCas's recommendation and show it to the JMB, and let visitors book shared condo bays by number plate with automatic approval during sharing hours.

**Architecture:** The app stays a static site (GitHub Pages). New logic goes into small pure modules under `engine/` (normalise, insights, history, access) that are unit-tested with `node --test`. `data/ocm.js` handles the network and the saved copy. Views stay thin: the driver view gains a plate step and a saving line, and the JMB view gains two cards that live in a new `views/jmb-insights.js`.

**Tech stack:** Vanilla JavaScript ES modules, Leaflet 1.9.4, Node.js built-in test runner, Open Charge Map API v3, browser `localStorage`.

Spec: `docs/superpowers/specs/2026-10-14-real-chargers-and-insights-design.md`

All commands run from the repo root `C:\Users\ASUS\cascas` in Git Bash. `npm test` runs `node --test`.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `views/sdp.js` | Delete | SDP view (removed) |
| `index.html` | Modify | Two tabs; data-source line; footer text |
| `app.js` | Modify | Two views; async charger load; source line; purge old passes |
| `config.js` | Modify | Drop SDP constants; add `OCM` settings |
| `engine/economics.js` | Modify | Drop `siteMonthlyKwh`, `townshipSummary`, `scaleUp` |
| `data/chargers-demo.js` | Create | The 15 simulated public chargers (fallback) |
| `data/chargers.js` | Modify | `CONDO_SITES` (pilot condos) and `CHARGERS` (demo world) |
| `data/operator-prices.js` | Create | Sourced RM/kWh per operator; `priceFor` |
| `engine/normalise.js` | Create | Open Charge Map POI → CasCas charger |
| `data/ocm.js` | Create | Live fetch, saved copy, demo fallback |
| `state.js` | Modify | `sessions`, `visitorPasses`, `anonNo`; `addSession`, `anonNumber` |
| `engine/insights.js` | Create | Session record and follow-rate analytics; CSV |
| `engine/history.js` | Create | Seeded 6-month simulated session history |
| `engine/access.js` | Create | Plate cleaning, auto-approve, visitor passes |
| `views/format.js` | Modify | `fmtDay`, `fmtClock` |
| `views/charts.js` | Modify | `lineChart` non-money axis option |
| `views/driver.js` | Modify | "est." price, more chargers, plate step, session record, saving line |
| `views/jmb-insights.js` | Create | "Driver behaviour" and "Expected visitors" cards |
| `views/jmb.js` | Modify | Mount the two new cards |
| `styles.css` | Modify | Small styles for new elements |
| `README.md` | Modify | Two views, data source, OCM key, new demo script |
| `test/*.test.js`, `test/fixtures/ocm-sample.json` | Create/modify | Tests per task |

---

### Task 1: Remove the SDP view

**Files:**
- Delete: `views/sdp.js`
- Modify: `index.html`, `app.js`, `config.js`, `engine/economics.js`, `test/economics.test.js`, `README.md`

- [ ] **Step 1: Rewrite the township test so it no longer needs `townshipSummary`**

In `test/economics.test.js`, change the import block at the top to:

```js
import {
  co2AvoidedKg, monthlyEconomics, simulateCondoMonth, rampSeries,
} from '../engine/economics.js';
```

Delete the whole `test('township totals and scale-up', () => { ... });` block.

Replace the `test('simulated KL East: sharing condos earn more per unit than non-sharing ones', ...)` block with:

```js
test('simulated KL East: sharing condos earn more per unit than non-sharing ones', () => {
  const perCondo = CONDOS.map((c) => ({ condo: c, ...simulateCondoMonth(c, CHARGERS.find((ch) => ch.condoId === c.id), oct) }));
  const avg = (rows) => rows.reduce((s, r) => s + r.perUnitSaving, 0) / rows.length;
  const sharing = perCondo.filter((r) => r.condo.sharing.enabled);
  const closed = perCondo.filter((r) => !r.condo.sharing.enabled);
  assert.ok(avg(sharing) > avg(closed), `${avg(sharing)} vs ${avg(closed)}`);
  for (const r of perCondo) assert.ok(r.perUnitSaving > 3 && r.perUnitSaving < 40, `${r.condo.id}: ${r.perUnitSaving}`);
});
```

- [ ] **Step 2: Run the tests**

Run: `npm test`
Expected: all tests pass (one fewer than before: 40).

- [ ] **Step 3: Remove the SDP code**

Delete `views/sdp.js`:

```bash
git rm views/sdp.js
```

In `engine/economics.js`, delete the functions `siteMonthlyKwh`, `townshipSummary` and `scaleUp` (everything from `export function siteMonthlyKwh` down to the closing brace of `scaleUp`). Keep `rampSeries`. If `co2AvoidedKg` is still used by `monthlyEconomics`, keep it.

In `config.js`, delete these two lines from `CONST`:

```js
  nationalTarget2030: 30000,
  sdpTownships: 28,
```

In `app.js`, delete `import { renderSdp } from './views/sdp.js';` and change the views line to:

```js
const VIEWS = { driver: renderDriver, jmb: renderJmb };
```

(`currentRole()` already sends an unknown hash such as `#sdp` to `'driver'`.)

In `index.html`, delete the line:

```html
      <a href="#sdp" data-role="sdp">SDP</a>
```

- [ ] **Step 4: Check nothing still references the removed code**

Run: `grep -rn "renderSdp\|townshipSummary\|scaleUp\|siteMonthlyKwh\|sdpTownships\|nationalTarget2030" --include=*.js --include=*.html . | grep -v "^./docs"`
Expected: no output.

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Update the README**

In `README.md`, under "What it shows", delete the `- **SDP:** ...` bullet. Under "60-second demo script", delete step 6 (the `**SDP**` step).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove the SDP view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Split demo chargers and add operator prices

**Files:**
- Create: `data/chargers-demo.js`, `data/operator-prices.js`
- Modify: `data/chargers.js`
- Test: `test/operator-prices.test.js`

- [ ] **Step 1: Write the failing test for `priceFor`**

Create `test/operator-prices.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceFor, DEFAULT_PRICE } from '../data/operator-prices.js';
import { CHARGERS, CONDO_SITES } from '../data/chargers.js';
import { DEMO_CHARGERS } from '../data/chargers-demo.js';

test('known operators get their sourced rate, matched loosely', () => {
  assert.deepEqual(priceFor('Gentari Sdn Bhd', 'DC'), { price: 1.3, priceEstimated: false });
  assert.deepEqual(priceFor('ChargEV (Malaysia Green Technology Corp)', 'AC'), { price: 0.9, priceEstimated: false });
  assert.deepEqual(priceFor('jomcharge', 'AC'), { price: 1.1, priceEstimated: false });
  assert.deepEqual(priceFor('Tesla (Tesla-only charging)', 'DC'), { price: 1.8, priceEstimated: false });
});

test('unknown operator or missing rate falls back to an estimated default', () => {
  assert.deepEqual(priceFor('Unknown operator', 'AC'), { price: DEFAULT_PRICE.AC, priceEstimated: true });
  assert.deepEqual(priceFor(null, 'DC'), { price: DEFAULT_PRICE.DC, priceEstimated: true });
  assert.deepEqual(priceFor('Tesla Destination', 'AC'), { price: DEFAULT_PRICE.AC, priceEstimated: true });
});

test('demo world = pilot condo sites + demo public chargers', () => {
  assert.equal(CHARGERS.length, CONDO_SITES.length + DEMO_CHARGERS.length);
  assert.ok(CONDO_SITES.every((c) => c.siteType === 'condo' && c.pilot === true));
  assert.ok(DEMO_CHARGERS.every((c) => c.siteType !== 'condo'));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/operator-prices.test.js`
Expected: FAIL, cannot find module `../data/operator-prices.js`.

- [ ] **Step 3: Create `data/operator-prices.js`**

```js
// Public 2026 rates in RM/kWh from the research brief. Add an operator only with a sourced rate.
export const OPERATOR_PRICES = {
  gentari: { AC: 1.0, DC: 1.3 },
  chargev: { AC: 0.9, DC: 1.3 },
  jomcharge: { AC: 1.1, DC: 1.3 },
  tesla: { DC: 1.8 },
};

export const DEFAULT_PRICE = { AC: 1.0, DC: 1.3 };

// Open Charge Map operator titles vary ("Gentari Sdn Bhd"), so match by substring.
export function priceFor(operator, type) {
  const name = String(operator || '').toLowerCase();
  const key = Object.keys(OPERATOR_PRICES).find((k) => name.includes(k));
  const rate = key ? OPERATOR_PRICES[key][type] : undefined;
  return rate ? { price: rate, priceEstimated: false } : { price: DEFAULT_PRICE[type], priceEstimated: true };
}
```

- [ ] **Step 4: Move the public chargers into `data/chargers-demo.js`**

Create `data/chargers-demo.js` with the `site` helper and the 15 non-condo entries that are currently in `data/chargers.js`, unchanged:

```js
// Simulated public chargers around KL East: the fallback when Open Charge Map is unavailable.
const site = (id, name, operator, lat, lng, type, kw, bays, price, reliability, siteType, extra = {}) => ({
  id, name, operator, lat, lng, type, kw, bays, price, reliability, siteType,
  connectors: type === 'DC' ? ['CCS2'] : ['Type2'], ...extra,
});

export const DEMO_CHARGERS = [
  site('klem-dc', 'KL East Mall DC', 'Gentari', 3.2126, 101.7235, 'DC', 60, 4, 1.30, 0.96, 'mall', { sdp: true, busyBias: 0.12 }),
  site('klem-ac', 'KL East Mall AC', 'Gentari', 3.2129, 101.7240, 'AC', 11, 6, 1.00, 0.95, 'mall', { sdp: true }),
  site('wwalk-ac', 'Wangsa Walk Mall AC', 'ChargEV', 3.2057, 101.7377, 'AC', 22, 4, 0.90, 0.90, 'mall'),
  site('wwalk-dc', 'Wangsa Walk Mall DC', 'JomCharge', 3.2060, 101.7381, 'DC', 60, 2, 1.30, 0.88, 'mall'),
  site('melawati-dc', 'Melawati Mall DC', 'Gentari', 3.2107, 101.7484, 'DC', 120, 4, 1.30, 0.97, 'mall'),
  site('melawati-ac', 'Melawati Mall AC', 'ChargEV', 3.2104, 101.7480, 'AC', 22, 4, 0.90, 0.90, 'mall'),
  site('setapak-ac', 'Setapak Central AC', 'JomCharge', 3.2040, 101.7180, 'AC', 11, 4, 1.10, 0.85, 'mall'),
  site('setapak-dc', 'Setapak Central DC', 'ChargEV', 3.2044, 101.7184, 'DC', 50, 2, 1.30, 0.62, 'mall'),
  site('genting-dc', 'Jalan Genting Klang DC', 'Gentari', 3.1985, 101.7090, 'DC', 120, 4, 1.30, 0.95, 'public'),
  site('duke-dc', 'DUKE Highway DC', 'Gentari', 3.2205, 101.7105, 'DC', 180, 6, 1.70, 0.94, 'public'),
  site('melati-ac', 'Taman Melati LRT AC', 'ChargEV', 3.2196, 101.7193, 'AC', 7, 2, 0.90, 0.87, 'public'),
  site('gombak-dc', 'Gombak Terminal DC', 'JomCharge', 3.2312, 101.7243, 'DC', 60, 2, 1.40, 0.83, 'public'),
  site('danau-ac', 'Danau Kota AC', 'JomCharge', 3.2081, 101.7175, 'AC', 22, 2, 1.10, 0.90, 'public'),
  site('ampang-ac', 'Ampang Point AC', 'Gentari', 3.1600, 101.7500, 'AC', 11, 4, 1.00, 0.93, 'mall'),
  site('klcc-tesla', 'KLCC Supercharger', 'Tesla', 3.1586, 101.7140, 'DC', 250, 8, 1.80, 0.99, 'mall'),
];
```

Replace the whole of `data/chargers.js` with:

```js
// Pilot condo sites (simulated) plus the demo public chargers. Live public chargers come from data/ocm.js.
import { CONDOS } from './condos.js';
import { DEMO_CHARGERS } from './chargers-demo.js';

export const CONDO_SITES = CONDOS.map((c) => ({
  id: `cs-${c.id}`, name: `${c.name} car park`, operator: 'Condo CPO partner',
  lat: c.lat, lng: c.lng, type: 'AC', kw: 7, connectors: ['Type2'], bays: c.bays,
  siteType: 'condo', condoId: c.id, reliability: 0.97, price: null, pilot: true,
}));

export const CHARGERS = [...CONDO_SITES, ...DEMO_CHARGERS];
```

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: all pass, including the 3 new ones.

- [ ] **Step 6: Commit**

```bash
git add data/chargers.js data/chargers-demo.js data/operator-prices.js test/operator-prices.test.js
git commit -m "feat: split demo chargers and add sourced operator prices

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Convert Open Charge Map stations (`engine/normalise.js`)

**Files:**
- Create: `engine/normalise.js`, `test/fixtures/ocm-sample.json`
- Test: `test/normalise.test.js`

- [ ] **Step 1: Create the fixture `test/fixtures/ocm-sample.json`**

```json
[
  { "ID": 101, "NumberOfPoints": 3,
    "AddressInfo": { "Title": "KL East Mall", "AddressLine1": "Jalan Test 1", "Town": "Kuala Lumpur", "Latitude": 3.2126, "Longitude": 101.7235 },
    "OperatorInfo": { "Title": "Gentari Sdn Bhd" },
    "UsageType": { "Title": "Public - Membership Required" },
    "StatusType": { "IsOperational": true },
    "Connections": [
      { "ConnectionType": { "Title": "CCS (Type 2)" }, "PowerKW": 60, "Quantity": 2 },
      { "ConnectionType": { "Title": "Type 2 (Socket Only)" }, "PowerKW": 22, "Quantity": 1 } ] },
  { "ID": 102, "NumberOfPoints": null,
    "AddressInfo": { "Title": "Wangsa Walk", "Latitude": 3.2057, "Longitude": 101.7377 },
    "OperatorInfo": { "Title": "ChargEV (Malaysia Green Technology Corp)" },
    "UsageType": { "Title": "Public" },
    "StatusType": { "IsOperational": true },
    "Connections": [ { "ConnectionType": { "Title": "Type 2 (Socket Only)" }, "PowerKW": 22, "Quantity": 2 } ] },
  { "ID": 103,
    "AddressInfo": { "Title": "Shoplot charger", "Latitude": 3.21, "Longitude": 101.72 },
    "OperatorInfo": null,
    "UsageType": { "Title": "Public" },
    "StatusType": null,
    "Connections": [ { "ConnectionType": { "Title": "Type 2 (Tethered Connector)" }, "PowerKW": 7, "Quantity": null } ] },
  { "ID": 104, "NumberOfPoints": 1,
    "AddressInfo": { "Title": "Gombak DC", "Latitude": 3.2312, "Longitude": 101.7243 },
    "OperatorInfo": { "Title": "JomCharge" },
    "UsageType": { "Title": "Public - Pay At Location" },
    "StatusType": { "IsOperational": false },
    "Connections": [ { "ConnectionType": { "Title": "CHAdeMO" }, "PowerKW": 50, "Quantity": 1 } ] },
  { "ID": 105, "NumberOfPoints": 2,
    "AddressInfo": { "Title": "Private office", "Latitude": 3.2, "Longitude": 101.7 },
    "OperatorInfo": { "Title": "Gentari" },
    "UsageType": { "Title": "Private - Restricted Access" },
    "StatusType": { "IsOperational": true },
    "Connections": [ { "ConnectionType": { "Title": "Type 2 (Socket Only)" }, "PowerKW": 11, "Quantity": 2 } ] },
  { "ID": 106,
    "AddressInfo": { "Title": "No coordinates" },
    "OperatorInfo": { "Title": "Gentari" },
    "Connections": [] },
  { "ID": 107, "NumberOfPoints": 8,
    "AddressInfo": { "Title": "KLCC Supercharger", "Latitude": 3.1586, "Longitude": 101.714 },
    "OperatorInfo": { "Title": "Tesla (Tesla-only charging)" },
    "UsageType": { "Title": "Public" },
    "StatusType": { "IsOperational": true },
    "Connections": [ { "ConnectionType": { "Title": "Tesla Supercharger" }, "PowerKW": 250, "Quantity": 8 } ] },
  { "ID": 108, "NumberOfPoints": 2,
    "AddressInfo": { "Title": "Hotel destination", "Latitude": 3.16, "Longitude": 101.71 },
    "OperatorInfo": { "Title": "Tesla (Model S/X)" },
    "UsageType": { "Title": "Public - Notice Required" },
    "StatusType": { "IsOperational": true },
    "Connections": [ { "ConnectionType": { "Title": "Tesla (Model S/X)" }, "PowerKW": 11, "Quantity": 2 } ] }
]
```

- [ ] **Step 2: Write the failing tests**

Create `test/normalise.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normaliseOcm, normaliseAll } from '../engine/normalise.js';

const pois = JSON.parse(readFileSync(new URL('./fixtures/ocm-sample.json', import.meta.url), 'utf8'));
const byId = Object.fromEntries(normaliseAll(pois).map((c) => [c.id, c]));

test('private and coordinate-less stations are dropped; the rest are kept', () => {
  assert.deepEqual(Object.keys(byId).sort(), ['ocm-101', 'ocm-102', 'ocm-103', 'ocm-104', 'ocm-107', 'ocm-108']);
  assert.equal(normaliseOcm(null), null);
});

test('DC detection, max kW, connectors and bays', () => {
  const g = byId['ocm-101'];
  assert.equal(g.type, 'DC');
  assert.equal(g.kw, 60);
  assert.deepEqual(g.connectors, ['CCS2', 'Type2']);
  assert.equal(g.bays, 3);
  assert.equal(g.address, 'Jalan Test 1, Kuala Lumpur');
  assert.equal(byId['ocm-102'].type, 'AC');
  assert.equal(byId['ocm-102'].bays, 2); // sum of connector quantities
  assert.equal(byId['ocm-103'].bays, 1); // nothing known → 1
  assert.equal(byId['ocm-104'].connectors[0], 'CHAdeMO');
  assert.deepEqual(byId['ocm-107'].connectors, ['CCS2']); // Tesla at DC power
  assert.deepEqual(byId['ocm-108'].connectors, ['Type2']); // Tesla at AC power
});

test('prices come from the operator table, otherwise an estimated default', () => {
  assert.equal(byId['ocm-101'].price, 1.3);
  assert.equal(byId['ocm-101'].priceEstimated, false);
  assert.equal(byId['ocm-102'].price, 0.9);
  assert.equal(byId['ocm-103'].operator, 'Unknown operator');
  assert.equal(byId['ocm-103'].priceEstimated, true);
  assert.equal(byId['ocm-107'].price, 1.8);
  assert.equal(byId['ocm-108'].priceEstimated, true); // Tesla AC has no sourced rate
});

test('non-operational stations get low reliability; every charger is a public OCM site', () => {
  assert.equal(byId['ocm-104'].reliability, 0.5);
  assert.equal(byId['ocm-101'].reliability, 0.9);
  for (const c of Object.values(byId)) {
    assert.equal(c.siteType, 'public');
    assert.equal(c.source, 'ocm');
    assert.ok(c.kw > 0 && c.connectors.length > 0);
  }
});
```

- [ ] **Step 3: Run to see it fail**

Run: `node --test test/normalise.test.js`
Expected: FAIL, cannot find module `../engine/normalise.js`.

- [ ] **Step 4: Create `engine/normalise.js`**

```js
// Turn Open Charge Map stations into CasCas chargers.
import { priceFor } from '../data/operator-prices.js';

const DC_MIN_KW = 25;

function plugOf(conn) {
  const t = String(conn?.ConnectionType?.Title || '').toLowerCase();
  if (t.includes('chademo')) return 'CHAdeMO';
  if (t.includes('ccs')) return 'CCS2';
  if (t.includes('type 2') || t.includes('mennekes')) return 'Type2';
  if (t.includes('tesla')) return (conn.PowerKW || 0) >= DC_MIN_KW ? 'CCS2' : 'Type2';
  return null;
}

export function normaliseOcm(poi) {
  const a = poi?.AddressInfo;
  if (!a || typeof a.Latitude !== 'number' || typeof a.Longitude !== 'number') return null;
  if (/private/i.test(poi.UsageType?.Title || '')) return null;

  const conns = Array.isArray(poi.Connections) ? poi.Connections : [];
  const plugs = conns.map(plugOf);
  const isDc = plugs.some((p) => p === 'CCS2' || p === 'CHAdeMO') || conns.some((c) => (c.PowerKW || 0) >= DC_MIN_KW);
  const type = isDc ? 'DC' : 'AC';
  const maxKw = Math.max(0, ...conns.map((c) => c.PowerKW || 0));
  const connectors = [...new Set(plugs.filter(Boolean))];
  const quantity = conns.reduce((s, c) => s + (c.Quantity || 0), 0);
  const operator = poi.OperatorInfo?.Title || 'Unknown operator';

  return {
    id: `ocm-${poi.ID}`,
    name: a.Title || 'Charging station',
    address: [a.AddressLine1, a.Town].filter(Boolean).join(', '),
    operator,
    lat: a.Latitude,
    lng: a.Longitude,
    type,
    kw: maxKw || (isDc ? 50 : 7),
    connectors: connectors.length ? connectors : [isDc ? 'CCS2' : 'Type2'],
    bays: poi.NumberOfPoints || quantity || 1,
    ...priceFor(operator, type),
    reliability: poi.StatusType?.IsOperational === false ? 0.5 : 0.9,
    siteType: 'public',
    source: 'ocm',
  };
}

export function normaliseAll(pois) {
  return (Array.isArray(pois) ? pois : []).map(normaliseOcm).filter(Boolean);
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add engine/normalise.js test/normalise.test.js test/fixtures/ocm-sample.json
git commit -m "feat: convert Open Charge Map stations into CasCas chargers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Live loader with saved copy and demo fallback (`data/ocm.js`)

**Files:**
- Create: `data/ocm.js`
- Modify: `config.js`
- Test: `test/ocm.test.js`

- [ ] **Step 1: Add OCM settings to `config.js`**

Append to `config.js`:

```js
// Open Charge Map. Get a free key at https://openchargemap.org (My Profile → My Apps). Empty = skip the live fetch.
export const OCM = {
  key: '',
  radiusKm: 15,
  maxResults: 200,
  timeoutMs: 6000,
  cacheMaxAgeDays: 7,
};
```

- [ ] **Step 2: Write the failing tests**

Create `test/ocm.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadChargers, ocmUrl } from '../data/ocm.js';
import { CONDO_SITES } from '../data/chargers.js';
import { DEMO_CHARGERS } from '../data/chargers-demo.js';

const DAY = 864e5;
const fixture = JSON.parse(readFileSync(new URL('./fixtures/ocm-sample.json', import.meta.url), 'utf8'));
const memStore = () => {
  const m = {};
  return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; }, removeItem: (k) => { delete m[k]; }, m };
};
const okFetch = async () => ({ ok: true, json: async () => fixture });
const badFetch = async () => { throw new Error('offline'); };

test('the request asks for full operator and connector details', () => {
  const url = ocmUrl('abc');
  assert.ok(url.startsWith('https://api.openchargemap.io/v3/poi?'));
  assert.ok(url.includes('compact=false') && url.includes('key=abc') && url.includes('distance=15'));
});

test('live success: real chargers plus pilot condos, and a saved copy', async () => {
  const storage = memStore();
  const r = await loadChargers({ fetchFn: okFetch, storage, now: 0, key: 'k' });
  assert.equal(r.source, 'live');
  assert.equal(r.chargers.length, CONDO_SITES.length + 6);
  assert.ok(storage.m['cascas.ocm.v1']);
});

test('network failure uses a fresh saved copy', async () => {
  const storage = memStore();
  await loadChargers({ fetchFn: okFetch, storage, now: 0, key: 'k' });
  const r = await loadChargers({ fetchFn: badFetch, storage, now: 2 * DAY, key: 'k' });
  assert.equal(r.source, 'saved');
  assert.equal(r.ageDays, 2);
  assert.equal(r.chargers.length, CONDO_SITES.length + 6);
});

test('a saved copy older than 7 days falls back to demo data', async () => {
  const storage = memStore();
  await loadChargers({ fetchFn: okFetch, storage, now: 0, key: 'k' });
  const r = await loadChargers({ fetchFn: badFetch, storage, now: 8 * DAY, key: 'k' });
  assert.equal(r.source, 'demo');
  assert.equal(r.chargers.length, CONDO_SITES.length + DEMO_CHARGERS.length);
});

test('no key skips the network; an empty or bad response is not saved', async () => {
  let called = false;
  const spy = async () => { called = true; return okFetch(); };
  const storage = memStore();
  const r = await loadChargers({ fetchFn: spy, storage, now: 0, key: '' });
  assert.equal(called, false);
  assert.equal(r.source, 'demo');
  const empty = await loadChargers({ fetchFn: async () => ({ ok: true, json: async () => [] }), storage, now: 0, key: 'k' });
  assert.equal(empty.source, 'demo');
  const notOk = await loadChargers({ fetchFn: async () => ({ ok: false }), storage, now: 0, key: 'k' });
  assert.equal(notOk.source, 'demo');
  assert.equal(storage.m['cascas.ocm.v1'], undefined);
});

test('storage that throws never breaks loading', async () => {
  const storage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const r = await loadChargers({ fetchFn: okFetch, storage, now: 0, key: 'k' });
  assert.equal(r.source, 'live');
});
```

- [ ] **Step 3: Run to see it fail**

Run: `node --test test/ocm.test.js`
Expected: FAIL, cannot find module `../data/ocm.js`.

- [ ] **Step 4: Create `data/ocm.js`**

```js
// Load public chargers: live from Open Charge Map, else a saved copy (< 7 days), else the demo list.
import { OCM } from '../config.js';
import { START } from './places.js';
import { CONDO_SITES } from './chargers.js';
import { DEMO_CHARGERS } from './chargers-demo.js';
import { normaliseAll } from '../engine/normalise.js';

const CACHE_KEY = 'cascas.ocm.v1';
const DAY_MS = 864e5;

export function ocmUrl(key, centre = START) {
  const q = new URLSearchParams({
    output: 'json', latitude: centre.lat, longitude: centre.lng,
    distance: OCM.radiusKm, distanceunit: 'KM', maxresults: OCM.maxResults,
    compact: 'false', verbose: 'false', key,
  });
  return `https://api.openchargemap.io/v3/poi?${q}`;
}

function browserStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

async function fetchLive(fetchFn, key) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), OCM.timeoutMs) : null;
  try {
    const res = await fetchFn(ocmUrl(key), ctrl ? { signal: ctrl.signal } : {});
    if (!res || !res.ok) return null;
    const list = normaliseAll(await res.json());
    return list.length ? list : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readCache(storage) {
  try {
    const raw = storage?.getItem(CACHE_KEY);
    const c = raw ? JSON.parse(raw) : null;
    return c && Array.isArray(c.chargers) && typeof c.savedAt === 'number' ? c : null;
  } catch {
    return null;
  }
}

function writeCache(storage, cache) {
  try { storage?.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* memory only */ }
}

export async function loadChargers({
  fetchFn = globalThis.fetch, storage = browserStorage(), now = Date.now(), key = OCM.key,
} = {}) {
  if (key && fetchFn) {
    const live = await fetchLive(fetchFn, key);
    if (live) {
      writeCache(storage, { savedAt: now, chargers: live });
      return { chargers: [...CONDO_SITES, ...live], source: 'live', ageDays: 0 };
    }
  }
  const cache = readCache(storage);
  if (cache) {
    const age = (now - cache.savedAt) / DAY_MS;
    if (age >= 0 && age < OCM.cacheMaxAgeDays) {
      return { chargers: [...CONDO_SITES, ...cache.chargers], source: 'saved', ageDays: Math.floor(age) };
    }
  }
  return { chargers: [...CONDO_SITES, ...DEMO_CHARGERS], source: 'demo', ageDays: 0 };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add config.js data/ocm.js test/ocm.test.js
git commit -m "feat: load chargers live from Open Charge Map with saved and demo fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Use the loaded chargers in the app

**Files:**
- Modify: `app.js`, `index.html`, `views/driver.js`, `styles.css`

- [ ] **Step 1: Replace `app.js`**

Replace the whole file with:

```js
import { APP } from './config.js';
import { CLOCK_PRESETS } from './data/places.js';
import { CONDOS } from './data/condos.js';
import { loadChargers } from './data/ocm.js';
import { loadState, saveState, resetState } from './state.js';
import { buildWorld } from './engine/world.js';
import { renderDriver, resetDriver } from './views/driver.js';
import { renderJmb } from './views/jmb.js';

const VIEWS = { driver: renderDriver, jmb: renderJmb };
let state = loadState();
let clock = CLOCK_PRESETS[0].date();
let chargers = null; // set once loadChargers() finishes

function currentRole() {
  const id = location.hash.slice(1);
  return VIEWS[id] ? id : 'driver';
}

function render() {
  const role = currentRole();
  document.querySelectorAll('[data-role]').forEach((a) => {
    if (a.dataset.role === role) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const view = document.getElementById('view');
  if (!chargers) { view.innerHTML = '<p class="loading">Loading chargers…</p>'; return; }
  const ctx = { state, clock, world: buildWorld(state, CONDOS, chargers), save: () => saveState(state), rerender: render };
  VIEWS[role](view, ctx);
}

function showSource({ source, ageDays }) {
  const el = document.getElementById('data-source');
  const credit = ' · Data © <a href="https://openchargemap.org" target="_blank" rel="noopener">Open Charge Map</a> contributors';
  if (source === 'live') el.innerHTML = `Chargers: live from Open Charge Map${credit}`;
  else if (source === 'saved') el.innerHTML = `Chargers: saved copy, ${ageDays} day${ageDays === 1 ? '' : 's'} old${credit}`;
  else el.textContent = 'Chargers: demo data';
}

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initChrome() {
  document.title = `${APP.name} · ${APP.township}`;
  document.querySelectorAll('[data-app-name]').forEach((el) => { el.textContent = APP.name; });
  document.querySelector('[data-tagline]').textContent = APP.tagline;

  const preset = document.getElementById('clock-preset');
  const custom = document.getElementById('clock-custom');
  preset.innerHTML = CLOCK_PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')
    + '<option value="custom">Pick a time…</option>';
  preset.addEventListener('change', () => {
    if (preset.value === 'custom') { custom.hidden = false; custom.value = toLocalInput(clock); custom.focus(); return; }
    custom.hidden = true;
    clock = CLOCK_PRESETS.find((p) => p.id === preset.value).date();
    render();
  });
  custom.addEventListener('change', () => {
    const d = new Date(custom.value);
    if (!Number.isNaN(d.getTime())) { clock = d; render(); }
  });
  document.getElementById('reset').addEventListener('click', () => {
    state = resetState();
    resetDriver();
    render();
  });
  window.addEventListener('hashchange', render);
}

initChrome();
render();
loadChargers().then((r) => {
  chargers = r.chargers;
  showSource(r);
  render();
});
```

- [ ] **Step 2: Add the source line and update the footer in `index.html`**

After the closing `</nav>` line, add:

```html
    <p id="data-source" class="source" aria-live="polite">Chargers: loading…</p>
```

Change the footer `<span>` text to:

```html
    <span>Prototype for the Sime Darby Property University Hackathon 2026. Condo bays, occupancy and history are simulated; condo names are fictional.</span>
```

- [ ] **Step 3: Show "est." prices and the pilot label in `views/driver.js`**

In `pickHtml`, change the price line inside each card from:

```js
        <p class="muted">${esc(c.charger.operator)} · ${c.charger.type} ${c.charger.kw} kW · ${rm(c.price)}/kWh</p></div></div>
```

to:

```js
        <p class="muted">${esc(c.charger.operator)} · ${c.charger.type} ${c.charger.kw} kW · ${rm(c.price)}/kWh${c.charger.priceEstimated ? ' (est.)' : ''}</p></div></div>
```

In `drawMarkers`, change the `tip` line to:

```js
    const tip = `${esc(ch.name)}<br>${esc(ch.operator)} · ${ch.type} ${ch.kw} kW · ${Math.round(occ * 100)}% busy (est.)${ch.pilot ? '<br>Pilot condo (simulated)' : ''}${off.has(ch.id) ? `<br>${esc(off.get(ch.id))}` : ''}`;
```

- [ ] **Step 4: Add styles to `styles.css`**

Append:

```css
.source { margin: 0; font-size: 0.78rem; color: var(--muted); }
.source a { color: inherit; }
.loading { padding: 32px 16px; color: var(--muted); }
```

- [ ] **Step 5: Check in the browser**

Run: `npm test`
Expected: all pass.

Start a local server: `python -m http.server 8765` (in the background) and open `http://localhost:8765/#driver`.
Expected: "Loading chargers…" briefly, then the map and picks as before; header line reads "Chargers: demo data" (no key yet); no console errors. Open `http://localhost:8765/#sdp`: the Driver view opens. Only two tabs are shown.

- [ ] **Step 6: Commit**

```bash
git add app.js index.html views/driver.js styles.css
git commit -m "feat: run the app on loaded chargers and show the data source

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: New state fields (`state.js`)

**Files:**
- Modify: `state.js`, `test/state-world.test.js`

- [ ] **Step 1: Update and add tests**

In `test/state-world.test.js`, change the import line to:

```js
import { loadState, saveState, resetState, addSession, anonNumber, MAX_SESSIONS } from '../state.js';
```

Add near the top, after `afterEach(...)`:

```js
const BLANK = { checkins: {}, booking: null, sharing: {}, sessions: [], visitorPasses: [], anonNo: null };
```

Replace the two `assert.deepEqual(..., { checkins: {}, booking: null, sharing: {} })` expectations with `BLANK`:

```js
  assert.deepEqual(s, BLANK);
```

```js
  assert.deepEqual(resetState(), BLANK);
```

Append these tests:

```js
test('sessions and visitor passes survive a reload; bad entries are dropped', () => {
  const raw = JSON.stringify({ sessions: [{ at: 1 }, 'x', null, { at: 2 }], visitorPasses: [{ id: 'p1' }, 7], anonNo: 12 });
  setStorage({ getItem: () => raw, setItem() {}, removeItem() {} });
  resetState();
  const s = loadState();
  assert.deepEqual(s.sessions, [{ at: 1 }, { at: 2 }]);
  assert.deepEqual(s.visitorPasses, [{ id: 'p1' }]);
  assert.equal(s.anonNo, 12);
});

test('addSession keeps only the latest MAX_SESSIONS records', () => {
  const s = resetState();
  for (let i = 0; i < MAX_SESSIONS + 10; i++) addSession(s, { at: i });
  assert.equal(s.sessions.length, MAX_SESSIONS);
  assert.equal(s.sessions[0].at, 10);
  assert.equal(s.sessions.at(-1).at, MAX_SESSIONS + 9);
});

test('anonNumber is picked once per device and then stays the same', () => {
  const s = resetState();
  const n = anonNumber(s, () => 0.5);
  assert.equal(n, 50);
  assert.equal(anonNumber(s, () => 0.1), 50);
});
```

- [ ] **Step 2: Run to see failures**

Run: `node --test test/state-world.test.js`
Expected: FAIL (blank state shape differs; `addSession` not exported).

- [ ] **Step 3: Update `state.js`**

Replace the `blank` line with:

```js
export const MAX_SESSIONS = 500;
const blank = () => ({ checkins: {}, booking: null, sharing: {}, sessions: [], visitorPasses: [], anonNo: null });
```

In `clean`, before `return s;`, add:

```js
  if (Array.isArray(parsed.sessions)) s.sessions = parsed.sessions.filter(isObject).slice(-MAX_SESSIONS);
  if (Array.isArray(parsed.visitorPasses)) s.visitorPasses = parsed.visitorPasses.filter(isObject);
  if (Number.isInteger(parsed.anonNo)) s.anonNo = parsed.anonNo;
```

At the end of the file, add:

```js
export function addSession(state, record) {
  state.sessions = [...state.sessions, record].slice(-MAX_SESSIONS);
}

// A random 1–99 number for this device, used in anonymous IDs such as "Visitor #48".
export function anonNumber(state, rand = Math.random) {
  if (!Number.isInteger(state.anonNo)) state.anonNo = 1 + Math.floor(rand() * 99);
  return state.anonNo;
}
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add state.js test/state-world.test.js
git commit -m "feat: keep sessions, visitor passes and an anonymous device number in state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Session record and analytics (`engine/insights.js`)

**Files:**
- Create: `engine/insights.js`
- Test: `test/insights.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/insights.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSession, followRate, savings, weeklyTrend, byMode, byRole, filterSessions, toCsv, anonLabel, CHOICE_LABEL,
} from '../engine/insights.js';

const res = (id, km, cost, timeMin, extra = {}) => ({ charger: { id }, km, cost, timeMin, kWh: 20, condo: null, isResident: false, ...extra });
const ranking = { mode: 'saver', results: [res('a', 3, 18, 20), res('b', 1, 24, 15), res('c', 5, 19, 25), res('d', 0.5, 26, 12)] };

test('buildSession compares the choice with the nearest charger', () => {
  const s = buildSession({ ranking, chosenId: 'a', at: 1000, anonNo: 12, resident: false });
  assert.deepEqual(s, {
    at: 1000, anonId: 'V12', role: 'visitor', mode: 'saver', chargerId: 'a', condoId: null,
    topPickId: 'a', nearestId: 'd', choice: 'pick1', kWh: 20, costRm: 18, nearestCostRm: 26, minutesVsNearest: 8,
  });
  assert.equal(buildSession({ ranking, chosenId: 'c', at: 1, anonNo: 3, resident: true }).choice, 'pick3');
  assert.equal(buildSession({ ranking, chosenId: 'c', at: 1, anonNo: 3, resident: true }).anonId, 'R3');
  assert.equal(buildSession({ ranking, chosenId: 'd', at: 1, anonNo: 3, resident: false }).choice, 'own');
});

test('a booking at a condo bay records the condo, never a plate', () => {
  const r = { mode: 'balanced', results: [res('cs-lumina', 1, 10, 10, { condo: { id: 'lumina' } })] };
  const s = buildSession({ ranking: r, chosenId: 'cs-lumina', at: 1, anonNo: 5, resident: false });
  assert.equal(s.condoId, 'lumina');
  assert.ok(!('plate' in s));
});

const S = (at, choice, extra = {}) => ({ at, choice, mode: 'balanced', role: 'resident', condoId: 'lumina', costRm: 10, nearestCostRm: 12, minutesVsNearest: 2, kWh: 20, anonId: 'R1', ...extra });

test('follow rate and savings', () => {
  const list = [S(1, 'pick1'), S(2, 'pick2'), S(3, 'own', { nearestCostRm: 10, minutesVsNearest: 0 }), S(4, 'pick3')];
  assert.equal(followRate(list), 0.75);
  assert.equal(followRate([]), 0);
  assert.deepEqual(savings(list), { avgRm: 1.5, totalRm: 6, avgMinutes: 2 });
  assert.deepEqual(savings([]), { avgRm: 0, totalRm: 0, avgMinutes: 0 });
});

test('weekly trend buckets by Monday, across a month boundary', () => {
  const end = new Date(2026, 10, 4, 12).getTime(); // Wed 4 Nov 2026
  const list = [
    S(new Date(2026, 9, 31, 10).getTime(), 'own'),   // Sat 31 Oct → week of Mon 26 Oct
    S(new Date(2026, 10, 1, 22).getTime(), 'pick1'), // Sun 1 Nov → week of Mon 26 Oct
    S(new Date(2026, 10, 2, 0, 30).getTime(), 'pick2'), // Mon 2 Nov → week of Mon 2 Nov
  ];
  const t = weeklyTrend(list, end, 2);
  assert.equal(t.length, 2);
  assert.equal(t[0].weekStart, new Date(2026, 9, 26).getTime());
  assert.equal(t[0].count, 2);
  assert.equal(t[0].followRate, 0.5);
  assert.equal(t[1].weekStart, new Date(2026, 10, 2).getTime());
  assert.equal(t[1].count, 1);
  assert.equal(t[1].followRate, 1);
});

test('breakdowns by mode and role', () => {
  const list = [S(1, 'pick1', { mode: 'urgent' }), S(2, 'own', { mode: 'urgent' }), S(3, 'pick1', { mode: 'saver', role: 'visitor' })];
  assert.deepEqual(byMode(list), [
    { key: 'urgent', count: 2, followRate: 0.5 },
    { key: 'balanced', count: 0, followRate: 0 },
    { key: 'saver', count: 1, followRate: 1 },
  ]);
  assert.deepEqual(byRole(list).map((g) => g.count), [2, 1]);
});

test('filters by condo, role and date range', () => {
  const list = [S(10, 'pick1'), S(20, 'own', { role: 'visitor' }), S(30, 'pick1', { condoId: 'serini' })];
  assert.equal(filterSessions(list, { condoId: 'lumina' }).length, 2);
  assert.equal(filterSessions(list, { role: 'visitor' }).length, 1);
  assert.equal(filterSessions(list, { role: 'all' }).length, 3);
  assert.deepEqual(filterSessions(list, { from: 15, to: 30 }).map((s) => s.at), [20]);
});

test('CSV export has a header, one row per session and no plates', () => {
  const csv = toCsv([S(Date.UTC(2026, 9, 21, 3), 'pick1', { chargerId: 'cs-lumina' })]);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'time,anonymous_id,role,mode,charger,kwh,cost_rm,choice,saved_vs_nearest_rm,minutes_vs_nearest');
  assert.equal(lines.length, 2);
  assert.ok(lines[1].startsWith('2026-10-21T03:00:00.000Z,R1,resident,balanced,cs-lumina,20.0,10.00,Top pick,2.00,2'));
});

test('labels', () => {
  assert.equal(anonLabel('R12'), 'Resident #12');
  assert.equal(anonLabel('V48'), 'Visitor #48');
  assert.equal(CHOICE_LABEL.own, 'Own choice');
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test test/insights.test.js`
Expected: FAIL, cannot find module `../engine/insights.js`.

- [ ] **Step 3: Create `engine/insights.js`**

```js
// Did drivers follow CasCas's recommendation, and what did it save them vs the nearest charger?
import { round2 } from './pricing.js';

export const CHOICE_LABEL = { pick1: 'Top pick', pick2: '2nd pick', pick3: '3rd pick', own: 'Own choice' };

export function anonLabel(anonId) {
  return `${anonId.startsWith('R') ? 'Resident' : 'Visitor'} #${anonId.slice(1)}`;
}

// One record per booking. `ranking` is rankChargers() output; `resident` = the driver lives in a condo here.
export function buildSession({ ranking, chosenId, at, anonNo, resident }) {
  const results = ranking.results;
  const idx = results.findIndex((c) => c.charger.id === chosenId);
  const chosen = results[idx];
  const nearest = results.reduce((a, b) => (b.km < a.km ? b : a));
  return {
    at,
    anonId: `${resident ? 'R' : 'V'}${anonNo}`,
    role: resident ? 'resident' : 'visitor',
    mode: ranking.mode,
    chargerId: chosen.charger.id,
    condoId: chosen.condo ? chosen.condo.id : null,
    topPickId: results[0].charger.id,
    nearestId: nearest.charger.id,
    choice: idx >= 0 && idx < 3 ? `pick${idx + 1}` : 'own',
    kWh: round2(chosen.kWh),
    costRm: round2(chosen.cost),
    nearestCostRm: round2(nearest.cost),
    minutesVsNearest: Math.round(chosen.timeMin - nearest.timeMin),
  };
}

export const followed = (s) => s.choice !== 'own';

export function followRate(sessions) {
  return sessions.length ? sessions.filter(followed).length / sessions.length : 0;
}

export function savings(sessions) {
  if (!sessions.length) return { avgRm: 0, totalRm: 0, avgMinutes: 0 };
  const total = sessions.reduce((s, x) => s + (x.nearestCostRm - x.costRm), 0);
  const minutes = sessions.reduce((s, x) => s + x.minutesVsNearest, 0);
  return { avgRm: round2(total / sessions.length), totalRm: round2(total), avgMinutes: Math.round(minutes / sessions.length) };
}

// Local midnight on the Monday of the week containing `ms`.
export function startOfWeek(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function weeklyTrend(sessions, endMs, weeks = 12) {
  const last = new Date(startOfWeek(endMs));
  return Array.from({ length: weeks }, (_, i) => {
    const start = new Date(last);
    start.setDate(start.getDate() - 7 * (weeks - 1 - i));
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const inWeek = sessions.filter((s) => s.at >= start.getTime() && s.at < end.getTime());
    return { weekStart: start.getTime(), followRate: followRate(inWeek), count: inWeek.length };
  });
}

function groupBy(sessions, key, keys) {
  return keys.map((k) => {
    const g = sessions.filter((s) => s[key] === k);
    return { key: k, count: g.length, followRate: followRate(g) };
  });
}

export const byMode = (sessions) => groupBy(sessions, 'mode', ['urgent', 'balanced', 'saver']);
export const byRole = (sessions) => groupBy(sessions, 'role', ['resident', 'visitor']);

// `to` is exclusive. A missing or null filter matches everything.
export function filterSessions(sessions, { condoId = null, role = null, from = null, to = null } = {}) {
  return sessions.filter((s) => (condoId == null || s.condoId === condoId)
    && (!role || role === 'all' || s.role === role)
    && (from == null || s.at >= from)
    && (to == null || s.at < to));
}

const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export function toCsv(sessions) {
  const head = 'time,anonymous_id,role,mode,charger,kwh,cost_rm,choice,saved_vs_nearest_rm,minutes_vs_nearest';
  const rows = sessions.map((s) => [
    new Date(s.at).toISOString(), s.anonId, s.role, s.mode, s.chargerId ?? '', s.kWh.toFixed(1), s.costRm.toFixed(2),
    CHOICE_LABEL[s.choice], (s.nearestCostRm - s.costRm).toFixed(2), s.minutesVsNearest,
  ].map(cell).join(','));
  return `${[head, ...rows].join('\n')}\n`;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add engine/insights.js test/insights.test.js
git commit -m "feat: session records and recommendation-follow analytics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Simulated session history (`engine/history.js`)

**Files:**
- Create: `engine/history.js`
- Test: `test/history.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/history.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateHistory, mulberry32 } from '../engine/history.js';
import { followRate, filterSessions, CHOICE_LABEL } from '../engine/insights.js';
import { CONDOS } from '../data/condos.js';
import { CHARGERS } from '../data/chargers.js';

const DAY = 864e5;
const lumina = CONDOS.find((c) => c.id === 'lumina');
const kenanga = CONDOS.find((c) => c.id === 'kenanga'); // sharing off
const site = (c) => CHARGERS.find((ch) => ch.condoId === c.id);
const end = new Date(2026, 9, 21, 11).getTime();

test('the PRNG is repeatable', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('same condo and end time → identical history', () => {
  assert.deepEqual(simulateHistory(lumina, site(lumina), end), simulateHistory(lumina, site(lumina), end));
});

test('history covers the 182 days before today, sorted, with valid records', () => {
  const h = simulateHistory(lumina, site(lumina), end);
  const today = new Date(end); today.setHours(0, 0, 0, 0);
  assert.ok(h.length >= 182 * 2); // at least 2 sessions a day
  for (let i = 0; i < h.length; i++) {
    const s = h[i];
    assert.ok(s.at >= today.getTime() - 182 * DAY && s.at < today.getTime(), new Date(s.at).toString());
    if (i) assert.ok(s.at >= h[i - 1].at);
    assert.ok(s.choice in CHOICE_LABEL);
    assert.ok(['urgent', 'balanced', 'saver'].includes(s.mode));
    assert.equal(s.condoId, 'lumina');
    assert.equal(s.simulated, true);
    assert.ok(s.kWh > 0 && s.costRm > 0);
    assert.ok(!('plate' in s));
  }
  assert.ok(h.some((s) => s.role === 'visitor') && h.some((s) => s.role === 'resident'));
});

test('a condo that does not share has no visitor sessions', () => {
  assert.ok(simulateHistory(kenanga, site(kenanga), end).every((s) => s.role === 'resident'));
});

test('follow rate rises over the six months', () => {
  const h = simulateHistory(lumina, site(lumina), end);
  const first = filterSessions(h, { to: h[0].at + 28 * DAY });
  const last = filterSessions(h, { from: end - 29 * DAY });
  assert.ok(followRate(last) > followRate(first), `${followRate(first)} → ${followRate(last)}`);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test test/history.test.js`
Expected: FAIL, cannot find module `../engine/history.js`.

- [ ] **Step 3: Create `engine/history.js`**

```js
// Six months of simulated sessions for one condo bay, so the JMB dashboard has history on day one.
// Seeded, so the same inputs always give the same output.
import { round2 } from './pricing.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedOf(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const MODE_SPLIT = [['urgent', 0.15], ['balanced', 0.5], ['saver', 0.35]];
// Following a pick: what it saves (RM) and costs in time (min) vs the nearest charger, by mode.
const EFFECT = { urgent: { rm: [-1, 1], min: [-3, 0] }, balanced: { rm: [0.5, 3], min: [0, 4] }, saver: { rm: [1, 6], min: [2, 8] } };

const between = (r, [lo, hi]) => lo + r * (hi - lo);
function weighted(r, list) {
  let x = r;
  for (const [k, w] of list) { x -= w; if (x < 0) return k; }
  return list.at(-1)[0];
}

export function simulateHistory(condo, charger, endMs, { seed = seedOf(condo.id), days = 182 } = {}) {
  const rand = mulberry32(seed);
  const today = new Date(endMs);
  today.setHours(0, 0, 0, 0);
  const shares = !!condo.sharing?.enabled;
  const residentIds = Math.max(5, Math.round(condo.units * 0.1));
  const out = [];

  for (let d = days; d >= 1; d--) {
    const day = new Date(today);
    day.setDate(day.getDate() - d);
    const followP = 0.55 + 0.2 * ((days - d) / days); // drivers trust the picks more over time
    const n = 2 + Math.floor(rand() * Math.max(2, condo.bays * 0.6));
    for (let i = 0; i < n; i++) {
      const visitor = shares && rand() < 0.3;
      const hour = visitor
        ? Math.floor(between(rand(), [condo.sharing.start, condo.sharing.end]))
        : (rand() < 0.7 ? 18 + Math.floor(rand() * 5) : Math.floor(rand() * 24));
      const at = new Date(day);
      at.setHours(Math.min(23, hour), Math.floor(rand() * 60));
      const mode = weighted(rand(), MODE_SPLIT);
      const follow = rand() < followP;
      const r = rand();
      const choice = follow ? (r < 0.6 ? 'pick1' : r < 0.85 ? 'pick2' : 'pick3') : 'own';
      const kWh = round2(between(rand(), [8, 35]));
      const costRm = round2(kWh * (visitor ? condo.sharing.visitorPrice : condo.residentPrice));
      const saved = follow ? round2(between(rand(), EFFECT[mode].rm)) : 0;
      const minutes = follow ? Math.round(between(rand(), EFFECT[mode].min)) : 0;
      const idNo = 1 + Math.floor(rand() * (visitor ? 60 : residentIds));
      out.push({
        at: at.getTime(), anonId: `${visitor ? 'V' : 'R'}${idNo}`, role: visitor ? 'visitor' : 'resident',
        mode, chargerId: charger.id, condoId: condo.id, topPickId: null, nearestId: null,
        choice, kWh, costRm, nearestCostRm: round2(costRm + saved), minutesVsNearest: minutes, simulated: true,
      });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all pass. If "follow rate rises" fails for this seed, check the sign of `followP`, not the test.

- [ ] **Step 5: Commit**

```bash
git add engine/history.js test/history.test.js
git commit -m "feat: seeded six-month session history for the JMB dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Visitor access by plate (`engine/access.js`)

**Files:**
- Create: `engine/access.js`
- Test: `test/access.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/access.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalisePlate, isValidPlate, formatPlate, canAutoApprove, createPass, upcomingPasses, purgePasses,
} from '../engine/access.js';
import { CONDOS } from '../data/condos.js';

const DAY = 864e5;
const lumina = CONDOS.find((c) => c.id === 'lumina'); // shares weekdays 9–17

test('plates are tidied and checked loosely', () => {
  assert.equal(normalisePlate(' wxy-1234 '), 'WXY1234');
  assert.equal(normalisePlate('vep 88'), 'VEP88');
  for (const ok of ['WXY1234', 'VEP88', 'W1234A', 'PKN1']) assert.ok(isValidPlate(ok), ok);
  for (const bad of ['1234', 'ABC', 'A', 'ABCDEFGHIJ1', 'WXY 1234', '']) assert.ok(!isValidPlate(bad), bad);
});

test('plates are shown with spaces', () => {
  assert.equal(formatPlate('WXY1234'), 'WXY 1234');
  assert.equal(formatPlate('VEP88'), 'VEP 88');
  assert.equal(formatPlate('W1234A'), 'W 1234 A');
  assert.equal(formatPlate('A1B2'), 'A1B2'); // unusual shape left as typed
});

test('auto-approve only while the condo is sharing', () => {
  assert.equal(canAutoApprove(lumina, new Date(2026, 9, 21, 11)), true);  // Wed 11 AM
  assert.equal(canAutoApprove(lumina, new Date(2026, 9, 21, 20)), false); // Wed 8 PM
  assert.equal(canAutoApprove(lumina, new Date(2026, 9, 24, 11)), false); // Saturday
  assert.equal(canAutoApprove({ ...lumina, sharing: { ...lumina.sharing, enabled: false } }, new Date(2026, 9, 21, 11)), false);
  assert.equal(canAutoApprove(null, new Date()), false);
});

test('a pass covers the charge, rounded up to 30 minutes, at least an hour', () => {
  const start = new Date(2026, 9, 21, 11).getTime();
  const a = createPass({ id: 'p1', condoId: 'lumina', chargerId: 'cs-lumina', plate: 'WXY1234', slotStart: start, minutes: 45, now: start });
  assert.equal(a.slotEnd - a.slotStart, 60 * 60000);
  const b = createPass({ id: 'p2', condoId: 'lumina', chargerId: 'cs-lumina', plate: 'WXY1234', slotStart: start, minutes: 75, now: start });
  assert.equal(b.slotEnd - b.slotStart, 90 * 60000);
  assert.deepEqual(Object.keys(a).sort(), ['chargerId', 'condoId', 'createdAt', 'id', 'plate', 'slotEnd', 'slotStart']);
});

test('expected visitors: this condo, not finished, earliest first', () => {
  const now = 1000 * 60000;
  const p = (id, condoId, slotStart, slotEnd) => ({ id, condoId, slotStart, slotEnd });
  const list = [p('late', 'lumina', now + 120 * 60000, now + 180 * 60000), p('done', 'lumina', now - 120 * 60000, now - 60000),
    p('other', 'serini', now, now + 60000), p('soon', 'lumina', now - 10 * 60000, now + 50 * 60000)];
  assert.deepEqual(upcomingPasses(list, 'lumina', now).map((x) => x.id), ['soon', 'late']);
});

test('passes are deleted 30 days after the slot ends', () => {
  const now = 100 * DAY;
  const list = [{ id: 'old', slotEnd: now - 31 * DAY }, { id: 'recent', slotEnd: now - 29 * DAY }];
  assert.deepEqual(purgePasses(list, now).map((x) => x.id), ['recent']);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test test/access.test.js`
Expected: FAIL, cannot find module `../engine/access.js`.

- [ ] **Step 3: Create `engine/access.js`**

```js
// Visitor access to shared condo bays. Approval is automatic while the condo is sharing.
import { isOpenToVisitors } from './sharing.js';

export const PASS_KEEP_DAYS = 30;

export function normalisePlate(raw) {
  return String(raw ?? '').toUpperCase().replace(/[\s-]+/g, '');
}

// Loose check: 2–10 letters and digits with at least one of each (e.g. WXY1234, VEP88).
export function isValidPlate(p) {
  return /^[A-Z0-9]{2,10}$/.test(p) && /[A-Z]/.test(p) && /\d/.test(p);
}

export function formatPlate(p) {
  const m = /^([A-Z]+)(\d+)([A-Z]*)$/.exec(p);
  return m ? [m[1], m[2], m[3]].filter(Boolean).join(' ') : p;
}

export function canAutoApprove(condo, date) {
  return !!condo && isOpenToVisitors(condo, date);
}

export function createPass({ id, condoId, chargerId, plate, slotStart, minutes, now }) {
  const length = Math.max(60, Math.ceil(minutes / 30) * 30);
  return { id, condoId, chargerId, plate, slotStart, slotEnd: slotStart + length * 60000, createdAt: now };
}

export function upcomingPasses(passes, condoId, nowMs) {
  return passes.filter((p) => p.condoId === condoId && p.slotEnd > nowMs).sort((a, b) => a.slotStart - b.slotStart);
}

export function purgePasses(passes, nowMs) {
  return passes.filter((p) => nowMs - p.slotEnd < PASS_KEEP_DAYS * 864e5);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Purge old passes on app start**

In `app.js`, add the import:

```js
import { purgePasses } from './engine/access.js';
```

and directly after `let state = loadState();` add:

```js
state.visitorPasses = purgePasses(state.visitorPasses, Date.now());
saveState(state);
```

- [ ] **Step 6: Commit**

```bash
git add engine/access.js test/access.test.js app.js
git commit -m "feat: visitor plate passes with auto-approve while sharing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Driver view — more chargers, plate step, session record, saving line

**Files:**
- Modify: `views/driver.js`, `views/format.js`, `styles.css`

- [ ] **Step 1: Add format helpers**

Append to `views/format.js`:

```js
export const fmtDay = (d) => d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
export const fmtClock = (d) => d.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' });
```

Append to the `format helpers` test in `test/state-world.test.js` (and add `fmtDay` to its import from `../views/format.js`):

```js
  assert.equal(fmtDay(new Date(2026, 9, 21)), new Date(2026, 9, 21).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }));
```

Run: `npm test` — Expected: all pass.

- [ ] **Step 2: Update imports and the driver's UI state in `views/driver.js`**

Replace the import block at the top with:

```js
import { CONST } from '../config.js';
import { CARS } from '../data/cars.js';
import { PLACES, START } from '../data/places.js';
import { rankChargers, MODES, formatDuration } from '../engine/score.js';
import { priceAt } from '../engine/pricing.js';
import { isOpenToVisitors } from '../engine/sharing.js';
import { occupancyAt } from '../engine/occupancy.js';
import { buildSession } from '../engine/insights.js';
import { normalisePlate, isValidPlate, formatPlate, canAutoApprove, createPass } from '../engine/access.js';
import { addSession, anonNumber } from '../state.js';
import { esc, rm, fmtTime, fmtClock } from './format.js';
```

Replace the `fresh` line with:

```js
const fresh = () => ({ carId: 'emas7', battery: 35, placeId: 'klem', homeId: '', needBy: 'now', stage: 'pick', pick: null, flash: '', pending: null, plate: '' });
```

- [ ] **Step 3: Pass the ranking to `stageHtml`**

In `update`, change:

```js
  box.innerHTML = ui.stage === 'pick' ? pickHtml(ranking, ctx) : stageHtml(ctx);
```

to:

```js
  box.innerHTML = ui.stage === 'pick' ? pickHtml(ranking, ctx) : stageHtml(ctx, ranking);
```

- [ ] **Step 4: List the other chargers so drivers can make their own choice**

In `pickHtml`, replace the final line `return head + note + cards + off;` with:

```js
  const rest = r.results.slice(3);
  const more = rest.length
    ? `<details class="more"><summary>Choose another charger (${rest.length})</summary><ul>${rest.map((c) => `<li><span>${esc(c.charger.name)} · ${rm(c.price)}/kWh · ${c.km.toFixed(1)} km</span> <button class="btn small" type="button" data-book="${c.charger.id}">Book</button></li>`).join('')}</ul></details>`
    : '';
  return head + note + cards + more + off;
```

- [ ] **Step 5: Replace `stageHtml` with the plate step and the saving line**

Replace the whole `stageHtml` function with:

```js
function stageHtml(ctx, r) {
  const p = ui.pick;
  if (ui.stage === 'plate') {
    const c = r.results.find((x) => x.charger.id === ui.pending);
    return `<h2>Visitor details</h2>
      <p><b>${esc(c ? c.charger.name : 'This bay')}</b> is a shared condo bay. The condo's management lets visitors in by number plate.</p>
      <form id="d-plate-form" class="form" novalidate>
        <label class="field">Number plate <input id="d-plate" type="text" autocomplete="off" autocapitalize="characters" maxlength="12" placeholder="e.g. WXY 1234" value="${esc(ui.plate)}"></label>
        <label class="check"><input type="checkbox" id="d-consent"> My plate is shared with the condo management only to let me in.</label>
        <p id="d-plate-err" class="error" role="alert" hidden></p>
        <div class="btn-row"><button class="btn primary" type="submit">Confirm booking</button>
        <button class="btn" type="button" data-act="back">Back</button></div>
      </form>`;
  }
  if (ui.stage === 'booked') {
    const until = new Date(p.bookedAt + CONST.holdMinutes * 60000);
    const pass = p.pass
      ? `<p class="approved"><b>Approved.</b> Show plate <b>${esc(formatPlate(p.pass.plate))}</b> at the guardhouse, ${esc(fmtTime(new Date(p.pass.slotStart)))} to ${esc(fmtClock(new Date(p.pass.slotEnd)))}.</p>`
      : '';
    return `<h2>Bay held</h2>
      ${pass}
      <p class="saved">${esc(savingLine(p))}</p>
      <p><b>${esc(p.name)}</b> is held for you for ${CONST.holdMinutes} minutes, until ${esc(fmtTime(until))}.</p>
      ${qrSvg(p.chargerId)}
      <p class="muted">At the bay, scan the QR code on the charger to start.</p>
      <div class="btn-row"><button class="btn primary" type="button" data-act="start">Scan QR and start charging</button>
      <button class="btn" type="button" data-act="cancel">Cancel booking</button></div>`;
  }
  if (ui.stage === 'charging') {
    const s = p.session;
    const battery = Math.min(100, p.startPct + (s.kWh / p.batteryKwh) * 100);
    return `<h2>Charging at ${esc(p.name)}</h2>
      <div class="meter" role="progressbar" aria-valuenow="${Math.round(battery)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${battery}%"></span></div>
      <dl class="stats">
        <div><dt>Battery</dt><dd>${Math.round(battery)}%</dd></div>
        <div><dt>Energy</dt><dd>${s.kWh.toFixed(1)} kWh</dd></div>
        <div><dt>Cost so far</dt><dd>${rm(s.kWh * p.price)}</dd></div>
        <div><dt>Time</dt><dd>${formatDuration(s.minutes)}</dd></div>
      </dl>
      <p class="muted">Demo speed: 1 second = 1 minute of charging.</p>
      <button class="btn" type="button" data-act="stop">Stop charging</button>`;
  }
  const s = p.session;
  return `<h2>How did it go?</h2>
    <p>${s.kWh.toFixed(1)} kWh for <b>${rm(s.kWh * p.price)}</b> at ${esc(p.name)}.</p>
    <label class="field">Note (optional) <input id="d-note" type="text" maxlength="120" placeholder="e.g. cable damaged on bay 3"></label>
    <div class="btn-row"><button class="btn primary" type="button" data-act="ok">It worked</button>
    <button class="btn" type="button" data-act="problem">Report a problem</button></div>
    <p class="muted">Your check-in updates this charger's reliability for every driver.</p>`;
}

function savingLine(p) {
  if (p.saving >= 0.01) return `You saved ${rm(p.saving)} vs the nearest charger.`;
  if (p.minutesVsNearest < 0) return `${-p.minutesVsNearest} min faster than the nearest charger.`;
  return 'Same as the nearest charger.';
}
```

- [ ] **Step 6: Replace `bind` and add `book` and `confirmVisitor`**

Replace the whole `bind` function with:

```js
function bind(root, ctx, ranking, car) {
  const box = root.querySelector('#d-results');
  box.querySelectorAll('[data-book]').forEach((btn) => btn.addEventListener('click', () => {
    const c = ranking.results.find((x) => x.charger.id === btn.dataset.book);
    if (!c) return;
    ui.flash = '';
    if (c.isSharedVisit) { ui.stage = 'plate'; ui.pending = c.charger.id; update(root, ctx); return; }
    book(ctx, ranking, c, car, null);
    update(root, ctx);
  }));
  const form = box.querySelector('#d-plate-form');
  if (form) {
    const input = form.querySelector('#d-plate');
    input.addEventListener('input', () => { ui.plate = input.value; });
    form.addEventListener('submit', (e) => { e.preventDefault(); confirmVisitor(root, ctx, ranking, car, form); });
  }
  const act = (name, fn) => { const b = box.querySelector(`[data-act="${name}"]`); if (b) b.addEventListener('click', fn); };
  act('back', () => { ui.stage = 'pick'; ui.pending = null; update(root, ctx); });
  act('start', () => { ui.stage = 'charging'; update(root, ctx); startTimer(root, ctx); });
  act('cancel', () => {
    if (ui.pick?.pass) ctx.state.visitorPasses = ctx.state.visitorPasses.filter((x) => x.id !== ui.pick.pass.id);
    ui.stage = 'pick'; ui.pick = null; ctx.state.booking = null; ctx.save(); update(root, ctx);
  });
  act('stop', () => { stopTimer(); ui.stage = 'done'; update(root, ctx); });
  const checkin = (ok) => {
    const note = (box.querySelector('#d-note')?.value || '').trim();
    const list = ctx.state.checkins[ui.pick.chargerId] || [];
    ctx.state.checkins[ui.pick.chargerId] = [...list, { ok, note, at: ctx.clock.getTime() }];
    ctx.state.booking = null;
    ctx.save();
    ui.flash = ok ? 'Thanks. Your check-in raised this charger\'s reliability score.' : 'Thanks. The JMB and operator can now see this problem.';
    ui.stage = 'pick';
    ui.pick = null;
    ctx.rerender();
  };
  act('ok', () => checkin(true));
  act('problem', () => checkin(false));
}

function confirmVisitor(root, ctx, ranking, car, form) {
  const err = form.querySelector('#d-plate-err');
  const fail = (msg) => { err.textContent = msg; err.hidden = false; };
  const back = (msg) => { ui.stage = 'pick'; ui.pending = null; ui.flash = msg; update(root, ctx); };
  const c = ranking.results.find((x) => x.charger.id === ui.pending);
  if (!c) { back('That bay is no longer free. Pick another charger.'); return; }
  const plate = normalisePlate(ui.plate);
  if (!isValidPlate(plate)) { fail('Enter a number plate with letters and numbers, for example WXY 1234.'); return; }
  if (!form.querySelector('#d-consent').checked) { fail('Tick the box to share your plate with the condo management.'); return; }
  if (!canAutoApprove(c.condo, c.arrival)) { back(`${c.condo.name} is not sharing at that time. Pick another charger.`); return; }
  const pass = createPass({
    id: `pass-${ctx.clock.getTime()}-${c.charger.id}`, condoId: c.condo.id, chargerId: c.charger.id, plate,
    slotStart: c.arrival.getTime(), minutes: CONST.holdMinutes + c.chargeMin, now: ctx.clock.getTime(),
  });
  ui.pending = null;
  book(ctx, ranking, c, car, pass);
  update(root, ctx);
}

// Hold the bay, record the session (anonymous) and, for visitors, the plate pass.
function book(ctx, ranking, c, car, pass) {
  const power = c.charger.type === 'DC' ? Math.min(c.charger.kw, car.dcKw) : Math.min(c.charger.kw, car.acKw);
  const session = buildSession({
    ranking, chosenId: c.charger.id, at: ctx.clock.getTime(), anonNo: anonNumber(ctx.state), resident: !!ui.homeId,
  });
  addSession(ctx.state, session);
  if (pass) ctx.state.visitorPasses = [...ctx.state.visitorPasses, pass];
  ui.pick = {
    chargerId: c.charger.id, name: c.charger.name, price: c.price, kWhTarget: c.kWh, power,
    batteryKwh: car.batteryKwh, startPct: ui.battery, bookedAt: ctx.clock.getTime(),
    session: { kWh: 0, minutes: 0 }, pass,
    saving: session.nearestCostRm - session.costRm, minutesVsNearest: session.minutesVsNearest,
  };
  ui.stage = 'booked';
  ctx.state.booking = { chargerId: c.charger.id, at: ctx.clock.getTime() };
  ctx.save();
}
```

- [ ] **Step 7: Styles**

Append to `styles.css`:

```css
.more { margin-top: 12px; }
.more ul { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 6px; }
.more li { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.approved { background: var(--surface); border: 1px solid var(--accent); border-radius: var(--radius); padding: 10px 12px; }
.saved { font-weight: 600; }
```

- [ ] **Step 8: Check in the browser**

Run: `npm test` — Expected: all pass.

With the local server running, open `http://localhost:8765/#driver` (demo time Wed 11 AM, "Not a resident here").
1. Book a non-condo pick → "Bay held" shows a saving line such as "You saved RMx.xx vs the nearest charger." or "Same as the nearest charger."
2. Cancel. Find a pick tagged "Shared condo bay" (or open "Choose another charger"), book it → the "Visitor details" form appears.
3. Submit empty → error about the plate. Enter `wxy-1234`, no tick → error about the box. Tick and submit → "Approved. Show plate WXY 1234 at the guardhouse, …".
4. Set "I live at" to a condo and book its own bay → no plate step.
No console errors.

- [ ] **Step 9: Commit**

```bash
git add views/driver.js views/format.js styles.css test/state-world.test.js
git commit -m "feat: record each booking's choice and add the visitor plate step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: JMB view — "Driver behaviour" and "Expected visitors"

**Files:**
- Create: `views/jmb-insights.js`
- Modify: `views/jmb.js`, `views/charts.js`, `styles.css`, `test/state-world.test.js`

- [ ] **Step 1: Give `lineChart` a non-money axis (test first)**

In `test/state-world.test.js`, append to the `charts render ...` test:

```js
  const pctLine = lineChart({ labels: ['a', 'b'], series: [{ label: 'Rate', values: [40, 60], cls: 'la' }], money: false, unit: '%', ariaLabel: 'Follow rate' });
  assert.ok(pctLine.includes('100%') && !pctLine.includes('RM') && pctLine.includes('aria-label="Follow rate"'));
```

Run: `node --test test/state-world.test.js` — Expected: FAIL (axis shows "RM").

In `views/charts.js`, change the `lineChart` signature and two lines:

```js
export function lineChart({ labels, series, money = true, unit = '', ariaLabel = 'Monthly income by source' }) {
```

```js
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${ariaLabel}">`;
```

```js
    s += `<text x="${P.l - 6}" y="${y(t) + 4}" class="axis" text-anchor="end">${short(t, money)}${unit}</text>`;
```

Run: `npm test` — Expected: all pass.

- [ ] **Step 2: Create `views/jmb-insights.js`**

```js
// JMB cards: did drivers follow CasCas's picks (anonymous), and which visitors are expected (plates).
import { MODES } from '../engine/score.js';
import { simulateHistory } from '../engine/history.js';
import { filterSessions, followRate, savings, weeklyTrend, byMode, toCsv, CHOICE_LABEL, anonLabel } from '../engine/insights.js';
import { upcomingPasses, formatPlate } from '../engine/access.js';
import { lineChart } from './charts.js';
import { esc, rm, rm0, num, pct, fmtTime, fmtDay, fmtClock } from './format.js';

const DAY = 864e5;
const filters = { role: 'all', from: '', to: '' };
const DAYS_LABEL = { weekdays: 'weekdays', weekends: 'weekends', all: 'every day' };

const dayStart = (v) => {
  const d = new Date(`${v}T00:00`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
};

export function insightsSection(condo, charger, ctx) {
  const now = ctx.clock.getTime();
  const real = filterSessions(ctx.state.sessions, { condoId: condo.id });
  const all = [...simulateHistory(condo, charger, now), ...real].sort((a, b) => a.at - b.at);
  const recent = filterSessions(all, { from: now - 30 * DAY, to: now + 1 });
  const monthStart = new Date(ctx.clock.getFullYear(), ctx.clock.getMonth(), 1).getTime();
  const month = filterSessions(all, { from: monthStart, to: now + 1 });
  const s30 = savings(recent);
  const trend = weeklyTrend(all, now, 12);
  const from = filters.from ? dayStart(filters.from) : null;
  const toDay = filters.to ? dayStart(filters.to) : null;
  const rows = filterSessions(all, { role: filters.role, from, to: toDay == null ? null : toDay + DAY }).reverse();

  const html = `
    <section class="card insights">
      <div class="card-head"><h3>Driver behaviour</h3><span class="chip">Simulated history + your demo bookings</span></div>
      <div class="kpis">
        <div class="kpi hero"><span>Took a CasCas pick (30 days)</span><b>${pct(followRate(recent))}</b></div>
        <div class="kpi"><span>Saved per session vs nearest</span><b>${rm(s30.avgRm)}</b></div>
        <div class="kpi"><span>Saved by drivers this month</span><b>${rm0(savings(month).totalRm)}</b></div>
        <div class="kpi"><span>Sessions (30 days)</span><b>${num(recent.length)}</b></div>
      </div>
      <div class="grid2">
        <div><h4>Share of bookings that took a CasCas pick, by week</h4>
          ${lineChart({
            labels: trend.map((w, i) => (i % 2 ? '' : fmtDay(new Date(w.weekStart)))),
            series: [{ label: 'Took a CasCas pick', values: trend.map((w) => Math.round(w.followRate * 100)), cls: 'la' }],
            money: false, unit: '%', ariaLabel: 'Weekly share of bookings that took a CasCas pick',
          })}
        </div>
        <div><h4>By battery mode (30 days)</h4>
          <div class="tbl"><table>
            <thead><tr><th>Mode</th><th>Sessions</th><th>Took a CasCas pick</th></tr></thead>
            <tbody>${byMode(recent).map((g) => `<tr><td>${MODES[g.key].label}</td><td>${num(g.count)}</td><td>${g.count ? pct(g.followRate) : '—'}</td></tr>`).join('')}</tbody>
          </table></div>
          <p class="muted">Average time vs the nearest charger: ${s30.avgMinutes > 0 ? '+' : ''}${s30.avgMinutes} min. Saver drivers accept a short detour for a lower price.</p>
        </div>
      </div>
      <h4>Session log</h4>
      <form id="j-log" class="row log-filters" novalidate>
        <label class="field">Drivers <select id="j-role"><option value="all">All</option><option value="resident">Residents</option><option value="visitor">Visitors</option></select></label>
        <label class="field">From <input id="j-from" type="date" value="${esc(filters.from)}"></label>
        <label class="field">To <input id="j-to" type="date" value="${esc(filters.to)}"></label>
        <button id="j-csv" class="btn small" type="button">Export CSV (${num(rows.length)})</button>
      </form>
      <div class="tbl"><table>
        <thead><tr><th>Time</th><th>Driver</th><th>Mode</th><th>kWh</th><th>Cost</th><th>Choice</th><th>Saved vs nearest</th></tr></thead>
        <tbody>${rows.slice(0, 50).map((r) => `<tr><td>${esc(fmtDay(new Date(r.at)))} ${esc(fmtClock(new Date(r.at)))}</td><td>${esc(anonLabel(r.anonId))}</td><td>${MODES[r.mode].label}</td><td>${r.kWh.toFixed(1)}</td><td>${rm(r.costRm)}</td><td>${CHOICE_LABEL[r.choice]}</td><td>${rm(r.nearestCostRm - r.costRm)}</td></tr>`).join('') || '<tr><td colspan="7">No sessions match these filters.</td></tr>'}</tbody>
      </table></div>
      <p class="muted">Drivers appear by anonymous ID only. No names, phone numbers or plates are kept in this log.</p>
    </section>`;

  const bind = (root) => {
    const $ = (sel) => root.querySelector(sel);
    $('#j-role').value = filters.role;
    $('#j-log').addEventListener('submit', (e) => e.preventDefault());
    $('#j-log').addEventListener('change', () => {
      filters.role = $('#j-role').value;
      filters.from = $('#j-from').value;
      filters.to = $('#j-to').value;
      ctx.rerender();
    });
    $('#j-csv').addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([toCsv([...rows].reverse())], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `cascas-${condo.id}-sessions.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  };
  return { html, bind };
}

export function visitorsHtml(condo, ctx) {
  const s = condo.sharing;
  const passes = upcomingPasses(ctx.state.visitorPasses, condo.id, ctx.clock.getTime());
  const bayName = (id) => ctx.world.chargers.find((ch) => ch.id === id)?.name || id;
  const status = s.enabled
    ? `Visitors are approved automatically during sharing hours (${DAYS_LABEL[s.days]}, ${s.start}:00 to ${s.end}:00).`
    : 'Sharing is off, so visitors cannot book. Visits already approved stay on this list.';
  return `
    <section class="card visitors">
      <h3>Expected visitors</h3>
      <p class="muted">${esc(status)} The guardhouse checks plates against this list.</p>
      ${passes.length ? `<div class="tbl"><table>
        <thead><tr><th>Slot</th><th>Bay</th><th>Plate</th></tr></thead>
        <tbody>${passes.map((p) => `<tr><td>${esc(fmtTime(new Date(p.slotStart)))} to ${esc(fmtClock(new Date(p.slotEnd)))}</td><td>${esc(bayName(p.chargerId))}</td><td><b>${esc(formatPlate(p.plate))}</b></td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="empty">No visitor bookings yet.</p>'}
      <p class="muted">Plates are deleted 30 days after the visit.</p>
    </section>`;
}
```

- [ ] **Step 3: Mount the cards in `views/jmb.js`**

Add to the imports:

```js
import { insightsSection, visitorsHtml } from './jmb-insights.js';
```

Directly before `root.innerHTML = \``, add:

```js
  const insights = insightsSection(condo, charger, ctx);
```

At the end of the template, change:

```js
      </table></div>
    </section>
  </div>`;
```

to:

```js
      </table></div>
    </section>
    ${visitorsHtml(condo, ctx)}
    ${insights.html}
  </div>`;
```

At the very end of `renderJmb` (after the `#j-share` change listener), add:

```js
  insights.bind(root);
```

- [ ] **Step 4: Styles**

Append to `styles.css`:

```css
.card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
.insights h4 { margin: 16px 0 8px; font-size: 0.95rem; }
.log-filters { align-items: end; flex-wrap: wrap; gap: 12px; }
.visitors, .insights { margin-top: 16px; }
```

- [ ] **Step 5: Check in the browser**

Run: `npm test` — Expected: all pass.

Open `http://localhost:8765/#driver`, book a visitor slot at Residensi Lumina (Wed 11 AM, plate `WXY 1234`), then open `#jmb` and choose Residensi Lumina.
Expected:
- "Expected visitors" lists the slot, bay and plate **WXY 1234**.
- "Driver behaviour" shows four KPI tiles, the weekly line (axis in %), the mode table and the session log; your booking is the newest row with an ID such as "Visitor #48" and no plate.
- Filter "Visitors" narrows the log; dates narrow it; "Export CSV" downloads a file whose header matches the test.
- Switch sharing off: the status text changes and the approved visit stays.
No console errors.

- [ ] **Step 6: Commit**

```bash
git add views/jmb-insights.js views/jmb.js views/charts.js styles.css test/state-world.test.js
git commit -m "feat: JMB driver-behaviour analytics and expected-visitors list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: README, final check and deploy

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md`**

Replace the "What it shows" section and the demo script with:

```markdown
## What it shows

- **Driver:** battery-aware picks across every provider around KL East. Low battery gets the nearest working charger; high battery gets cheaper, quieter ones, with demand balancing that keeps busy fast chargers free for drivers who need them. Every booking records (anonymously) whether the driver took a CasCas pick and what it saved vs the nearest charger.
- **Idle-hour sharing:** condo bays open to outside drivers during the hours the JMB sets, with residents first. Visitors enter their number plate and are approved automatically while the condo is sharing.
- **JMB:** charging income, saving per unit, sharing settings, charger health, expected visitors (plates for the guardhouse), and driver behaviour: follow rate, savings, weekly trend, mode breakdown and an anonymous session log with CSV export.

## Data

- **Public chargers:** live from [Open Charge Map](https://openchargemap.org) when a key is set; otherwise a saved copy (up to 7 days old) or the built-in demo list. The header shows which.
- **Simulated:** condo bays (fictional condos), occupancy, and six months of session history. Prices come from public 2026 rates; unknown operators show "est.".

### Open Charge Map key

1. Sign up at openchargemap.org → My Profile → My Apps → create an app key.
2. Put it in `config.js`: `export const OCM = { key: 'YOUR_KEY', ... }`.
3. Reload. The header should read "Chargers: live from Open Charge Map".

## 60-second demo script

1. **Driver**, Wed 11 AM, battery 35%, "Not a resident here": three picks with reasons; condo pins tagged "Shared now".
2. Drag battery to 8%: Urgent mode, the nearest DC charger wins. Back to 75%: Saver mode, cheaper chargers first.
3. Book a shared condo bay: enter plate WXY 1234, tick consent → "Approved, show plate at the guardhouse", plus "You saved RMx vs the nearest charger".
4. **JMB**, Residensi Lumina: the plate is in "Expected visitors"; "Driver behaviour" shows the follow rate, savings and your booking at the top of the session log (anonymous). Export CSV.
5. Turn sharing off: visitors can no longer book; income falls.
```

- [ ] **Step 2: Full test run and browser check**

Run: `npm test`
Expected: all pass, 0 fail.

Open `http://localhost:8765/` and walk the demo script above. Expected: every step behaves as written; no console errors; `#sdp` opens the Driver view.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README for real chargers, insights and visitor access

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Deploy (ask the user first)**

Pushing publishes the live site. With the user's OK:

```bash
git push origin main
```

Then open https://cytang1107.github.io/CasCas/ after GitHub Pages rebuilds (about a minute) and repeat the demo script on the live site.
