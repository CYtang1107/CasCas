# CasCas Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static, always-online web prototype of CasCas: a driver screen with battery-aware, demand-balanced charger recommendations around KL East; a JMB income dashboard with idle-hour sharing settings; and an SDP township view. Deployed to GitHub Pages.

**Architecture:** Plain HTML/CSS/ES modules with no build step. Simulated data lives in `data/`. All logic sits in pure, DOM-free `engine/` modules tested with `node --test`. `views/` render HTML strings into `#view` based on the URL hash. Leaflet with OpenStreetMap tiles draws the map. Per-device state (bookings, check-ins, JMB sharing settings) goes in `localStorage` with an in-memory fallback.

**Tech Stack:** HTML, CSS, JavaScript ES modules, Leaflet 1.9.4 (unpkg), Node 25 `node:test`, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-14-cascas-design.md`

## Global Constraints

- No build step, no npm runtime dependencies. `package.json` exists only for `"type": "module"` and the test script.
- Product name and tagline come only from `config.js` (`APP.name = 'CasCas'`), so a rename is one edit.
- Condo names are fictional. The footer says "All data simulated; condo names are fictional."
- Prices (RM/kWh): condo resident 0.90, condo visitor 1.10, condo peak surcharge 0.10. Public AC 0.90–1.15, DC Gentari 1.30 (destination) / 1.70 (highway), JomCharge 1.30–1.40, ChargEV 1.30, Tesla (non-Tesla cars) 1.80.
- TNB ToU: peak weekdays 14:00–22:00 at 0.2852, off-peak 0.2443.
- Constants: hardware RM6,000 per bay; grid 0.74 kg CO₂e/kWh; petrol 0.16 kg/km; EV 0.15 kWh/km; road factor 1.3; 30 km/h average; target charge 80%; 10% range buffer; 15-minute hold.
- Modes: Urgent ≤15% (0.1/0.6/0.3), Balanced 16–50% (0.4/0.4/0.2), Saver >50% (0.6/0.25/0.15) for cost/time/risk.
- Balancing: Saver only; occupancy ≥ 0.8 gets +0.25 score.
- Every `localStorage` access is wrapped in try/catch.
- Light and dark themes via CSS tokens. The driver screen works at 400 px width.
- Demo week: Mon 19 Oct 2026 – Sun 25 Oct 2026. The default demo time is Wed 21 Oct 2026, 11:00.

## Review Focus

1. **Battery at or above the target (e.g. 100%)**: no NaN or negative cost; the driver sees "No charge needed". Test in Task 4.
2. **Nothing reachable (5% battery, far chargers)**: empty results, no crash; the driver sees the nearest charger and its distance. Test in Task 4.
3. **Sharing window boundaries (exactly 17:00, weekend vs weekday, all bays reserved)**: closed at the end hour, zero visitor bays when everything is reserved. Test in Task 3.
4. **Corrupt or unavailable `localStorage`**: the app starts with blank state and saving never throws. Test in Task 6.
5. **Many "Problem" check-ins**: reliability drops and the charger falls out of the top pick and turns red. Test in Task 4 (`effectiveReliability`) and Task 6 (`buildWorld`).

---

### Task 1: Project scaffold and simulated KL East data

**Files:**
- Create: `package.json`, `.gitignore`, `config.js`, `data/tariff.js`, `data/cars.js`, `data/condos.js`, `data/chargers.js`, `data/places.js`, `data/demand.js`
- Test: `test/data.test.js`

**Interfaces:**
- Produces:
  - `APP {name, tagline, township}`
  - `CONST {...}` (see code)
  - `TNB`, `isWeekend(date)`, `isPeak(date)`, `tnbRate(date)`, `EARLY_BIRD`
  - `CARS[]`, `CONDOS[]`, `CHARGERS[]`, `PLACES[]`, `START {lat,lng}`, `CLOCK_PRESETS[{id,label,date()}]`
  - `baseOccupancy(charger, date) → 0..1`, `visitorDemand(date) → 0..1`

- [ ] **Step 1: Write the failing test**

```js
// FILE: test/data.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARGERS } from '../data/chargers.js';
import { CONDOS } from '../data/condos.js';
import { CARS } from '../data/cars.js';
import { PLACES, CLOCK_PRESETS } from '../data/places.js';
import { baseOccupancy, visitorDemand } from '../data/demand.js';

test('every condo has exactly one condo charger site with matching bays', () => {
  for (const c of CONDOS) {
    const sites = CHARGERS.filter((ch) => ch.condoId === c.id);
    assert.equal(sites.length, 1, c.id);
    assert.equal(sites[0].bays, c.bays, c.id);
    assert.equal(sites[0].siteType, 'condo', c.id);
  }
});

test('charger ids are unique and fields are valid', () => {
  assert.equal(new Set(CHARGERS.map((c) => c.id)).size, CHARGERS.length);
  assert.ok(CHARGERS.length >= 20);
  for (const ch of CHARGERS) {
    assert.ok(['AC', 'DC'].includes(ch.type), ch.id);
    assert.ok(ch.connectors.length > 0, ch.id);
    assert.ok(ch.reliability > 0 && ch.reliability <= 1, ch.id);
    assert.ok(['condo', 'mall', 'public'].includes(ch.siteType), ch.id);
    if (ch.siteType !== 'condo') assert.ok(ch.price > 0, ch.id);
  }
});

test('occupancy stays within 0..1 for every charger, hour, weekday and weekend', () => {
  for (const ch of CHARGERS) {
    for (const day of [19, 24]) {
      for (let h = 0; h < 24; h++) {
        const v = baseOccupancy(ch, new Date(2026, 9, day, h));
        assert.ok(v >= 0 && v <= 1, `${ch.id} day ${day} h ${h}: ${v}`);
      }
    }
  }
  for (let h = 0; h < 24; h++) {
    const v = visitorDemand(new Date(2026, 9, 21, h));
    assert.ok(v >= 0 && v <= 1);
  }
});

test('cars, places and clock presets are usable', () => {
  for (const c of CARS) assert.ok(c.batteryKwh > 0 && c.acKw > 0 && c.dcKw > 0 && c.efficiencyKwhPerKm > 0, c.id);
  assert.ok(PLACES.some((p) => p.id === 'here'));
  assert.equal(CLOCK_PRESETS[0].date().getDay(), 3); // Wednesday default
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/data.test.js`
Expected: FAIL with `Cannot find module` for `../data/chargers.js`.

- [ ] **Step 3: Write the scaffold and data files**

```json
// FILE: package.json
{
  "name": "cascas",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "CasCas prototype: shared EV charging for SDP townships",
  "scripts": { "test": "node --test" }
}
```

```gitignore
# FILE: .gitignore
node_modules/
.DS_Store
.superpowers/
```

```js
// FILE: config.js
export const APP = {
  name: 'CasCas',
  tagline: 'Charge together. Earn together.',
  township: 'KL East',
};

export const CONST = {
  hardwarePerBay: 6000,   // RM per shared AC bay incl. sub-meter (research: RM4,500–8,000)
  gridKgPerKwh: 0.74,     // Peninsular Malaysia grid emission factor, 2024 provisional
  petrolKgPerKm: 0.16,    // 7 L/100 km × 2.31 kg CO2 per litre
  evKwhPerKm: 0.15,
  roadFactor: 1.3,        // road distance ÷ straight-line distance
  avgKmh: 30,             // urban average speed
  targetPct: 80,
  rangeBuffer: 0.1,
  holdMinutes: 15,
  drawFactor: 0.5,        // share of an occupied hour a car actually draws power
  nationalTarget2030: 30000,
  sdpTownships: 28,
};
```

```js
// FILE: data/tariff.js
// TNB domestic Time-of-Use (from 1 Jul 2025), usage up to 1,500 kWh/month, before AFA.
export const TNB = { peakStartHour: 14, peakEndHour: 22, peakRate: 0.2852, offPeakRate: 0.2443 };

// Gentari trialled 15% off between 00:00 and 06:59.
export const EARLY_BIRD = { operator: 'Gentari', endHour: 7, discount: 0.15 };

export function isWeekend(date) {
  const d = date.getDay();
  return d === 0 || d === 6;
}

export function isPeak(date) {
  if (isWeekend(date)) return false;
  const h = date.getHours();
  return h >= TNB.peakStartHour && h < TNB.peakEndHour;
}

export function tnbRate(date) {
  return isPeak(date) ? TNB.peakRate : TNB.offPeakRate;
}
```

```js
// FILE: data/cars.js
// Approximate specs, for simulation only.
export const CARS = [
  { id: 'emas7', name: 'Proton e.MAS 7', batteryKwh: 60.2, efficiencyKwhPerKm: 0.15, acKw: 11, dcKw: 100, connectors: ['Type2', 'CCS2'] },
  { id: 'emas5', name: 'Proton e.MAS 5', batteryKwh: 37.2, efficiencyKwhPerKm: 0.13, acKw: 6.6, dcKw: 70, connectors: ['Type2', 'CCS2'] },
  { id: 'atto3', name: 'BYD Atto 3', batteryKwh: 60.5, efficiencyKwhPerKm: 0.16, acKw: 7, dcKw: 88, connectors: ['Type2', 'CCS2'] },
  { id: 'modely', name: 'Tesla Model Y', batteryKwh: 60, efficiencyKwhPerKm: 0.14, acKw: 11, dcKw: 170, connectors: ['Type2', 'CCS2'] },
];
```

```js
// FILE: data/condos.js
// Fictional condos placed around SDP's KL East township. Figures are simulated.
const share = (enabled, days, start, end, reservedBays) => ({ enabled, days, start, end, reservedBays, visitorPrice: 1.1 });

export const CONDOS = [
  { id: 'lumina', name: 'Residensi Lumina', lat: 3.2150, lng: 101.7205, units: 300, bays: 10, jmbShare: 0.7, monthlyFee: 400, residentPrice: 0.9, peakSurcharge: 0.1, sharing: share(true, 'weekdays', 9, 17, 2) },
  { id: 'serini', name: 'Serini Park', lat: 3.2185, lng: 101.7262, units: 420, bays: 12, jmbShare: 0.7, monthlyFee: 380, residentPrice: 0.9, peakSurcharge: 0.1, sharing: share(true, 'all', 10, 18, 3) },
  { id: 'kenanga', name: 'Kenanga Heights', lat: 3.2098, lng: 101.7190, units: 250, bays: 8, jmbShare: 0.7, monthlyFee: 420, residentPrice: 0.9, peakSurcharge: 0.1, sharing: share(false, 'weekdays', 9, 17, 2) },
  { id: 'vista', name: 'Vista Melati', lat: 3.2215, lng: 101.7225, units: 360, bays: 10, jmbShare: 0.7, monthlyFee: 390, residentPrice: 0.9, peakSurcharge: 0.1, sharing: share(true, 'weekdays', 8, 18, 2) },
  { id: 'azalea', name: 'Azalea Suites', lat: 3.2120, lng: 101.7290, units: 200, bays: 6, jmbShare: 0.7, monthlyFee: 450, residentPrice: 0.9, peakSurcharge: 0.1, sharing: share(false, 'weekdays', 9, 17, 2) },
  { id: 'teratai', name: 'Teratai Residence', lat: 3.2060, lng: 101.7240, units: 320, bays: 10, jmbShare: 0.7, monthlyFee: 400, residentPrice: 0.9, peakSurcharge: 0.1, sharing: share(true, 'weekdays', 9, 16, 3) },
];
```

```js
// FILE: data/chargers.js
// Simulated charger network around KL East. Prices reflect 2026 public rates (research doc).
import { CONDOS } from './condos.js';

const condoSites = CONDOS.map((c) => ({
  id: `cs-${c.id}`, name: `${c.name} car park`, operator: 'Condo CPO partner',
  lat: c.lat, lng: c.lng, type: 'AC', kw: 7, connectors: ['Type2'], bays: c.bays,
  siteType: 'condo', condoId: c.id, reliability: 0.97, price: null,
}));

const site = (id, name, operator, lat, lng, type, kw, bays, price, reliability, siteType, extra = {}) => ({
  id, name, operator, lat, lng, type, kw, bays, price, reliability, siteType,
  connectors: type === 'DC' ? ['CCS2'] : ['Type2'], ...extra,
});

export const CHARGERS = [
  ...condoSites,
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

```js
// FILE: data/places.js
export const START = { lat: 3.2165, lng: 101.7250 }; // "You are here" inside KL East

export const PLACES = [
  { id: 'klem', name: 'KL East Mall', lat: 3.2126, lng: 101.7235 },
  { id: 'melawati', name: 'Melawati Mall', lat: 3.2107, lng: 101.7484 },
  { id: 'wangsa', name: 'Wangsa Maju LRT', lat: 3.2056, lng: 101.7318 },
  { id: 'klcc', name: 'KLCC', lat: 3.1579, lng: 101.7123 },
  { id: 'here', name: 'Just charge near me', lat: START.lat, lng: START.lng },
];

// Demo week: Mon 19 – Sun 25 Oct 2026. The first preset is the default.
export const CLOCK_PRESETS = [
  { id: 'wed11', label: 'Wed 11 AM · sharing open', date: () => new Date(2026, 9, 21, 11, 0) },
  { id: 'tue1830', label: 'Tue 6:30 PM · TNB peak', date: () => new Date(2026, 9, 20, 18, 30) },
  { id: 'sat10', label: 'Sat 10 AM · weekend', date: () => new Date(2026, 9, 24, 10, 0) },
  { id: 'wed2', label: 'Wed 2 AM · overnight', date: () => new Date(2026, 9, 21, 2, 0) },
  { id: 'now', label: 'Right now', date: () => new Date() },
];
```

```js
// FILE: data/demand.js
// Simulated share of bays in use, by site type and hour (index 0 = midnight).
import { isWeekend } from './tariff.js';

const PROFILES = {
  condo: {
    weekday: [0.45, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.12, 0.08, 0.08, 0.08, 0.1, 0.1, 0.1, 0.1, 0.12, 0.15, 0.25, 0.45, 0.7, 0.85, 0.85, 0.7, 0.55],
    weekend: [0.45, 0.4, 0.35, 0.3, 0.3, 0.25, 0.2, 0.18, 0.18, 0.2, 0.22, 0.22, 0.22, 0.22, 0.2, 0.2, 0.25, 0.35, 0.5, 0.65, 0.75, 0.75, 0.65, 0.5],
  },
  mall: {
    weekday: [0, 0, 0, 0, 0, 0, 0, 0.05, 0.1, 0.15, 0.3, 0.45, 0.55, 0.5, 0.5, 0.55, 0.65, 0.75, 0.85, 0.8, 0.6, 0.35, 0.1, 0],
    weekend: [0, 0, 0, 0, 0, 0, 0, 0.05, 0.1, 0.25, 0.5, 0.7, 0.85, 0.9, 0.9, 0.9, 0.85, 0.85, 0.8, 0.75, 0.55, 0.3, 0.1, 0],
  },
  public: {
    weekday: [0.1, 0.05, 0.05, 0.05, 0.05, 0.1, 0.3, 0.6, 0.7, 0.5, 0.35, 0.35, 0.4, 0.4, 0.35, 0.4, 0.55, 0.8, 0.85, 0.7, 0.5, 0.35, 0.25, 0.15],
    weekend: [0.1, 0.05, 0.05, 0.05, 0.05, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.55, 0.6, 0.6, 0.55, 0.55, 0.55, 0.6, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15],
  },
  visitor: {
    weekday: [0, 0, 0, 0, 0, 0, 0, 0.2, 0.35, 0.45, 0.5, 0.5, 0.55, 0.55, 0.5, 0.5, 0.45, 0.4, 0.3, 0.2, 0.1, 0, 0, 0],
    weekend: [0, 0, 0, 0, 0, 0, 0, 0.1, 0.25, 0.4, 0.5, 0.55, 0.55, 0.55, 0.5, 0.45, 0.4, 0.35, 0.25, 0.15, 0.1, 0, 0, 0],
  },
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Stable ±0.1 variation per charger so sites do not look identical.
function jitter(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return (h / 997 - 0.5) * 0.2;
}

function profile(kind, date) {
  return PROFILES[kind][isWeekend(date) ? 'weekend' : 'weekday'];
}

export function baseOccupancy(charger, date) {
  const hourly = profile(charger.siteType, date)[date.getHours()];
  if (hourly === 0) return 0;
  return clamp01(hourly + jitter(charger.id) + (charger.busyBias || 0));
}

export function visitorDemand(date) {
  return profile('visitor', date)[date.getHours()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/data.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore config.js data test/data.test.js
git commit -m "feat: scaffold project and simulated KL East data"
```

---

### Task 2: Pricing and geography engine

**Files:**
- Create: `engine/pricing.js`, `engine/geo.js`
- Test: `test/pricing-geo.test.js`

**Interfaces:**
- Consumes: `isPeak`, `tnbRate`, `EARLY_BIRD` (Task 1), `CONST` (Task 1)
- Produces:
  - `priceAt(charger, date, condo = null, isResident = false) → number` (RM/kWh, 2 dp)
  - `priceNote(charger, date, condo) → string|null`
  - `round2(n)`
  - `distanceKm(a, b)`, `driveMinutes(km)`, `detourMinutes(origin, charger, destination)`

- [ ] **Step 1: Write the failing test**

```js
// FILE: test/pricing-geo.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPeak, tnbRate } from '../data/tariff.js';
import { priceAt, priceNote } from '../engine/pricing.js';
import { distanceKm, driveMinutes, detourMinutes } from '../engine/geo.js';

test('TNB peak is weekdays 14:00 to 21:59', () => {
  assert.equal(isPeak(new Date(2026, 9, 20, 14, 0)), true);
  assert.equal(isPeak(new Date(2026, 9, 20, 21, 59)), true);
  assert.equal(isPeak(new Date(2026, 9, 20, 22, 0)), false);
  assert.equal(isPeak(new Date(2026, 9, 20, 13, 59)), false);
  assert.equal(isPeak(new Date(2026, 9, 24, 18, 0)), false); // Saturday
  assert.equal(tnbRate(new Date(2026, 9, 20, 18, 0)), 0.2852);
  assert.equal(tnbRate(new Date(2026, 9, 20, 9, 0)), 0.2443);
});

const condo = { residentPrice: 0.9, peakSurcharge: 0.1, sharing: { visitorPrice: 1.1 } };
const condoSite = { siteType: 'condo', operator: 'Condo CPO partner', price: null };

test('condo price depends on resident status and TNB peak', () => {
  assert.equal(priceAt(condoSite, new Date(2026, 9, 21, 11), condo, true), 0.9);
  assert.equal(priceAt(condoSite, new Date(2026, 9, 21, 11), condo, false), 1.1);
  assert.equal(priceAt(condoSite, new Date(2026, 9, 20, 18, 30), condo, true), 1.0);
  assert.equal(priceAt(condoSite, new Date(2026, 9, 20, 18, 30), condo, false), 1.2);
  assert.equal(priceNote(condoSite, new Date(2026, 9, 21, 11), condo), 'Off-peak price');
  assert.equal(priceNote(condoSite, new Date(2026, 9, 20, 18, 30), condo), 'Peak-hour price');
});

test('Gentari early-bird is 15% off before 7 AM only', () => {
  const g = { siteType: 'public', operator: 'Gentari', price: 1.4 };
  assert.equal(priceAt(g, new Date(2026, 9, 21, 2)), 1.19);
  assert.equal(priceAt(g, new Date(2026, 9, 21, 7)), 1.4);
  assert.equal(priceNote(g, new Date(2026, 9, 21, 2), null), 'Early-bird rate');
  const j = { siteType: 'public', operator: 'JomCharge', price: 1.3 };
  assert.equal(priceAt(j, new Date(2026, 9, 21, 2)), 1.3);
  assert.equal(priceNote(j, new Date(2026, 9, 21, 2), null), null);
});

test('distance and drive time', () => {
  const klem = { lat: 3.2126, lng: 101.7235 };
  const klcc = { lat: 3.1579, lng: 101.7123 };
  const d = distanceKm(klem, klcc);
  assert.ok(d > 5.5 && d < 7, `got ${d}`);
  assert.equal(driveMinutes(10), 26);
});

test('detour is zero when the charger is at the origin and positive otherwise', () => {
  const o = { lat: 3.2, lng: 101.7 };
  const dest = { lat: 3.21, lng: 101.7 };
  assert.ok(Math.abs(detourMinutes(o, o, dest)) < 1e-9);
  assert.ok(detourMinutes(o, { lat: 3.2, lng: 101.72 }, dest) > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pricing-geo.test.js`
Expected: FAIL with `Cannot find module` for `../engine/pricing.js`.

- [ ] **Step 3: Implement**

```js
// FILE: engine/pricing.js
import { isPeak, EARLY_BIRD } from '../data/tariff.js';

export function round2(n) {
  return Math.round(n * 100) / 100;
}

function earlyBird(charger, date) {
  return charger.operator === EARLY_BIRD.operator && date.getHours() < EARLY_BIRD.endHour;
}

// RM/kWh a driver pays at `date`. `condo` is the condo that owns the site, if any.
export function priceAt(charger, date, condo = null, isResident = false) {
  if (charger.siteType === 'condo' && condo) {
    const base = isResident ? condo.residentPrice : condo.sharing.visitorPrice;
    return round2(base + (isPeak(date) ? condo.peakSurcharge : 0));
  }
  if (earlyBird(charger, date)) return round2(charger.price * (1 - EARLY_BIRD.discount));
  return charger.price;
}

export function priceNote(charger, date, condo) {
  if (charger.siteType === 'condo' && condo) return isPeak(date) ? 'Peak-hour price' : 'Off-peak price';
  if (earlyBird(charger, date)) return 'Early-bird rate';
  return null;
}
```

```js
// FILE: engine/geo.js
import { CONST } from '../config.js';

const toRad = (d) => (d * Math.PI) / 180;

export function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function driveMinutes(km) {
  return ((km * CONST.roadFactor) / CONST.avgKmh) * 60;
}

// Extra minutes for origin → charger → destination compared with going direct.
export function detourMinutes(origin, charger, destination) {
  const extra = distanceKm(origin, charger) + distanceKm(charger, destination) - distanceKm(origin, destination);
  return driveMinutes(Math.max(0, extra));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/pricing-geo.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add engine/pricing.js engine/geo.js test/pricing-geo.test.js
git commit -m "feat: add pricing and geography engine"
```

---

### Task 3: Idle-hour sharing and occupancy

**Files:**
- Create: `engine/sharing.js`, `engine/occupancy.js`
- Test: `test/sharing.test.js`

**Interfaces:**
- Consumes: `isWeekend` (Task 1), `baseOccupancy`, `visitorDemand` (Task 1)
- Produces:
  - `isOpenToVisitors(condo, date) → boolean`
  - `visitorBaysFree(condo, residentOccupancy, date) → integer`
  - `validateSharing(sharing, bays) → string|null`
  - `occupancyAt(charger, date, condo = null) → {resident, visitor, total}`

- [ ] **Step 1: Write the failing test**

```js
// FILE: test/sharing.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOpenToVisitors, visitorBaysFree, validateSharing } from '../engine/sharing.js';
import { occupancyAt } from '../engine/occupancy.js';

const condo = (over = {}) => ({
  id: 'c1', bays: 10,
  sharing: { enabled: true, days: 'weekdays', start: 9, end: 17, reservedBays: 2, visitorPrice: 1.1, ...over },
});
const wed = (h, m = 0) => new Date(2026, 9, 21, h, m);
const sat = (h) => new Date(2026, 9, 24, h, 0);

test('open inside the weekday window only', () => {
  assert.equal(isOpenToVisitors(condo(), wed(9)), true);
  assert.equal(isOpenToVisitors(condo(), wed(16, 59)), true);
  assert.equal(isOpenToVisitors(condo(), wed(17)), false);
  assert.equal(isOpenToVisitors(condo(), wed(8, 59)), false);
  assert.equal(isOpenToVisitors(condo(), sat(11)), false);
  assert.equal(isOpenToVisitors(condo({ days: 'all' }), sat(11)), true);
  assert.equal(isOpenToVisitors(condo({ days: 'weekends' }), wed(11)), false);
  assert.equal(isOpenToVisitors(condo({ enabled: false }), wed(11)), false);
});

test('visitor bays respect reserved bays and residents already charging', () => {
  assert.equal(visitorBaysFree(condo(), 0.1, wed(11)), 8);
  assert.equal(visitorBaysFree(condo(), 0.5, wed(11)), 5);
  assert.equal(visitorBaysFree(condo({ reservedBays: 10 }), 0, wed(11)), 0);
  assert.equal(visitorBaysFree(condo(), 0.1, wed(20)), 0);
});

test('validateSharing rejects bad settings with a readable message', () => {
  assert.equal(validateSharing(condo().sharing, 10), null);
  assert.match(validateSharing({ ...condo().sharing, start: 18, end: 9 }, 10), /before closing/);
  assert.match(validateSharing({ ...condo().sharing, reservedBays: 11 }, 10), /between 0 and 10/);
  assert.match(validateSharing({ ...condo().sharing, reservedBays: 1.5 }, 10), /between 0 and 10/);
  assert.match(validateSharing({ ...condo().sharing, visitorPrice: 9 }, 10), /Visitor price/);
  assert.match(validateSharing({ ...condo().sharing, days: 'sometimes' }, 10), /weekdays/);
});

test('occupancy adds visitors only while a condo is open', () => {
  const site = { id: 'cs-c1', siteType: 'condo', condoId: 'c1' };
  const open = occupancyAt(site, wed(11), condo());
  assert.ok(open.visitor > 0);
  assert.ok(open.total <= 1);
  assert.equal(occupancyAt(site, wed(20), condo()).visitor, 0);
  const mall = occupancyAt({ id: 'm', siteType: 'mall' }, wed(18), null);
  assert.equal(mall.visitor, 0);
  assert.ok(mall.total > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sharing.test.js`
Expected: FAIL with `Cannot find module` for `../engine/sharing.js`.

- [ ] **Step 3: Implement**

```js
// FILE: engine/sharing.js
import { isWeekend } from '../data/tariff.js';

const DAYS = ['weekdays', 'weekends', 'all'];

export function isOpenToVisitors(condo, date) {
  const s = condo.sharing;
  if (!s || !s.enabled) return false;
  const weekend = isWeekend(date);
  if (s.days === 'weekdays' && weekend) return false;
  if (s.days === 'weekends' && !weekend) return false;
  const h = date.getHours() + date.getMinutes() / 60;
  return h >= s.start && h < s.end;
}

// Bays an outside driver could take now. Residents charging use reserved bays first.
export function visitorBaysFree(condo, residentOccupancy, date) {
  if (!isOpenToVisitors(condo, date)) return 0;
  const residentsCharging = Math.ceil(condo.bays * residentOccupancy);
  const held = Math.max(condo.sharing.reservedBays, residentsCharging);
  return Math.max(0, condo.bays - held);
}

export function validateSharing(s, bays) {
  if (!DAYS.includes(s.days)) return 'Choose weekdays, weekends or every day.';
  if (!(s.start >= 0 && s.end <= 24 && s.start < s.end)) return 'Opening time must be before closing time.';
  if (!(Number.isInteger(s.reservedBays) && s.reservedBays >= 0 && s.reservedBays <= bays)) {
    return `Bays kept for residents must be a whole number between 0 and ${bays}.`;
  }
  if (!(s.visitorPrice >= 0.5 && s.visitorPrice <= 3)) return 'Visitor price must be between RM0.50 and RM3.00 per kWh.';
  return null;
}
```

```js
// FILE: engine/occupancy.js
import { baseOccupancy, visitorDemand } from '../data/demand.js';
import { visitorBaysFree } from './sharing.js';

// Share of a site's bays in use at `date`, split by who is using them.
export function occupancyAt(charger, date, condo = null) {
  const base = baseOccupancy(charger, date);
  if (charger.siteType !== 'condo' || !condo) return { resident: 0, visitor: 0, total: base };
  const free = visitorBaysFree(condo, base, date);
  const visitor = Math.min(visitorDemand(date), free / condo.bays);
  return { resident: base, visitor, total: Math.min(1, base + visitor) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sharing.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add engine/sharing.js engine/occupancy.js test/sharing.test.js
git commit -m "feat: add idle-hour sharing rules and occupancy model"
```

---

### Task 4: Recommendation optimiser and demand balancing

**Files:**
- Create: `engine/balance.js`, `engine/score.js`
- Test: `test/score.test.js`

**Interfaces:**
- Consumes: `CONST`; `distanceKm`, `driveMinutes`, `detourMinutes`; `priceAt`, `priceNote`; `isOpenToVisitors`, `visitorBaysFree`; `occupancyAt`
- Produces:
  - `MODES {urgent|balanced|saver: {label, wCost, wTime, wRisk}}`
  - `modeFor(pct)`, `rangeKm(car, pct)`, `waitMinutes(occ)`, `effectiveReliability(base, checkins)`, `formatDuration(min)`
  - `applyBalance(scored, mode) → {results, note}`
  - `rankChargers({chargers, condos, car, batteryPct, origin, destination, date, residentCondoId, needBy, occupancyFn}) → {mode, target, kWh, results[], excluded[{charger, reason, km}], balanceNote}`
  - Each result: `{charger, condo, isResident, isSharedVisit, km, arrival, price, kWh, cost, chargeMin, detourMin, waitMin, occupancy, reliability, timeMin, score, reasons[], balanced?}`

- [ ] **Step 1: Write the failing test**

```js
// FILE: test/score.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankChargers, modeFor, effectiveReliability, formatDuration } from '../engine/score.js';
import { applyBalance } from '../engine/balance.js';

const car = { batteryKwh: 60, efficiencyKwhPerKm: 0.15, acKw: 11, dcKw: 100, connectors: ['Type2', 'CCS2'] };
const origin = { lat: 3.2, lng: 101.7 };
const north = (km) => origin.lat + km / 111.32;
const mk = (id, km, extra = {}) => ({
  id, name: id, operator: 'Test', lat: north(km), lng: origin.lng, type: 'DC', kw: 100,
  connectors: ['CCS2'], bays: 4, siteType: 'public', reliability: 0.95, price: 1.3, ...extra,
});
const quiet = () => ({ resident: 0, visitor: 0, total: 0.2 });
const wed11 = new Date(2026, 9, 21, 11, 0);
const run = (chargers, batteryPct, extra = {}) =>
  rankChargers({ chargers, car, batteryPct, origin, date: wed11, occupancyFn: quiet, ...extra });

test('battery sets the mode', () => {
  assert.equal(modeFor(5), 'urgent');
  assert.equal(modeFor(15), 'urgent');
  assert.equal(modeFor(16), 'balanced');
  assert.equal(modeFor(50), 'balanced');
  assert.equal(modeFor(51), 'saver');
});

test('urgent: the nearest charger wins even when it costs more', () => {
  const r = run([mk('near', 1, { price: 1.8 }), mk('far', 5, { price: 1.2 })], 5);
  assert.equal(r.mode, 'urgent');
  assert.equal(r.results[0].charger.id, 'near');
});

test('saver: a cheaper charger further away wins', () => {
  const r = run([mk('near', 1, { price: 1.8 }), mk('far', 5, { price: 1.2 })], 70);
  assert.equal(r.mode, 'saver');
  assert.equal(r.results[0].charger.id, 'far');
  assert.ok(r.results[0].reasons.some((x) => x.startsWith('RM')));
});

test('plug mismatch and out-of-range chargers are excluded with reasons', () => {
  const r = run([mk('chademo', 1, { connectors: ['CHAdeMO'] }), mk('toofar', 100)], 20);
  assert.equal(r.results.length, 0);
  const reasons = Object.fromEntries(r.excluded.map((x) => [x.charger.id, x.reason]));
  assert.match(reasons.chademo, /Plug/);
  assert.match(reasons.toofar, /Out of range/);
});

test('condo bays: residents always, outsiders only while sharing is open', () => {
  const condo = { id: 'c1', bays: 10, residentPrice: 0.9, peakSurcharge: 0.1,
    sharing: { enabled: true, days: 'weekdays', start: 9, end: 17, reservedBays: 2, visitorPrice: 1.1 } };
  const site = mk('cs', 0.5, { type: 'AC', kw: 7, connectors: ['Type2'], siteType: 'condo', condoId: 'c1', bays: 10, price: null });
  const night = new Date(2026, 9, 21, 20, 0);
  const outsiderNight = run([site], 40, { condos: [condo], date: night });
  assert.match(outsiderNight.excluded[0].reason, /Residents only/);
  const residentNight = run([site], 40, { condos: [condo], date: night, residentCondoId: 'c1' });
  assert.equal(residentNight.results[0].isResident, true);
  assert.equal(residentNight.results[0].price, 1.0);
  const outsiderDay = run([site], 40, { condos: [condo] });
  assert.equal(outsiderDay.results[0].isSharedVisit, true);
  assert.equal(outsiderDay.results[0].price, 1.1);
  assert.ok(outsiderDay.results[0].reasons.includes('Shared condo bay'));
});

test('review focus: full battery needs no charge and produces no NaN', () => {
  const r = run([mk('a', 1), mk('b', 2)], 100);
  assert.equal(r.kWh, 0);
  assert.ok(r.results.every((c) => Number.isFinite(c.score) && c.cost === 0));
});

test('review focus: nothing reachable returns empty results with distances', () => {
  const r = run([mk('far', 100)], 5);
  assert.equal(r.results.length, 0);
  assert.ok(r.excluded[0].km > 90);
});

test('review focus: problem check-ins pull reliability down', () => {
  assert.equal(effectiveReliability(0.9, []), 0.9);
  assert.ok(effectiveReliability(0.9, Array(5).fill({ ok: false })) < 0.75);
  assert.ok(effectiveReliability(0.9, Array(5).fill({ ok: true })) > 0.9);
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '1 min');
  assert.equal(formatDuration(27), '27 min');
  assert.equal(formatDuration(60), '1 h');
  assert.equal(formatDuration(95), '1 h 35 min');
});

const c = (id, score, cost, occupancy) => ({ charger: { id, name: id }, score, cost, occupancy });

test('balance: saver demotes a busy top pick and explains the saving', () => {
  const { results, note } = applyBalance([c('busy', 0.2, 10, 0.9), c('quiet', 0.3, 8, 0.3)], 'saver');
  assert.equal(results[0].charger.id, 'quiet');
  assert.match(note, /busy charger at busy/);
  assert.match(note, /RM2\.00/);
});

test('balance: urgent never penalises, and no note when the top pick holds', () => {
  const urgent = applyBalance([c('busy', 0.2, 10, 0.9), c('quiet', 0.3, 8, 0.3)], 'urgent');
  assert.equal(urgent.results[0].charger.id, 'busy');
  assert.equal(urgent.note, null);
  const holds = applyBalance([c('busy', 0.1, 10, 0.9), c('quiet', 0.5, 8, 0.3)], 'saver');
  assert.equal(holds.results[0].charger.id, 'busy');
  assert.equal(holds.note, null);
});

test('rankChargers attaches the balance note end to end', () => {
  // Worked numbers: before balancing busy scores 0.121 and quiet 0.188; the +0.25 penalty flips them.
  const busyFirst = (ch) => ({ resident: 0, visitor: 0, total: ch.id === 'busy' ? 0.8 : 0.2 });
  const chargers = [mk('busy', 1, { price: 1.0 }), mk('quiet', 1.2, { price: 1.15 }), mk('far', 5, { price: 1.5 })];
  const r = run(chargers, 70, { occupancyFn: busyFirst });
  assert.equal(r.results[0].charger.id, 'quiet');
  assert.match(r.balanceNote, /low-battery drivers/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/score.test.js`
Expected: FAIL with `Cannot find module` for `../engine/score.js`.

- [ ] **Step 3: Implement**

```js
// FILE: engine/balance.js
export const BUSY = 0.8;
export const PENALTY = 0.25;

// In Saver mode, steer drivers away from nearly full chargers so low-battery drivers get them.
export function applyBalance(scored, mode) {
  if (mode !== 'saver' || scored.length === 0) return { results: scored, note: null };
  const before = scored[0];
  const results = scored
    .map((c) => (c.occupancy >= BUSY ? { ...c, score: c.score + PENALTY, balanced: true } : c))
    .sort((a, b) => a.score - b.score);
  const after = results[0];
  if (after.charger.id === before.charger.id) return { results, note: null };
  const saving = before.cost - after.cost;
  const tail = saving > 0.005 ? ` You save RM${saving.toFixed(2)}.` : '';
  return { results, note: `Leaving the busy charger at ${before.charger.name} for low-battery drivers.${tail}` };
}
```

```js
// FILE: engine/score.js
import { CONST } from '../config.js';
import { distanceKm, driveMinutes, detourMinutes } from './geo.js';
import { priceAt, priceNote } from './pricing.js';
import { isOpenToVisitors, visitorBaysFree } from './sharing.js';
import { occupancyAt } from './occupancy.js';
import { applyBalance } from './balance.js';

export const MODES = {
  urgent: { label: 'Urgent', wCost: 0.1, wTime: 0.6, wRisk: 0.3 },
  balanced: { label: 'Balanced', wCost: 0.4, wTime: 0.4, wRisk: 0.2 },
  saver: { label: 'Saver', wCost: 0.6, wTime: 0.25, wRisk: 0.15 },
};

// How much charging time counts against a charger, by when the driver needs the car.
const CHARGE_TIME_WEIGHT = { now: 1, '2h': 0.5, overnight: 0 };

export function modeFor(batteryPct) {
  if (batteryPct <= 15) return 'urgent';
  if (batteryPct <= 50) return 'balanced';
  return 'saver';
}

export function rangeKm(car, batteryPct) {
  return ((car.batteryKwh * batteryPct) / 100 / car.efficiencyKwhPerKm) * (1 - CONST.rangeBuffer);
}

export function waitMinutes(occupancy) {
  return occupancy < 0.6 ? 0 : ((Math.min(occupancy, 1) - 0.6) / 0.4) * 20;
}

// Blend a charger's base reliability with this device's check-ins (base counts as 20 visits).
export function effectiveReliability(base, checkins = []) {
  const worked = checkins.filter((c) => c.ok).length;
  return (base * 20 + worked) / (20 + checkins.length);
}

export function formatDuration(min) {
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function rankChargers({
  chargers, condos = [], car, batteryPct, origin, destination = null, date,
  residentCondoId = null, needBy = 'now', occupancyFn = occupancyAt,
}) {
  const mode = modeFor(batteryPct);
  const w = MODES[mode];
  const dest = destination || origin;
  const target = Math.min(100, Math.max(CONST.targetPct, batteryPct + 10));
  const kWh = Math.max(0, ((target - batteryPct) / 100) * car.batteryKwh);
  const range = rangeKm(car, batteryPct);
  const condoById = Object.fromEntries(condos.map((c) => [c.id, c]));
  const candidates = [];
  const excluded = [];

  for (const charger of chargers) {
    const condo = charger.condoId ? condoById[charger.condoId] || null : null;
    const isResident = !!condo && condo.id === residentCondoId;
    const km = distanceKm(origin, charger);
    const skip = (reason) => excluded.push({ charger, reason, km });

    if (!charger.connectors.some((p) => car.connectors.includes(p))) { skip('Plug not compatible'); continue; }
    if (km > range) { skip(`Out of range (${km.toFixed(1)} km)`); continue; }

    const arrival = new Date(date.getTime() + driveMinutes(km) * 60000);
    const occ = occupancyFn(charger, arrival, condo);
    if (condo && !isResident) {
      if (!isOpenToVisitors(condo, arrival)) { skip('Residents only right now'); continue; }
      if (visitorBaysFree(condo, occ.resident, arrival) <= 0) { skip('No visitor bays free'); continue; }
    }

    const power = charger.type === 'DC' ? Math.min(charger.kw, car.dcKw) : Math.min(charger.kw, car.acKw);
    const chargeMin = (kWh / power) * 60;
    const price = priceAt(charger, arrival, condo, isResident);
    const detourMin = detourMinutes(origin, charger, dest);
    const waitMin = waitMinutes(occ.total);
    candidates.push({
      charger, condo, isResident, isSharedVisit: !!condo && !isResident,
      km, arrival, price, kWh, cost: kWh * price, chargeMin, detourMin, waitMin,
      occupancy: occ.total, reliability: charger.reliability,
      timeMin: detourMin + waitMin + chargeMin * (CHARGE_TIME_WEIGHT[needBy] ?? 1),
    });
  }

  if (candidates.length) {
    const nCost = normaliser(candidates.map((c) => c.cost));
    const nTime = normaliser(candidates.map((c) => c.timeMin));
    for (const c of candidates) {
      c.score = w.wCost * nCost(c.cost) + w.wTime * nTime(c.timeMin) + w.wRisk * (1 - c.reliability);
      c.reasons = reasonsFor(c, target);
    }
    candidates.sort((a, b) => a.score - b.score);
  }
  const { results, note } = applyBalance(candidates, mode);
  return { mode, target, kWh, results, excluded, balanceNote: note };
}

function normaliser(values) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return (v) => (hi === lo ? 0 : (v - lo) / (hi - lo));
}

function reasonsFor(c, target) {
  const r = [`RM${c.cost.toFixed(2)} for ${Math.round(c.kWh)} kWh`];
  r.push(c.detourMin < 1 ? 'On your way' : `+${Math.round(c.detourMin)} min detour`);
  if (c.waitMin >= 1) r.push(`~${Math.round(c.waitMin)} min wait`);
  if (c.kWh > 0) r.push(`${formatDuration(c.chargeMin)} to ${target}%`);
  r.push(`${Math.round(c.reliability * 100)}% reliable`);
  const note = priceNote(c.charger, c.arrival, c.condo);
  if (note) r.push(note);
  if (c.isSharedVisit) r.push('Shared condo bay');
  if (c.isResident) r.push('Your condo bay');
  return r;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/score.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add engine/balance.js engine/score.js test/score.test.js
git commit -m "feat: add battery-aware optimiser with demand balancing"
```

---

### Task 5: Condo and township economics

**Files:**
- Create: `engine/economics.js`
- Test: `test/economics.test.js`

**Interfaces:**
- Consumes: `CONST`, `tnbRate`, `priceAt`, `occupancyAt`, `CONDOS`, `CHARGERS`
- Produces:
  - `co2AvoidedKg(kWh)`
  - `monthlyEconomics({residentKwh, visitorKwh, residentRevenue, visitorRevenue, electricityCost, jmbShare, units, bays}) → {kWhSold, revenue, electricityCost, margin, jmbIncome, perUnitSaving, paybackMonths|null, co2AvoidedKg}`
  - `simulateCondoMonth(condo, charger, start, {occupancyFn, days}) → monthlyEconomics + {residentKwh, visitorKwh, residentRevenue, visitorRevenue, residentByHour[24], visitorByHour[24], utilisation}`
  - `siteMonthlyKwh(charger, start, {occupancyFn, days})`
  - `townshipSummary(condos, chargers, start, {occupancyFn, days}) → {perCondo[{condo, ...sim}], totals{condoKwh, sdpSiteKwh, kWh, jmbIncome, co2Kg, condoBays, utilisation}}`
  - `scaleUp(totals, townships) → {townships, bays, jmbIncomeYear, co2TonnesYear, shareOfNationalTarget}`
  - `rampSeries(value) → number[6]`

- [ ] **Step 1: Write the failing test**

```js
// FILE: test/economics.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  co2AvoidedKg, monthlyEconomics, simulateCondoMonth, townshipSummary, scaleUp, rampSeries,
} from '../engine/economics.js';
import { CONDOS } from '../data/condos.js';
import { CHARGERS } from '../data/chargers.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('reference case from the research doc', () => {
  const e = monthlyEconomics({
    residentKwh: 8400, visitorKwh: 0, residentRevenue: 8400 * 0.9, visitorRevenue: 0,
    electricityCost: 8400 * 0.3, jmbShare: 0.7, units: 300, bays: 10,
  });
  close(e.margin, 5040);
  close(e.jmbIncome, 3528);
  close(e.perUnitSaving, 11.76);
  assert.equal(e.paybackMonths, 12);
});

test('no margin means no payback', () => {
  const e = monthlyEconomics({ residentKwh: 100, visitorKwh: 0, residentRevenue: 30, visitorRevenue: 0, electricityCost: 30, jmbShare: 0.7, units: 10, bays: 2 });
  assert.equal(e.paybackMonths, null);
});

test('CO2 avoided for 840 kWh is about 274 kg', () => close(co2AvoidedKg(840), 274.4, 0.1));

const condo = { id: 'c1', units: 300, bays: 10, jmbShare: 0.7, residentPrice: 0.9, peakSurcharge: 0.1,
  sharing: { enabled: true, days: 'weekdays', start: 9, end: 17, reservedBays: 2, visitorPrice: 1.1 } };
const site = { id: 'cs-c1', siteType: 'condo', condoId: 'c1', kw: 7, bays: 10, operator: 'x', price: null };
const oct = new Date(2026, 9, 1);

test('simulateCondoMonth with constant occupancy', () => {
  const sim = simulateCondoMonth(condo, site, oct, { occupancyFn: () => ({ resident: 0.2, visitor: 0, total: 0.2 }) });
  close(sim.residentKwh, 5040);
  close(sim.residentByHour[5], 7);
  close(sim.utilisation, 0.1);
  assert.equal(sim.visitorKwh, 0);
});

test('visitors raise JMB income', () => {
  const without = simulateCondoMonth(condo, site, oct, { occupancyFn: () => ({ resident: 0.2, visitor: 0, total: 0.2 }) });
  const withV = simulateCondoMonth(condo, site, oct, { occupancyFn: () => ({ resident: 0.2, visitor: 0.1, total: 0.3 }) });
  assert.ok(withV.jmbIncome > without.jmbIncome);
});

test('township totals and scale-up', () => {
  const condos = [condo, { ...condo, id: 'c2', bays: 6 }];
  const chargers = [site, { ...site, id: 'cs-c2', condoId: 'c2', bays: 6 }, { id: 'mall', siteType: 'mall', sdp: true, kw: 60, bays: 4 }];
  const t = townshipSummary(condos, chargers, oct, { occupancyFn: () => ({ resident: 0.2, visitor: 0, total: 0.2 }) });
  assert.equal(t.perCondo.length, 2);
  assert.equal(t.totals.condoBays, 16);
  assert.ok(t.totals.sdpSiteKwh > 0);
  close(t.totals.kWh, t.totals.condoKwh + t.totals.sdpSiteKwh);
  const s = scaleUp(t.totals, 28);
  assert.equal(s.bays, 448);
  close(s.shareOfNationalTarget, 448 / 30000);
  close(s.jmbIncomeYear, t.totals.jmbIncome * 12 * 28);
});

test('rampSeries ends at the current value', () => {
  const r = rampSeries(100);
  assert.equal(r.length, 6);
  assert.equal(r[5], 100);
  assert.ok(r[0] < r[5]);
});

test('simulated KL East: sharing condos earn more per unit than non-sharing ones', () => {
  const { perCondo } = townshipSummary(CONDOS, CHARGERS, oct);
  const avg = (rows) => rows.reduce((s, r) => s + r.perUnitSaving, 0) / rows.length;
  const sharing = perCondo.filter((r) => r.condo.sharing.enabled);
  const closed = perCondo.filter((r) => !r.condo.sharing.enabled);
  assert.ok(avg(sharing) > avg(closed), `${avg(sharing)} vs ${avg(closed)}`);
  for (const r of perCondo) assert.ok(r.perUnitSaving > 3 && r.perUnitSaving < 40, `${r.condo.id}: ${r.perUnitSaving}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/economics.test.js`
Expected: FAIL with `Cannot find module` for `../engine/economics.js`.

- [ ] **Step 3: Implement**

```js
// FILE: engine/economics.js
import { CONST } from '../config.js';
import { tnbRate } from '../data/tariff.js';
import { priceAt } from './pricing.js';
import { occupancyAt } from './occupancy.js';

export function co2AvoidedKg(kWh) {
  return (kWh / CONST.evKwhPerKm) * (CONST.petrolKgPerKm - CONST.evKwhPerKm * CONST.gridKgPerKwh);
}

export function monthlyEconomics({ residentKwh, visitorKwh, residentRevenue, visitorRevenue, electricityCost, jmbShare, units, bays }) {
  const kWhSold = residentKwh + visitorKwh;
  const revenue = residentRevenue + visitorRevenue;
  const margin = revenue - electricityCost;
  const jmbIncome = margin * jmbShare;
  return {
    kWhSold, revenue, electricityCost, margin, jmbIncome,
    perUnitSaving: jmbIncome / units,
    paybackMonths: margin > 0 ? Math.ceil((bays * CONST.hardwarePerBay) / margin) : null,
    co2AvoidedKg: co2AvoidedKg(kWhSold),
  };
}

function eachHour(start, days, fn) {
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) fn(new Date(start.getFullYear(), start.getMonth(), start.getDate() + d, h, 30), h);
  }
}

export function simulateCondoMonth(condo, charger, start, { occupancyFn = occupancyAt, days = 30 } = {}) {
  const residentByHour = Array(24).fill(0);
  const visitorByHour = Array(24).fill(0);
  let residentKwh = 0, visitorKwh = 0, residentRevenue = 0, visitorRevenue = 0, electricityCost = 0;
  const kwPerBay = charger.kw * CONST.drawFactor;

  eachHour(start, days, (t, h) => {
    const occ = occupancyFn(charger, t, condo);
    const rK = occ.resident * condo.bays * kwPerBay;
    const vK = occ.visitor * condo.bays * kwPerBay;
    residentKwh += rK;
    visitorKwh += vK;
    residentRevenue += rK * priceAt(charger, t, condo, true);
    visitorRevenue += vK * priceAt(charger, t, condo, false);
    electricityCost += (rK + vK) * tnbRate(t);
    residentByHour[h] += rK / days;
    visitorByHour[h] += vK / days;
  });

  const econ = monthlyEconomics({
    residentKwh, visitorKwh, residentRevenue, visitorRevenue, electricityCost,
    jmbShare: condo.jmbShare, units: condo.units, bays: condo.bays,
  });
  const utilisation = (residentKwh + visitorKwh) / (condo.bays * charger.kw * 24 * days);
  return { ...econ, residentKwh, visitorKwh, residentRevenue, visitorRevenue, residentByHour, visitorByHour, utilisation };
}

export function siteMonthlyKwh(charger, start, { occupancyFn = occupancyAt, days = 30 } = {}) {
  let kWh = 0;
  eachHour(start, days, (t) => { kWh += occupancyFn(charger, t, null).total * charger.bays * charger.kw * CONST.drawFactor; });
  return kWh;
}

export function townshipSummary(condos, chargers, start, opts = {}) {
  const perCondo = condos.map((condo) => {
    const charger = chargers.find((ch) => ch.condoId === condo.id);
    return { condo, ...simulateCondoMonth(condo, charger, start, opts) };
  });
  const sdpSiteKwh = chargers
    .filter((ch) => ch.siteType !== 'condo' && ch.sdp)
    .reduce((s, ch) => s + siteMonthlyKwh(ch, start, opts), 0);
  const condoKwh = perCondo.reduce((s, r) => s + r.kWhSold, 0);
  const condoBays = condos.reduce((s, c) => s + c.bays, 0);
  const utilisation = perCondo.reduce((s, r) => s + r.utilisation * r.condo.bays, 0) / condoBays;
  return {
    perCondo,
    totals: {
      condoKwh, sdpSiteKwh, kWh: condoKwh + sdpSiteKwh,
      jmbIncome: perCondo.reduce((s, r) => s + r.jmbIncome, 0),
      co2Kg: co2AvoidedKg(condoKwh + sdpSiteKwh),
      condoBays, utilisation,
    },
  };
}

export function scaleUp(totals, townships) {
  const bays = totals.condoBays * townships;
  return {
    townships, bays,
    jmbIncomeYear: totals.jmbIncome * 12 * townships,
    co2TonnesYear: (totals.co2Kg * 12 * townships) / 1000,
    shareOfNationalTarget: bays / CONST.nationalTarget2030,
  };
}

// Six months ending at `value`, a simple simulated ramp-up as EV ownership grows.
export function rampSeries(value) {
  return [0.62, 0.7, 0.78, 0.85, 0.93, 1].map((f) => value * f);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/economics.test.js`
Expected: PASS, 8 tests. If the last test fails because a condo's `perUnitSaving` is outside 3–40, tune that condo's `units` or `bays` in `data/condos.js` (keep the reference test untouched) and rerun.

- [ ] **Step 5: Commit**

```bash
git add engine/economics.js test/economics.test.js
git commit -m "feat: add condo and township economics"
```

---

### Task 6: State, world builder and formatting helpers

**Files:**
- Create: `state.js`, `engine/world.js`, `views/format.js`, `views/charts.js`
- Test: `test/state-world.test.js`

**Interfaces:**
- Consumes: `CONDOS`, `CHARGERS`, `effectiveReliability`
- Produces:
  - `loadState() → {checkins: {[chargerId]: [{ok, note, at}]}, booking: object|null, sharing: {[condoId]: sharing}}`; `saveState(state)`; `resetState() → blank state`
  - `buildWorld(state, condos = CONDOS, chargers = CHARGERS) → {condos, chargers}`
  - `esc(s)`, `rm(n)`, `rm0(n)`, `num(n)`, `pct(x)`, `fmtTime(date)`, `monthLabel(date)`
  - `barChart24({a, b, shade, aLabel, bLabel}) → html`, `lineChart({labels, series:[{label, values, cls}]}) → html`

- [ ] **Step 1: Write the failing test**

```js
// FILE: test/state-world.test.js
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadState, saveState, resetState } from '../state.js';
import { buildWorld } from '../engine/world.js';
import { esc, rm, rm0, pct } from '../views/format.js';
import { barChart24, lineChart } from '../views/charts.js';

const setStorage = (value) => Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
afterEach(() => setStorage(undefined));

test('review focus: corrupt storage falls back to blank state', () => {
  setStorage({ getItem: () => '{bad json', setItem() {}, removeItem() {} });
  const s = loadState();
  assert.deepEqual(s, { checkins: {}, booking: null, sharing: {} });
});

test('review focus: storage that throws never breaks saving or reset', () => {
  setStorage({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } });
  const s = loadState();
  s.booking = { chargerId: 'x' };
  assert.doesNotThrow(() => saveState(s));
  assert.equal(loadState().booking.chargerId, 'x'); // kept in memory
  assert.deepEqual(resetState(), { checkins: {}, booking: null, sharing: {} });
});

test('saved state round-trips through storage', () => {
  const store = {};
  setStorage({ getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } });
  const s = resetState();
  s.sharing.lumina = { enabled: false };
  saveState(s);
  assert.equal(loadState().sharing.lumina.enabled, false);
});

test('buildWorld applies sharing overrides and check-ins', () => {
  const condos = [{ id: 'c1', bays: 10, sharing: { enabled: true, days: 'weekdays', start: 9, end: 17, reservedBays: 2, visitorPrice: 1.1 } }];
  const chargers = [{ id: 'x', reliability: 0.9 }];
  const state = { checkins: { x: Array(5).fill({ ok: false }) }, booking: null, sharing: { c1: { start: 10 } } };
  const w = buildWorld(state, condos, chargers);
  assert.equal(w.condos[0].sharing.start, 10);
  assert.equal(w.condos[0].sharing.end, 17);
  assert.ok(w.chargers[0].reliability < 0.75);
  assert.equal(condos[0].sharing.start, 9); // source data untouched
});

test('format helpers', () => {
  assert.equal(esc('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
  assert.equal(rm(1.1), 'RM1.10');
  assert.equal(rm0(3528.4), 'RM3,528');
  assert.equal(pct(0.294), '29%');
});

test('charts render one bar pair per hour and one path per series', () => {
  const svg = barChart24({ a: Array(24).fill(1), b: Array(24).fill(0.5), shade: [14, 15], aLabel: 'Residents', bLabel: 'Visitors' });
  assert.equal((svg.match(/class="sa"/g) || []).length, 24);
  assert.equal((svg.match(/class="sb"/g) || []).length, 24);
  assert.equal((svg.match(/class="shade"/g) || []).length, 2);
  const line = lineChart({ labels: ['May', 'Jun'], series: [{ label: 'A', values: [1, 2], cls: 'la' }, { label: 'B', values: [0, 1], cls: 'lb' }] });
  assert.equal((line.match(/<path /g) || []).length, 2);
  assert.ok(!svg.includes('NaN') && !line.includes('NaN'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/state-world.test.js`
Expected: FAIL with `Cannot find module` for `../state.js`.

- [ ] **Step 3: Implement**

```js
// FILE: state.js
// Per-device demo state. Every storage call is guarded so private windows and blocked storage still work.
const KEY = 'cascas.v1';
const blank = () => ({ checkins: {}, booking: null, sharing: {} });
let memory = blank();

export function loadState() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) memory = { ...blank(), ...JSON.parse(raw) };
  } catch {
    // Corrupt JSON or blocked storage: keep what is in memory.
  }
  return memory;
}

export function saveState(state) {
  memory = state;
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(state)); } catch { /* memory only */ }
}

export function resetState() {
  memory = blank();
  try { globalThis.localStorage?.removeItem(KEY); } catch { /* memory only */ }
  return memory;
}
```

Note: the corrupt-storage test expects a blank state, and `memory` starts blank, so the catch path returns blank. The throwing-storage test relies on `memory` holding the last saved object.

```js
// FILE: engine/world.js
import { CONDOS } from '../data/condos.js';
import { CHARGERS } from '../data/chargers.js';
import { effectiveReliability } from './score.js';

// Apply this device's JMB settings and check-ins on top of the simulated data.
export function buildWorld(state, condos = CONDOS, chargers = CHARGERS) {
  return {
    condos: condos.map((c) => ({ ...c, sharing: { ...c.sharing, ...(state.sharing[c.id] || {}) } })),
    chargers: chargers.map((ch) => ({ ...ch, reliability: effectiveReliability(ch.reliability, state.checkins[ch.id]) })),
  };
}
```

```js
// FILE: views/format.js
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
export const rm = (n) => `RM${Number(n).toFixed(2)}`;
export const rm0 = (n) => `RM${Math.round(n).toLocaleString('en-MY')}`;
export const num = (n) => Math.round(n).toLocaleString('en-MY');
export const pct = (x) => `${Math.round(x * 100)}%`;
export const fmtTime = (d) => d.toLocaleString('en-MY', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
export const monthLabel = (d) => d.toLocaleString('en-MY', { month: 'short' });
```

```js
// FILE: views/charts.js
// Small hand-built SVG charts. Colours come from CSS classes so both themes work.
const W = 640;
const H = 220;
const P = { l: 52, r: 12, t: 12, b: 28 };

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

function short(v, money) {
  const s = v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `${Math.round(v)}`;
  return money ? `RM${s}` : s;
}

function legend(items) {
  return `<div class="legend">${items.map(([label, cls]) => `<span><i class="key ${cls}"></i>${label}</span>`).join('')}</div>`;
}

function hourLabel(h) {
  return h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
}

export function barChart24({ a, b, shade = [], aLabel, bLabel }) {
  const max = niceMax(Math.max(...a.map((v, i) => v + b[i]), 1));
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;
  const bw = iw / 24;
  const y = (v) => P.t + ih - (v / max) * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${aLabel} and ${bLabel}, kWh by hour of day">`;
  for (const h of shade) s += `<rect x="${P.l + h * bw}" y="${P.t}" width="${bw}" height="${ih}" class="shade"/>`;
  for (const t of [0, max / 2, max]) {
    s += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/>`;
    s += `<text x="${P.l - 6}" y="${y(t) + 4}" class="axis" text-anchor="end">${short(t, false)} kWh</text>`;
  }
  a.forEach((v, i) => {
    const x = P.l + i * bw + 2;
    const w = Math.max(1, bw - 4);
    s += `<rect x="${x}" y="${y(v)}" width="${w}" height="${P.t + ih - y(v)}" class="sa"/>`;
    s += `<rect x="${x}" y="${y(v + b[i])}" width="${w}" height="${y(v) - y(v + b[i])}" class="sb"/>`;
  });
  for (const h of [0, 6, 12, 18]) s += `<text x="${P.l + h * bw + bw / 2}" y="${H - 8}" class="axis" text-anchor="middle">${hourLabel(h)}</text>`;
  return `${s}</svg>${legend([[aLabel, 'sa'], [bLabel, 'sb']])}`;
}

export function lineChart({ labels, series }) {
  const max = niceMax(Math.max(...series.flatMap((se) => se.values), 1));
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;
  const x = (i) => P.l + (labels.length === 1 ? iw / 2 : (i * iw) / (labels.length - 1));
  const y = (v) => P.t + ih - (v / max) * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Monthly income by source">`;
  for (const t of [0, max / 2, max]) {
    s += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/>`;
    s += `<text x="${P.l - 6}" y="${y(t) + 4}" class="axis" text-anchor="end">${short(t, true)}</text>`;
  }
  for (const se of series) {
    const d = se.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    s += `<path d="${d}" class="line ${se.cls}"/>`;
    const last = se.values.length - 1;
    s += `<circle cx="${x(last)}" cy="${y(se.values[last])}" r="4" class="dot ${se.cls}"/>`;
  }
  labels.forEach((l, i) => { s += `<text x="${x(i)}" y="${H - 8}" class="axis" text-anchor="middle">${l}</text>`; });
  return `${s}</svg>${legend(series.map((se) => [se.label, se.cls]))}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/state-world.test.js`
Expected: PASS, 6 tests. Then run the whole suite: `npm test`. Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add state.js engine/world.js views/format.js views/charts.js test/state-world.test.js
git commit -m "feat: add demo state, world builder, formatting and SVG charts"
```

---

### Task 7: App shell, styles and router

**Files:**
- Create: `index.html`, `styles.css`, `app.js`, stub `views/driver.js`, `views/jmb.js`, `views/sdp.js` (replaced in Tasks 8–10)

**Interfaces:**
- Consumes: `APP`, `CLOCK_PRESETS`, `loadState`, `saveState`, `resetState`, `buildWorld`
- Produces: the view contract used by Tasks 8–10:
  - `renderDriver(root, ctx)`, `renderJmb(root, ctx)`, `renderSdp(root, ctx)`
  - `resetDriver()` exported from `views/driver.js`
  - `ctx = { state, clock: Date, world: {condos, chargers}, save(): void, rerender(): void }`

- [ ] **Step 1: Write the shell**

```html
<!-- FILE: index.html -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>CasCas · KL East</title>
  <meta name="description" content="Shared EV charging for SDP townships: battery-aware routing, idle-hour condo sharing and JMB income.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@500;600;700&family=Public+Sans:wght@400;600&family=JetBrains+Mono:wght@400;600&display=swap">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="top">
    <div class="brand">
      <svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>
      <div><b data-app-name>CasCas</b><small data-tagline></small></div>
    </div>
    <nav class="roles" aria-label="Choose a view">
      <a href="#driver" data-role="driver">Driver</a>
      <a href="#jmb" data-role="jmb">JMB</a>
      <a href="#sdp" data-role="sdp">SDP</a>
    </nav>
    <div class="clock">
      <label for="clock-preset">Demo time</label>
      <select id="clock-preset"></select>
      <input id="clock-custom" type="datetime-local" hidden aria-label="Custom demo time">
    </div>
  </header>
  <main id="view"></main>
  <footer class="foot">
    <span>Prototype for the Sime Darby Property University Hackathon 2026. All data simulated; condo names are fictional.</span>
    <button id="reset" class="btn small" type="button">Reset demo</button>
  </footer>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script type="module" src="app.js"></script>
</body>
</html>
```

```css
/* FILE: styles.css */
/* Layout: sticky top bar (brand · role tabs · demo clock). Driver = trip | map | picks on desktop, stacked on phones.
   Dashboards = KPI row then two-column cards. Accent teal for "go", amber for visitors/shared, red for busy. */
:root {
  --bg: #F2F5F4; --surface: #FFFFFF; --fg: #11201D; --muted: #4D5C57; --line: #D3DDD9;
  --accent: #0B675A; --accent-ink: #FFFFFF; --accent-soft: #DCEFEA;
  --amber: #B7791F; --amber-soft: #FBEFD9; --busy: #B42318; --busy-soft: #FBE4E1; --off: #7F8C88;
  --shade: rgba(183, 121, 31, 0.10);
  --display: "Familjen Grotesk", ui-sans-serif, system-ui, sans-serif;
  --body: "Public Sans", ui-sans-serif, system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, Consolas, monospace;
  --radius: 10px;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0D1513; --surface: #14201D; --fg: #E3ECE9; --muted: #9DADA7; --line: #283632;
    --accent: #4CC3AE; --accent-ink: #062520; --accent-soft: #163A33;
    --amber: #F0B45A; --amber-soft: #3A2C14; --busy: #F2877C; --busy-soft: #3A1C19; --off: #6E7C78;
    --shade: rgba(240, 180, 90, 0.10);
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0D1513; --surface: #14201D; --fg: #E3ECE9; --muted: #9DADA7; --line: #283632;
  --accent: #4CC3AE; --accent-ink: #062520; --accent-soft: #163A33;
  --amber: #F0B45A; --amber-soft: #3A2C14; --busy: #F2877C; --busy-soft: #3A1C19; --off: #6E7C78;
  --shade: rgba(240, 180, 90, 0.10);
  color-scheme: dark;
}

* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--fg); font: 15px/1.55 var(--body); min-height: 100vh; display: flex; flex-direction: column; }
h1, h2, h3 { font-family: var(--display); line-height: 1.2; margin: 0; text-wrap: balance; }
h2 { font-size: 1.35rem; }
h3 { font-size: 1.05rem; }
p { margin: 0; }
a { color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.muted { color: var(--muted); font-size: 0.9rem; }
.eyebrow { font: 600 0.72rem/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.num, .kpi b, .stats dd { font-variant-numeric: tabular-nums; }

/* Top bar */
.top { position: sticky; top: 0; z-index: 1000; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 20px;
  padding: 10px 16px; padding-top: calc(10px + env(safe-area-inset-top, 0px)); background: var(--surface); border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 10px; margin-right: auto; }
.brand b { font: 700 1.25rem/1 var(--display); display: block; }
.brand small { color: var(--muted); font-size: 0.78rem; }
.logo { width: 30px; height: 30px; fill: var(--accent-ink); background: var(--accent); border-radius: 8px; padding: 4px; }
.roles { display: flex; background: var(--bg); border: 1px solid var(--line); border-radius: 999px; padding: 3px; }
.roles a { padding: 6px 16px; border-radius: 999px; text-decoration: none; color: var(--muted); font-weight: 600; }
.roles a[aria-current="page"] { background: var(--accent); color: var(--accent-ink); }
.clock { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.clock label { font: 600 0.72rem/1 var(--mono); text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }

select, input[type="number"], input[type="text"], input[type="datetime-local"] {
  font: inherit; color: var(--fg); background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; min-width: 0; }
input[type="range"] { width: 100%; accent-color: var(--accent); }

main { flex: 1; width: 100%; max-width: 1280px; margin: 0 auto; padding: 18px 16px 32px; }
.foot { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--line); color: var(--muted); font-size: 0.82rem; }

.btn { font: 600 0.92rem/1 var(--body); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); color: var(--fg); cursor: pointer; }
.btn:hover { border-color: var(--accent); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.btn.small { padding: 7px 10px; font-size: 0.82rem; }
.btn-row { display: flex; flex-wrap: wrap; gap: 8px; }

.panel, .card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; min-width: 0; }
.field { display: grid; gap: 4px; font-size: 0.88rem; font-weight: 600; }
.field output { font-family: var(--mono); color: var(--accent); }
.field.inline { display: flex; align-items: center; gap: 8px; }
.seg { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 6px 14px; }
.seg legend { width: 100%; margin-bottom: 4px; }
.seg label { font-weight: 400; display: flex; align-items: center; gap: 4px; }
.notice { padding: 10px 12px; background: var(--amber-soft); border-radius: 8px; font-size: 0.88rem; }
.error { color: var(--busy); font-weight: 600; font-size: 0.88rem; }

/* Driver */
.driver { display: grid; gap: 16px; grid-template-columns: 300px minmax(0, 1fr) 360px; align-items: start; }
.trip { display: grid; gap: 14px; }
.map-wrap { min-width: 0; position: sticky; top: 76px; }
.map { height: calc(100vh - 150px); min-height: 420px; border-radius: var(--radius); border: 1px solid var(--line); }
.results { display: grid; gap: 12px; }
.res-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.mode { font: 600 0.72rem/1 var(--mono); text-transform: uppercase; letter-spacing: 0.06em; padding: 5px 8px; border-radius: 6px; }
.mode-urgent { background: var(--busy-soft); color: var(--busy); }
.mode-balanced { background: var(--accent-soft); color: var(--accent); }
.mode-saver { background: var(--amber-soft); color: var(--amber); }
.balance { background: var(--amber-soft); border-radius: 8px; padding: 10px 12px; font-size: 0.9rem; }
.flash { background: var(--accent-soft); border-radius: 8px; padding: 10px 12px; font-size: 0.9rem; }
.pick { border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; display: grid; gap: 10px; }
.pick.first { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.pick-top { display: flex; gap: 10px; align-items: flex-start; }
.rank { font: 700 1rem/1 var(--mono); width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%; background: var(--accent-soft); color: var(--accent); flex: none; }
.reasons { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.reasons li { font-size: 0.8rem; padding: 3px 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); }
.empty { padding: 14px; border: 1px dashed var(--line); border-radius: var(--radius); }
.excluded summary { cursor: pointer; color: var(--muted); font-size: 0.88rem; }
.excluded ul { margin: 8px 0 0; padding-left: 18px; font-size: 0.85rem; color: var(--muted); }
.meter { height: 14px; background: var(--bg); border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
.meter span { display: block; height: 100%; background: var(--accent); transition: width 0.4s; }
.stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; }
.stats div { background: var(--bg); border-radius: 8px; padding: 8px 10px; }
.stats dt { font-size: 0.78rem; color: var(--muted); }
.stats dd { margin: 0; font: 600 1.1rem/1.3 var(--mono); }
.qr { width: 132px; height: 132px; padding: 8px; background: #FFFFFF; border-radius: 8px; border: 1px solid var(--line); }
.qr rect { fill: #11201D; }

/* Map pins */
.pin-wrap { background: none; border: 0; }
.pin { display: inline-flex; align-items: center; gap: 4px; transform: translate(-50%, -100%); white-space: nowrap;
  font: 600 0.75rem/1 var(--mono); padding: 5px 7px; border-radius: 999px; background: var(--surface); color: var(--fg);
  border: 1px solid var(--line); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25); }
.pin.pick { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.pin.busy { background: var(--busy-soft); color: var(--busy); border-color: var(--busy); }
.pin.off { opacity: 0.55; }
.pin .tag { font: 600 0.62rem/1 var(--body); background: var(--amber); color: #1D1300; border-radius: 999px; padding: 2px 5px; }
.leaflet-container { font-family: var(--body); background: var(--bg); }
.me { fill: #2563EB; fill-opacity: 1; stroke: #FFFFFF; stroke-width: 3; }

/* Dashboards */
.view-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 12px; margin-bottom: 16px; }
.view-head h2 { font-size: 1.7rem; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.kpi { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; display: grid; gap: 6px; }
.kpi span { font-size: 0.82rem; color: var(--muted); }
.kpi b { font: 700 1.6rem/1.1 var(--display); }
.kpi.hero { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.kpi.hero span { color: var(--accent-ink); opacity: 0.85; }
.grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
.card { display: grid; gap: 12px; align-content: start; }
.big { font-size: 1.1rem; }
.bar { height: 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--amber); }
.form { display: grid; gap: 12px; }
.row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.check { display: flex; gap: 8px; align-items: center; font-weight: 600; }
.tbl { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font: 600 0.72rem/1.2 var(--mono); text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
.chip { font-size: 0.75rem; font-weight: 600; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
.chip.on { background: var(--accent-soft); color: var(--accent); }
.chip.off { background: var(--bg); color: var(--muted); border: 1px solid var(--line); }
.chip.warn { background: var(--busy-soft); color: var(--busy); }
.chip.amber { background: var(--amber-soft); color: var(--amber); }
.checklist { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.checklist li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; }
.checklist .note { grid-column: 2; color: var(--muted); font-size: 0.85rem; }

/* Charts */
.chart { width: 100%; height: auto; display: block; }
.chart .grid { stroke: var(--line); stroke-width: 1; }
.chart .axis { fill: var(--muted); font: 11px var(--mono); }
.chart .shade { fill: var(--shade); }
.chart .sa { fill: var(--accent); }
.chart .sb { fill: var(--amber); }
.chart .line { fill: none; stroke-width: 2.5; }
.chart .line.la { stroke: var(--accent); }
.chart .line.lb { stroke: var(--amber); }
.chart .dot.la { fill: var(--accent); }
.chart .dot.lb { fill: var(--amber); }
.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 0.82rem; color: var(--muted); }
.key { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.key.sa, .key.la { background: var(--accent); }
.key.sb, .key.lb { background: var(--amber); }

@media (max-width: 1100px) {
  .driver { grid-template-columns: 300px minmax(0, 1fr); }
  .results { grid-column: 1 / -1; }
}
@media (max-width: 760px) {
  .driver, .grid2 { grid-template-columns: 1fr; }
  .map-wrap { position: static; }
  .map { height: 340px; min-height: 0; }
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .roles { order: 3; width: 100%; justify-content: space-between; }
  .roles a { flex: 1; text-align: center; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
```

```js
// FILE: app.js
import { APP } from './config.js';
import { CLOCK_PRESETS } from './data/places.js';
import { loadState, saveState, resetState } from './state.js';
import { buildWorld } from './engine/world.js';
import { renderDriver, resetDriver } from './views/driver.js';
import { renderJmb } from './views/jmb.js';
import { renderSdp } from './views/sdp.js';

const VIEWS = { driver: renderDriver, jmb: renderJmb, sdp: renderSdp };
let state = loadState();
let clock = CLOCK_PRESETS[0].date();

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
  const ctx = { state, clock, world: buildWorld(state), save: () => saveState(state), rerender: render };
  VIEWS[role](document.getElementById('view'), ctx);
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
```

Temporary stubs, so the shell loads before Tasks 8–10:

```js
// FILE: views/driver.js
export function resetDriver() {}
export function renderDriver(root) { root.innerHTML = '<p class="muted">Driver view coming in Task 8.</p>'; }
```

```js
// FILE: views/jmb.js
export function renderJmb(root) { root.innerHTML = '<p class="muted">JMB view coming in Task 9.</p>'; }
```

```js
// FILE: views/sdp.js
export function renderSdp(root) { root.innerHTML = '<p class="muted">SDP view coming in Task 10.</p>'; }
```

- [ ] **Step 2: Serve and check in a browser**

Run (background): `python -m http.server 8765 --directory C:/Users/ASUS/cascas`
Open `http://localhost:8765/`. Expected: header with the bolt logo, "CasCas", tagline, Driver/JMB/SDP tabs, demo-time select defaulting to "Wed 11 AM · sharing open". Clicking tabs swaps the stub text and highlights the tab. No console errors.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all tests still pass.

- [ ] **Step 4: Commit**

```bash
git add index.html styles.css app.js views/driver.js views/jmb.js views/sdp.js
git commit -m "feat: add app shell, theme and role router"
```

---

### Task 8: Driver screen

**Files:**
- Modify (replace stub): `views/driver.js`

**Interfaces:**
- Consumes: `CARS`, `PLACES`, `START`, `rankChargers`, `MODES`, `formatDuration`, `priceAt`, `isOpenToVisitors`, `occupancyAt`, `CONST`, `esc`, `rm`, `fmtTime`, global `L` (Leaflet)
- Produces: `renderDriver(root, ctx)`, `resetDriver()`

- [ ] **Step 1: Write the driver view**

```js
// FILE: views/driver.js
import { CONST } from '../config.js';
import { CARS } from '../data/cars.js';
import { PLACES, START } from '../data/places.js';
import { rankChargers, MODES, formatDuration } from '../engine/score.js';
import { priceAt } from '../engine/pricing.js';
import { isOpenToVisitors } from '../engine/sharing.js';
import { occupancyAt } from '../engine/occupancy.js';
import { esc, rm, fmtTime } from './format.js';

const NEED = [['now', 'Now'], ['2h', 'Within 2 h'], ['overnight', 'Overnight']];
const fresh = () => ({ carId: 'emas7', battery: 35, placeId: 'klem', homeId: '', needBy: 'now', stage: 'pick', pick: null, flash: '' });
let ui = fresh();
let map = null;
let layer = null;
let timer = null;

export function resetDriver() {
  stopTimer();
  ui = fresh();
}

export function renderDriver(root, ctx) {
  stopTimer();
  if (map) { map.remove(); map = null; }
  const { condos } = ctx.world;
  root.innerHTML = `
  <div class="driver">
    <section class="panel trip" aria-label="Trip">
      <h2>Plan a charge</h2>
      <label class="field">Car
        <select id="d-car">${CARS.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      <label class="field">Battery now <output id="d-batt-out"></output>
        <input id="d-batt" type="range" min="5" max="100" step="1"></label>
      <label class="field">Going to
        <select id="d-place">${PLACES.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field">I live at
        <select id="d-home"><option value="">Not a resident here</option>${condos.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      <fieldset class="field seg"><legend>Need the car</legend>
        ${NEED.map(([v, l]) => `<label><input type="radio" name="d-need" value="${v}"> ${l}</label>`).join('')}
      </fieldset>
      <p class="muted">Demo time: ${esc(fmtTime(ctx.clock))}. Change it at the top to see prices and sharing change.</p>
    </section>
    <section class="map-wrap">
      <div id="d-map" class="map" aria-label="Map of chargers around KL East"></div>
      <p id="d-map-fallback" class="notice" hidden>The map could not load. The list of picks still works.</p>
    </section>
    <section class="panel results" id="d-results" aria-live="polite"></section>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  $('#d-car').value = ui.carId;
  $('#d-batt').value = ui.battery;
  $('#d-place').value = ui.placeId;
  $('#d-home').value = ui.homeId;
  $(`input[name="d-need"][value="${ui.needBy}"]`).checked = true;

  $('#d-car').addEventListener('change', (e) => { ui.carId = e.target.value; update(root, ctx); });
  $('#d-batt').addEventListener('input', (e) => { ui.battery = Number(e.target.value); update(root, ctx); });
  $('#d-place').addEventListener('change', (e) => { ui.placeId = e.target.value; update(root, ctx); });
  $('#d-home').addEventListener('change', (e) => { ui.homeId = e.target.value; update(root, ctx); });
  root.querySelectorAll('input[name="d-need"]').forEach((r) => r.addEventListener('change', (e) => { ui.needBy = e.target.value; update(root, ctx); }));

  initMap($('#d-map'), $('#d-map-fallback'));
  update(root, ctx);
  if (ui.stage === 'charging') startTimer(root, ctx);
}

function compute(ctx) {
  const car = CARS.find((c) => c.id === ui.carId);
  const home = ctx.world.condos.find((c) => c.id === ui.homeId) || null;
  const origin = home ? { lat: home.lat, lng: home.lng } : START;
  const place = PLACES.find((p) => p.id === ui.placeId);
  const destination = place.id === 'here' ? null : place;
  const ranking = rankChargers({
    ...ctx.world, car, batteryPct: ui.battery, origin, destination, date: ctx.clock,
    residentCondoId: ui.homeId || null, needBy: ui.needBy,
  });
  return { car, origin, ranking };
}

function update(root, ctx) {
  const { car, origin, ranking } = compute(ctx);
  root.querySelector('#d-batt-out').textContent = `${ui.battery}%`;
  drawMarkers(ctx, origin, ranking);
  const box = root.querySelector('#d-results');
  box.innerHTML = ui.stage === 'pick' ? pickHtml(ranking, ctx) : stageHtml(ctx);
  bind(root, ctx, ranking, car);
}

function modeLine(mode) {
  if (mode === 'urgent') return 'Low battery, so the nearest working charger comes first';
  if (mode === 'saver') return 'Plenty of charge, so cheaper and quieter chargers come first';
  return 'Balancing price, time and reliability';
}

function pickHtml(r, ctx) {
  const flash = ui.flash ? `<p class="flash">${esc(ui.flash)}</p>` : '';
  const head = `${flash}<div class="res-head"><h2>Best picks</h2><span class="mode mode-${r.mode}">${MODES[r.mode].label}</span></div>
    <p class="muted">${modeLine(r.mode)}. Charging to ${r.target}% (${Math.round(r.kWh)} kWh) · ${esc(fmtTime(ctx.clock))}</p>`;
  if (r.kWh < 1) return `${head}<p class="empty">Your battery is at ${ui.battery}%. No charge needed for this trip.</p>`;
  const top = r.results.slice(0, 3);
  if (!top.length) {
    const nearest = [...r.excluded].sort((a, b) => a.km - b.km)[0];
    const hint = nearest ? ` The nearest is ${esc(nearest.charger.name)}, ${nearest.km.toFixed(1)} km away.` : '';
    return `${head}<p class="empty">No charger is in range at ${ui.battery}%.${hint} Call your roadside assistance for a mobile charge.</p>`;
  }
  const note = r.balanceNote ? `<p class="balance"><b>Demand balancing.</b> ${esc(r.balanceNote)}</p>` : '';
  const cards = top.map((c, i) => `
    <article class="pick ${i === 0 ? 'first' : ''}">
      <div class="pick-top"><span class="rank">${i + 1}</span>
        <div><h3>${esc(c.charger.name)}</h3>
        <p class="muted">${esc(c.charger.operator)} · ${c.charger.type} ${c.charger.kw} kW · ${rm(c.price)}/kWh</p></div></div>
      <ul class="reasons">${c.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <button class="btn ${i === 0 ? 'primary' : ''}" type="button" data-book="${c.charger.id}">Book this bay</button>
    </article>`).join('');
  const off = r.excluded.length
    ? `<details class="excluded"><summary>${r.excluded.length} chargers not suitable right now</summary><ul>${r.excluded.map((x) => `<li>${esc(x.charger.name)}: ${esc(x.reason)}</li>`).join('')}</ul></details>`
    : '';
  return head + note + cards + off;
}

function stageHtml(ctx) {
  const p = ui.pick;
  if (ui.stage === 'booked') {
    const until = new Date(p.bookedAt + CONST.holdMinutes * 60000);
    return `<h2>Bay held</h2>
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

function bind(root, ctx, ranking, car) {
  const box = root.querySelector('#d-results');
  box.querySelectorAll('[data-book]').forEach((btn) => btn.addEventListener('click', () => {
    const c = ranking.results.find((x) => x.charger.id === btn.dataset.book);
    const power = c.charger.type === 'DC' ? Math.min(c.charger.kw, car.dcKw) : Math.min(c.charger.kw, car.acKw);
    ui.pick = {
      chargerId: c.charger.id, name: c.charger.name, price: c.price, kWhTarget: c.kWh, power,
      batteryKwh: car.batteryKwh, startPct: ui.battery, bookedAt: ctx.clock.getTime(),
      session: { kWh: 0, minutes: 0 },
    };
    ui.stage = 'booked';
    ui.flash = '';
    ctx.state.booking = { chargerId: c.charger.id, at: ctx.clock.getTime() };
    ctx.save();
    update(root, ctx);
  }));
  const act = (name, fn) => { const b = box.querySelector(`[data-act="${name}"]`); if (b) b.addEventListener('click', fn); };
  act('start', () => { ui.stage = 'charging'; update(root, ctx); startTimer(root, ctx); });
  act('cancel', () => { ui.stage = 'pick'; ui.pick = null; ctx.state.booking = null; ctx.save(); update(root, ctx); });
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

function startTimer(root, ctx) {
  stopTimer();
  timer = setInterval(() => {
    const p = ui.pick;
    if (!p || ui.stage !== 'charging') { stopTimer(); return; }
    p.session.minutes += 1;
    p.session.kWh = Math.min(p.kWhTarget, p.session.kWh + p.power / 60);
    if (p.session.kWh >= p.kWhTarget) { stopTimer(); ui.stage = 'done'; }
    const box = root.querySelector('#d-results');
    if (!box) { stopTimer(); return; }
    update(root, ctx);
  }, 1000);
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

function initMap(el, fallback) {
  if (!window.L) { el.hidden = true; fallback.hidden = false; return; }
  map = L.map(el, { scrollWheelZoom: true }).setView([3.2135, 101.7265], 14);
  const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  tiles.on('tileerror', () => { fallback.hidden = false; });
  layer = L.layerGroup().addTo(map);
}

function drawMarkers(ctx, origin, r) {
  if (!map) return;
  layer.clearLayers();
  const top = new Set(r.results.slice(0, 3).map((c) => c.charger.id));
  const off = new Map(r.excluded.map((x) => [x.charger.id, x.reason]));
  const byId = new Map(r.results.map((c) => [c.charger.id, c]));
  for (const ch of ctx.world.chargers) {
    const condo = ctx.world.condos.find((c) => c.id === ch.condoId) || null;
    const isRes = !!condo && condo.id === ui.homeId;
    const res = byId.get(ch.id);
    const price = res ? res.price : priceAt(ch, ctx.clock, condo, isRes);
    const occ = res ? res.occupancy : occupancyAt(ch, ctx.clock, condo).total;
    const cls = top.has(ch.id) ? 'pick' : off.has(ch.id) ? 'off' : (occ >= 0.8 || ch.reliability < 0.75) ? 'busy' : 'ok';
    const shared = condo && !isRes && isOpenToVisitors(condo, ctx.clock) ? '<b class="tag">Shared now</b>' : '';
    const html = `<span class="pin ${cls}">${ch.type === 'DC' ? '⚡' : ''}${rm(price)}${shared}</span>`;
    const tip = `${esc(ch.name)}<br>${esc(ch.operator)} · ${ch.type} ${ch.kw} kW · ${Math.round(occ * 100)}% busy${off.has(ch.id) ? `<br>${esc(off.get(ch.id))}` : ''}`;
    L.marker([ch.lat, ch.lng], { icon: L.divIcon({ html, className: 'pin-wrap', iconSize: null }) }).bindTooltip(tip).addTo(layer);
  }
  L.circleMarker([origin.lat, origin.lng], { radius: 8, className: 'me' }).bindTooltip('You are here').addTo(layer);
}

function qrSvg(seed) {
  let h = 7;
  for (const ch of seed) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  let cells = '';
  for (let y = 0; y < 21; y++) {
    for (let x = 0; x < 21; x++) {
      const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
      const ring = finder && (x % 14 === 0 || y % 14 === 0 || x % 14 === 6 || y % 14 === 6 || (x % 14 >= 2 && x % 14 <= 4 && y % 14 >= 2 && y % 14 <= 4));
      h = (h * 1103515245 + 12345) >>> 0;
      if (finder ? ring : (h >> 16) & 1) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }
  }
  return `<svg class="qr" viewBox="0 0 21 21" role="img" aria-label="Booking QR code">${cells}</svg>`;
}
```

- [ ] **Step 2: Check the driver flow in a browser**

With the server from Task 7 running, open `http://localhost:8765/#driver` at desktop width and at 400 px width. Expected:
- The map shows about 21 price pins around KL East, and the "You are here" dot.
- At Wed 11 AM, condo pins show a "Shared now" tag, except Kenanga Heights and Azalea Suites.
- At battery 35% (Balanced), three picks show, each with reasons.
- At battery 8%, the badge turns "Urgent" and a DC charger tops the list.
- At battery 75% with "Tue 6:30 PM · TNB peak", the badge shows "Saver". If KL East Mall DC is busy, a "Demand balancing" note appears.
- At 100%, the panel says no charge is needed.
- Book → bay held with QR → Start charging → the counter runs → Stop → "Report a problem" → back to picks with the thank-you message. Repeating "Report a problem" 5 times on the same charger turns its pin red.
- "Wed 2 AM" with "I live at: Residensi Lumina": "Your condo bay" appears. With no residence, condo sites show "Residents only right now" under "not suitable".

Fix anything that does not match, then continue.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add views/driver.js
git commit -m "feat: add driver screen with map, picks, booking and check-in"
```

---

### Task 9: JMB dashboard

**Files:**
- Modify (replace stub): `views/jmb.js`

**Interfaces:**
- Consumes: `CONST`, `TNB`, `simulateCondoMonth`, `rampSeries`, `validateSharing`, `barChart24`, `lineChart`, `esc`, `rm`, `rm0`, `num`, `pct`, `monthLabel`
- Produces: `renderJmb(root, ctx)`

- [ ] **Step 1: Write the JMB view**

```js
// FILE: views/jmb.js
import { CONST } from '../config.js';
import { TNB } from '../data/tariff.js';
import { simulateCondoMonth, rampSeries } from '../engine/economics.js';
import { validateSharing } from '../engine/sharing.js';
import { barChart24, lineChart } from './charts.js';
import { esc, rm, rm0, num, pct, monthLabel } from './format.js';

let condoId = null;
const PEAK_HOURS = Array.from({ length: TNB.peakEndHour - TNB.peakStartHour }, (_, i) => TNB.peakStartHour + i);

export function renderJmb(root, ctx) {
  const { condos, chargers } = ctx.world;
  if (!condos.some((c) => c.id === condoId)) condoId = condos[0].id;
  const condo = condos.find((c) => c.id === condoId);
  const charger = chargers.find((ch) => ch.condoId === condo.id);
  const start = new Date(ctx.clock.getFullYear(), ctx.clock.getMonth(), 1);
  const sim = simulateCondoMonth(condo, charger, start);
  const s = condo.sharing;
  const sinkingYear = 0.1 * condo.monthlyFee * condo.units * 12;
  const boost = (sim.jmbIncome * 12) / sinkingYear;
  const months = Array.from({ length: 6 }, (_, i) => monthLabel(new Date(start.getFullYear(), start.getMonth() - 5 + i, 1)));
  const checkins = ctx.state.checkins[charger.id] || [];
  const problems = checkins.filter((c) => !c.ok);

  root.innerHTML = `
  <div class="jmb">
    <div class="view-head">
      <div><p class="eyebrow">JMB dashboard · ${esc(start.toLocaleString('en-MY', { month: 'long', year: 'numeric' }))}</p>
        <h2>${esc(condo.name)}</h2>
        <p class="muted">${condo.units} units · ${condo.bays} charging bays · the JMB keeps ${pct(condo.jmbShare)} of the margin, the charging partner keeps the rest</p></div>
      <label class="field inline">Condo <select id="j-condo">${condos.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
    </div>

    <div class="kpis">
      <div class="kpi"><span>Charging income this month</span><b>${rm0(sim.revenue)}</b></div>
      <div class="kpi"><span>JMB share after electricity</span><b>${rm0(sim.jmbIncome)}</b></div>
      <div class="kpi hero"><span>Saving per unit per month</span><b>${rm(sim.perUnitSaving)}</b></div>
      <div class="kpi"><span>Energy delivered</span><b>${num(sim.kWhSold)} kWh</b></div>
    </div>

    <div class="grid2">
      <section class="card"><h3>An average day: who charges when</h3>
        ${barChart24({ a: sim.residentByHour, b: sim.visitorByHour, shade: PEAK_HOURS, aLabel: 'Residents', bLabel: 'Outside drivers (shared bays)' })}
        <p class="muted">Shaded hours are TNB peak (weekdays 2–10 PM). Residents charge in the evening; outside drivers fill the bays they leave empty during the day.</p>
      </section>
      <section class="card"><h3>Charging income, last 6 months</h3>
        ${lineChart({ labels: months, series: [
          { label: 'From residents', values: rampSeries(sim.residentRevenue), cls: 'la' },
          { label: 'From outside drivers', values: rampSeries(sim.visitorRevenue), cls: 'lb' },
        ] })}
        <p class="muted">Simulated ramp-up as more residents switch to EVs.</p>
      </section>
    </div>

    <div class="grid2">
      <section class="card"><h3>What it means for owners</h3>
        <p class="big">Monthly fee held at <b>${rm0(condo.monthlyFee)}</b> instead of <b>${rm(condo.monthlyFee + sim.perUnitSaving)}</b>.</p>
        <p>Or add it to the sinking fund: <b>+${rm0(sim.jmbIncome * 12)} a year</b>, ${pct(boost)} on top of owners' contributions of ${rm0(sinkingYear)}.</p>
        <div class="bar" role="img" aria-label="Sinking fund boost ${pct(boost)}"><span style="width:${Math.min(100, boost * 100)}%"></span></div>
        <p class="muted">Hardware payback on ${condo.bays} bays at ${rm0(CONST.hardwarePerBay)} each: ${sim.paybackMonths ? `${sim.paybackMonths} months` : 'not reached at these prices'}. CO₂ avoided: ${num(sim.co2AvoidedKg)} kg this month.</p>
      </section>
      <section class="card"><h3>Sharing with outside drivers</h3>
        <form id="j-share" class="form" novalidate>
          <label class="check"><input type="checkbox" id="j-en" ${s.enabled ? 'checked' : ''}> Open idle bays to outside drivers</label>
          <label class="field">Days <select id="j-days">
            <option value="weekdays">Weekdays</option><option value="weekends">Weekends</option><option value="all">Every day</option></select></label>
          <div class="row">
            <label class="field">Opens (hour) <input id="j-start" type="number" min="0" max="23" step="1" value="${s.start}"></label>
            <label class="field">Closes (hour) <input id="j-end" type="number" min="1" max="24" step="1" value="${s.end}"></label>
          </div>
          <div class="row">
            <label class="field">Bays kept for residents <input id="j-res" type="number" min="0" max="${condo.bays}" step="1" value="${s.reservedBays}"></label>
            <label class="field">Visitor price (RM/kWh) <input id="j-price" type="number" min="0.5" max="3" step="0.05" value="${s.visitorPrice}"></label>
          </div>
          <p id="j-err" class="error" role="alert" hidden></p>
          <p class="muted">Residents pay ${rm(condo.residentPrice)}/kWh. TNB peak hours add ${rm(condo.peakSurcharge)}. Changes update this dashboard and the driver map.</p>
        </form>
      </section>
    </div>

    <section class="card"><h3>Charger health</h3>
      <p class="muted">Reliability ${pct(charger.reliability)} · ${checkins.length} check-ins from drivers on this device.</p>
      <div class="tbl"><table>
        <thead><tr><th>Bay</th><th>Status</th><th>Latest report</th></tr></thead>
        <tbody>${Array.from({ length: condo.bays }, (_, i) => {
          const p = problems[problems.length - 1 - i];
          return `<tr><td>Bay ${i + 1}</td><td>${p ? '<span class="chip warn">Problem reported</span>' : '<span class="chip on">Working</span>'}</td><td>${p ? esc(p.note || 'No details given') : '—'}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
    </section>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  $('#j-condo').value = condo.id;
  $('#j-days').value = s.days;
  $('#j-condo').addEventListener('change', (e) => { condoId = e.target.value; ctx.rerender(); });
  $('#j-share').addEventListener('submit', (e) => e.preventDefault());
  $('#j-share').addEventListener('change', () => {
    const next = {
      enabled: $('#j-en').checked,
      days: $('#j-days').value,
      start: Number($('#j-start').value),
      end: Number($('#j-end').value),
      reservedBays: Number($('#j-res').value),
      visitorPrice: Number($('#j-price').value),
    };
    const err = validateSharing(next, condo.bays);
    const box = $('#j-err');
    if (err) { box.textContent = err; box.hidden = false; return; }
    box.hidden = true;
    ctx.state.sharing[condo.id] = next;
    ctx.save();
    ctx.rerender();
  });
}
```

- [ ] **Step 2: Check the JMB view in a browser**

Open `http://localhost:8765/#jmb`. Expected:
- KPIs for Residensi Lumina, with the hero tile reading roughly RM10–20.
- The bar chart shows the evening resident peak, amber daytime visitor bars, and shaded 2–10 PM.
- The line chart has two lines and month labels.
- Fee and sinking-fund text and bar show.
- Unticking "Open idle bays" drops the visitor bars to zero and lowers the saving. On the Driver tab at Wed 11 AM, Lumina's "Shared now" tag is gone.
- Setting Opens 18 / Closes 9 shows "Opening time must be before closing time." and changes nothing.
- After reporting a problem on Lumina's bay in the Driver view (live at Lumina, time Wed 2 AM), Bay 1 shows "Problem reported" with the note.
- At 400 px width everything stacks with no sideways scroll.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add views/jmb.js
git commit -m "feat: add JMB income dashboard with sharing settings"
```

---

### Task 10: SDP township view

**Files:**
- Modify (replace stub): `views/sdp.js`

**Interfaces:**
- Consumes: `APP`, `CONST`, `townshipSummary`, `scaleUp`, `esc`, `rm`, `rm0`, `num`, `pct`
- Produces: `renderSdp(root, ctx)`

- [ ] **Step 1: Write the SDP view**

```js
// FILE: views/sdp.js
import { APP, CONST } from '../config.js';
import { townshipSummary, scaleUp } from '../engine/economics.js';
import { esc, rm, rm0, num, pct } from './format.js';

let townships = 5;

const PILOT = [
  { label: 'Charging partner (registered operator)', status: 'Lead', cls: 'amber', note: 'The SDP–TNB MoU (Dec 2023) already covers EV charging in SDP townships. Gentari and EV Connection run condo models today.' },
  { label: 'Energy Commission CPO registration', status: 'Partner holds', cls: 'on', note: 'The operator is registered under the EVCS guideline (Feb 2025), so the JMB never resells electricity itself.' },
  { label: 'JMB resolution', status: 'To do', cls: 'off', note: 'Shared bays on common property need a resolution under the Strata Management Act 2013.' },
  { label: 'TNB sub-meter for the bays', status: 'To do', cls: 'off', note: 'Separate metering for the charging bays takes about 4–8 weeks.' },
  { label: 'Bomba and council approval', status: 'To do', cls: 'off', note: 'Required for shared or public-access chargers.' },
  { label: 'Resident and JMB survey', status: 'In progress', cls: 'amber', note: '20–30 residents and 1–2 JMB managers, before 23 Oct 2026.' },
];

export function renderSdp(root, ctx) {
  const start = new Date(ctx.clock.getFullYear(), ctx.clock.getMonth(), 1);
  const { perCondo, totals } = townshipSummary(ctx.world.condos, ctx.world.chargers, start);
  const rows = [...perCondo].sort((a, b) => b.perUnitSaving - a.perUnitSaving);
  const avg = (list) => (list.length ? list.reduce((s, r) => s + r.perUnitSaving, 0) / list.length : 0);
  const on = perCondo.filter((r) => r.condo.sharing.enabled);
  const offRows = perCondo.filter((r) => !r.condo.sharing.enabled);
  const compare = on.length && offRows.length
    ? `Condos sharing idle bays save owners ${rm(avg(on))} per unit a month on average, against ${rm(avg(offRows))} without sharing.`
    : 'Turn sharing on or off in the JMB view to compare condos.';

  root.innerHTML = `
  <div class="sdp">
    <div class="view-head">
      <div><p class="eyebrow">SDP / operator view · ${esc(start.toLocaleString('en-MY', { month: 'long', year: 'numeric' }))}</p>
        <h2>${esc(APP.township)} township</h2>
        <p class="muted">${perCondo.length} condos and KL East Mall on one shared charging network</p></div>
    </div>

    <div class="kpis">
      <div class="kpi"><span>Energy delivered this month</span><b>${num(totals.kWh)} kWh</b></div>
      <div class="kpi hero"><span>Income returned to JMBs</span><b>${rm0(totals.jmbIncome)}</b></div>
      <div class="kpi"><span>CO₂ avoided vs petrol</span><b>${(totals.co2Kg / 1000).toFixed(1)} t</b></div>
      <div class="kpi"><span>Condo bay utilisation</span><b>${pct(totals.utilisation)}</b></div>
    </div>

    <section class="card" style="margin-bottom:16px"><h3>Condo by condo</h3>
      <div class="tbl"><table>
        <thead><tr><th>Condo</th><th class="n">Bays</th><th>Sharing</th><th class="n">Utilisation</th><th class="n">JMB income</th><th class="n">Saving per unit</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${esc(r.condo.name)}</td><td class="n">${r.condo.bays}</td>
          <td>${r.condo.sharing.enabled ? '<span class="chip on">On</span>' : '<span class="chip off">Off</span>'}</td>
          <td class="n">${pct(r.utilisation)}</td><td class="n">${rm0(r.jmbIncome)}</td><td class="n">${rm(r.perUnitSaving)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="muted">${esc(compare)}</p>
    </section>

    <div class="grid2">
      <section class="card"><h3>Scale across SDP townships</h3>
        <label class="field">Townships using the platform <output id="s-n-out">${townships}</output>
          <input id="s-n" type="range" min="1" max="${CONST.sdpTownships}" step="1" value="${townships}"></label>
        <dl class="stats" id="s-stats"></dl>
        <p class="muted">Assumes each township performs like ${esc(APP.township)}. National target: ${num(CONST.nationalTarget2030)} public chargers by 2030.</p>
      </section>
      <section class="card"><h3>Pilot readiness</h3>
        <ul class="checklist">${PILOT.map((p) => `<li><span class="chip ${p.cls}">${esc(p.status)}</span><b>${esc(p.label)}</b><span class="note">${esc(p.note)}</span></li>`).join('')}</ul>
      </section>
    </div>
  </div>`;

  const slider = root.querySelector('#s-n');
  const drawStats = () => {
    const s = scaleUp(totals, townships);
    root.querySelector('#s-n-out').textContent = townships;
    root.querySelector('#s-stats').innerHTML = `
      <div><dt>Shared condo bays</dt><dd>${num(s.bays)}</dd></div>
      <div><dt>JMB income a year</dt><dd>${rm0(s.jmbIncomeYear)}</dd></div>
      <div><dt>CO₂ avoided a year</dt><dd>${num(s.co2TonnesYear)} t</dd></div>
      <div><dt>Share of national target</dt><dd>${(s.shareOfNationalTarget * 100).toFixed(1)}%</dd></div>`;
  };
  slider.addEventListener('input', (e) => { townships = Number(e.target.value); drawStats(); });
  drawStats();
}
```

- [ ] **Step 2: Check the SDP view in a browser**

Open `http://localhost:8765/#sdp`. Expected:
- 4 KPIs.
- A condo table sorted by saving per unit, with sharing chips, where sharing condos average higher than non-sharing ones (the sentence under the table states both numbers).
- The scale slider updates the four stats live: at 28 townships, bays = 28 × 56 = 1,568 and share of target ≈ 5.2%.
- The pilot checklist has 6 items.
- Turning sharing off for a condo in the JMB view moves it down the table.
- Light and dark themes both read correctly. Toggle the OS theme or use DevTools rendering emulation.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add views/sdp.js
git commit -m "feat: add SDP township view with scale-up and pilot readiness"
```

---

### Task 11: README and GitHub Pages deploy

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: the finished app
- Produces: public repo `CYtang1107/CasCas`, live URL `https://cytang1107.github.io/CasCas/`

- [ ] **Step 1: Write the README**

```markdown
<!-- FILE: README.md -->
# CasCas

Shared EV charging for Sime Darby Property townships. Prototype for the SDP University Hackathon 2026 (Planet track).

**Live demo:** https://cytang1107.github.io/CasCas/

## What it shows

- **Driver:** battery-aware picks across every provider around KL East. Low battery gets the nearest working charger; high battery gets cheaper, quieter ones, with demand balancing that keeps busy fast chargers free for drivers who need them.
- **Idle-hour sharing:** condo bays open to outside drivers during set hours, with residents always first.
- **JMB:** charging income, saving per unit per month, sinking-fund boost, sharing settings and charger health.
- **SDP:** township totals, condo comparison, scale-up to 28 townships and pilot readiness.

All data is simulated. Condo names are fictional. Prices and tariffs follow public 2026 figures (see the research brief).

## 60-second demo script

1. **Driver**, Wed 11 AM, battery 35%: three picks with reasons; condo pins tagged "Shared now".
2. Drag battery to 8%: the mode switches to Urgent and the nearest DC charger wins.
3. Switch time to Tue 6:30 PM and battery to 75%: Saver mode; the demand-balancing note steers you off the busy mall charger.
4. Book → scan → charge → report a problem: the charger's reliability drops.
5. **JMB**: saving per unit, the day chart showing outside drivers filling idle daytime bays. Turn sharing off and watch the income fall.
6. **SDP**: sharing condos earn more; slide to 28 townships.

## Run locally

    python -m http.server 8765
    # open http://localhost:8765

## Tests

    npm test

Engine modules (`engine/`) are pure and covered by `node --test`.
```

- [ ] **Step 2: Run the full test suite one last time**

Run: `npm test`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with demo script"
```

- [ ] **Step 4: Create the GitHub repo and push**

`gh` is not installed on this machine. Ask the user to create an empty public repo named `CasCas` at https://github.com/new under `CYtang1107`, with no README and no licence. Or, with their go-ahead, do it through the Chrome browser tools. Then:

```bash
git remote add origin https://github.com/CYtang1107/CasCas.git
git push -u origin main
```

Expected: the push succeeds through the existing Git Credential Manager login, as VO-AI's did.

- [ ] **Step 5: Enable GitHub Pages**

In the repo: Settings → Pages → Source "Deploy from a branch" → Branch `main`, folder `/ (root)` → Save. Wait about a minute, then open `https://cytang1107.github.io/CasCas/`. Expected: the app loads, the map tiles load, and all three tabs work. Check once on a phone-width window.
