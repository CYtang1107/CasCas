# CasCas: real charger data (piece 1) and driver-behaviour insights (piece 5)

Date: 14 Oct 2026 · Status: approved design · Deadline context: SDP hackathon submission 23 Oct 2026

This spec covers two of the five pieces that make the prototype "real":

| # | Piece | This spec |
|---|---|---|
| 1 | Real charger locations (Open Charge Map, live) | Yes |
| 2 | GPS and real driving routes (OSRM) | No, later |
| 3 | Installable phone app (PWA) | No, later |
| 4 | Accounts and shared bookings (Supabase) | No, later |
| 5 | Recommendation-follow analytics and detailed JMB view | Yes |

Out of scope for both: live bay occupancy and payments (need operator APIs), real condo bays (stay simulated "pilot condo" sites), multi-user data (piece 4).

---

## Piece 1: real charger locations, live from Open Charge Map

### Behaviour

On app start, CasCas fetches public chargers within 15 km of the township centre (`START` in `data/places.js`, KL East) from the Open Charge Map (OCM) API, up to 200 results, and uses them in place of the simulated public chargers. Simulated condo sites stay and are labelled "Pilot condo (simulated)".

### Units

**`config.js`** gains:

```js
export const OCM = {
  key: '',            // free key from openchargemap.org; empty = skip live fetch
  radiusKm: 15,
  maxResults: 200,
  timeoutMs: 6000,
  cacheMaxAgeDays: 7,
};
```

**`data/chargers-demo.js`** (renamed from the public part of `data/chargers.js`): the existing 15 simulated public chargers, kept as the last-resort fallback.

**`data/chargers.js`** keeps building `condoSites` from `CONDOS` and exports `CONDO_SITES`; it no longer exports a fixed public list.

**`data/operator-prices.js`** (new): `OPERATOR_PRICES = { Gentari: { AC: 1.00, DC: 1.30 }, ChargEV: { AC: 0.90, DC: 1.30 }, JomCharge: { AC: 1.10, DC: 1.30 }, Tesla: { DC: 1.80 } }` (the rates already used in the demo data, from the research brief) and `DEFAULT_PRICE = { AC: 1.00, DC: 1.30 }`. A known operator without a rate for that type (e.g. Tesla AC) also uses the default with `priceEstimated: true`. More operators are added only with a sourced rate. Operator names are matched case-insensitively by substring (OCM titles vary, e.g. "Gentari Sdn Bhd").

**`engine/normalise.js`** (new, pure): `normaliseOcm(poi) → charger | null` and `normaliseAll(pois) → charger[]`.

| CasCas field | Source |
|---|---|
| `id` | `ocm-${poi.ID}` |
| `name` | `AddressInfo.Title` |
| `address` | `AddressInfo.AddressLine1`, `Town` |
| `lat`, `lng` | `AddressInfo.Latitude`, `Longitude` |
| `operator` | `OperatorInfo.Title`, else `'Unknown operator'` |
| `type` | `'DC'` if any connection is CCS2, CHAdeMO or `PowerKW >= 25`; else `'AC'` |
| `kw` | max `PowerKW` over connections, else 7 (AC) / 50 (DC) |
| `connectors` | mapped to `Type2`, `CCS2`, `CHAdeMO` (unknown types dropped; empty list → `['Type2']` for AC, `['CCS2']` for DC) |
| `bays` | `NumberOfPoints`, else sum of connection `Quantity`, else 1 |
| `price`, `priceEstimated` | operator table; unknown operator → `DEFAULT_PRICE`, `priceEstimated: true` |
| `reliability` | 0.9; `StatusType.IsOperational === false` → 0.5 (below `FAULTY` 0.6, so dropped from picks) |
| `siteType` | `'public'` |
| `source` | `'ocm'` |

Returns `null` (dropped) when coordinates are missing or `UsageType` marks the site private / members-only (`UsageType.IsMembershipRequired === true` or `UsageType.Title` contains "Private").

**`data/ocm.js`** (new): `loadChargers({ fetchFn = fetch, storage = localStorage, now = Date.now }) → { chargers, source, ageDays }`.

1. If `OCM.key` is set, fetch `https://api.openchargemap.io/v3/poi?output=json&latitude=…&longitude=…&distance=15&distanceunit=KM&maxresults=200&compact=true&verbose=false&key=…` with a 6 s abort timeout. On success with ≥1 charger after normalising: save `{ savedAt, chargers }` to `localStorage['cascas.ocm.v1']`, return `source: 'live'`.
2. On failure, timeout, empty result or no key: read the saved copy; if younger than 7 days, return `source: 'saved'` with `ageDays`.
3. Otherwise return the demo list, `source: 'demo'`.

All storage access is wrapped in try/catch (private windows). The result is always `[...CONDO_SITES, ...publicChargers]`.

### App start and UI

`app.js` awaits `loadChargers()` before the first render, showing "Loading chargers…" in the main area. `buildWorld` receives the loaded list instead of the static `CHARGERS` import. A badge in the header shows `Live · Open Charge Map`, `Saved copy · N days old` or `Demo data`, with the attribution "Data © Open Charge Map contributors" (linked to openchargemap.org) whenever OCM data is shown. Chargers with `priceEstimated` show "est." next to the price. Condo pins say "Pilot condo (simulated)".

### Testing

- `test/normalise.test.js`: fixture `test/fixtures/ocm-sample.json` (5–8 real-shaped POIs) → DC detection, kW, bays fallbacks, connector mapping, operator price lookup and default, non-operational → 0.5, private and coordinate-less POIs dropped.
- `test/ocm.test.js`: fake `fetchFn` and in-memory storage → live success saves a copy; failure uses a fresh saved copy; stale copy (8 days) falls back to demo; no key skips the network.
- Existing tests that import `CHARGERS` switch to `[...CONDO_SITES, ...DEMO_CHARGERS]` and must still pass.

---

## Piece 5: does the driver follow the recommendation? Detailed JMB view

### Session record

When a booking is confirmed in the driver view, append to `state.sessions` (new array in `state.js`, cleaned like the other fields; capped at the latest 500):

```js
{
  at: '2026-10-21T11:05:00',      // demo-clock time
  anonId: 'R12' | 'V48',          // stable per device: R = resident of a condo, V = visitor
  role: 'resident' | 'visitor',
  mode: 'urgent' | 'balanced' | 'saver',
  chargerId, condoId,             // condoId null for public chargers
  topPickId, nearestId,
  choice: 'pick1' | 'pick2' | 'pick3' | 'own',
  kWh, costRm,
  nearestCostRm, minutesVsNearest // negative = faster than nearest
}
```

`anonId` is derived once per device (random number stored in state) — no names, phone numbers or plates are ever collected. After booking, the driver sees "You saved RM x.xx vs the nearest charger" (or "x min faster" / "same as nearest").

### `engine/insights.js` (new, pure)

- `followRate(sessions)` → share with `choice !== 'own'`.
- `savings(sessions)` → `{ avgRm, totalRm, avgMinutes }` vs nearest.
- `weeklyTrend(sessions, weeks = 26)` → `[{ weekStart, followRate, count }]`.
- `byMode(sessions)` and `byRole(sessions)` → follow rate and count per group.
- `filterSessions(sessions, { condoId, role, from, to })`.

### Simulated history

`engine/history.js` (new, pure): `simulateHistory(condo, chargers, endDate, { seed })` generates 6 months of sessions for that condo's bay using a seeded PRNG (mulberry32), demand from `occupancyAt`, and choice probabilities by mode. Same inputs → identical output. Each record carries `simulated: true`. The JMB view merges simulated history with real sessions from `state.sessions` for that condo.

### JMB dashboard: "Driver behaviour" section

Added below the existing cards in `views/jmb.js`, labelled "Simulated history + your demo bookings":

- KPI tiles: follow rate %, average RM saved per session, total RM saved this month.
- Weekly follow-rate line (existing `lineChart`).
- Mode breakdown: follow rate and sessions for Urgent / Balanced / Saver.
- Session log table (latest 50, newest first): time, anonymous ID, bay, kWh, RM, choice. Filters: All / Residents / Visitors, and date range. **Export CSV** downloads the filtered rows (Blob + `a[download]`).

### Testing

- `test/insights.test.js`: follow rate, savings maths, weekly bucketing across a month boundary, mode/role breakdown, filters.
- `test/history.test.js`: deterministic output for a fixed seed; all records valid and inside the date range.
- `test/state-world.test.js`: `sessions` survives clean/load; malformed entries dropped; cap at 500.
- Booking writes one well-formed session record (driver-flow test on the pure helper that builds the record).

---

## Also in scope: visitor access by number plate

Management decides whether its condo shares at all, using the existing sharing settings (on/off and sharing hours). There is no manual approval step: **while sharing is on and inside sharing hours, every visitor booking is approved automatically.** Outside those hours, or with sharing off, the bay is not offered to visitors (current `isOpenToVisitors` behaviour).

**Driver side.** When a visitor (not a resident of that condo) books a condo bay:

1. A required **number plate** field: `normalisePlate(raw)` uppercases, removes spaces and dashes; `isValidPlate(p)` accepts 2–10 letters and digits containing at least one letter and one digit (e.g. `WXY1234`, `VEP88`).
2. A required consent tick-box: "My plate is shared with the condo management only to let me in."
3. On booking: "Approved: show plate WXY 1234 at the guardhouse, 11:00–12:00." Residents never enter a plate.

**Management side (JMB view).** A new "Expected visitors" card lists today's and upcoming approved visitor bookings for the condo: time slot, bay, plate. It is the list the guardhouse checks. Changing sharing to off stops new visitor bookings; already-approved ones stay listed.

**Data and privacy.**

- Plate records live in `state.visitorPasses` (`{ id, condoId, chargerId, plate, slotStart, slotEnd, createdAt }`), separate from `state.sessions`.
- Session records and all analytics keep the anonymous `anonId`; a session never contains a plate.
- Passes are deleted 30 days after `slotEnd` (`purgePasses(passes, now)` on load).
- Prototype limit: everything is on one device; the guard's list on another phone needs piece 4.

**Code.** `engine/access.js` (new, pure): `normalisePlate`, `isValidPlate`, `canAutoApprove(condo, date)` (= sharing on and inside hours), `createPass(...)`, `upcomingPasses(passes, condoId, now)`, `purgePasses(passes, now)`. `state.js` cleans and keeps `visitorPasses`.

**Testing.** `test/access.test.js`: plate cleaning and validity cases; auto-approve inside hours, outside hours and with sharing off; upcoming list ordering and condo filter; purge at 30 days; a booking's session record has no plate field.

## Also in scope: remove the SDP view

The app keeps two views, **Driver** and **JMB**. Removed:

- `views/sdp.js`, the `SDP` tab in `index.html`, the `sdp` entry in `VIEWS` in `app.js`, and SDP-only styles (`.sdp …`) in `styles.css`.
- An old `#sdp` link opens the Driver view instead (unknown hash → default view).
- `townshipSummary` and `scaleUp` in `engine/economics.js`, `CONST.sdpTownships`, and their tests, if nothing else uses them after the view is gone. The `sdp: true` flag on mall chargers stays in the demo data (harmless) but is not carried into OCM chargers.
- README demo script step 6 (SDP view) is removed.

Follow-up outside the repo: the proposal sections that mention the SDP view (2.2.2, 2.3 diagram, 2.5, 4.1.1, 4.2 step 5) are updated to two views.

## Delivery order

1. Remove the SDP view → tests green.
2. Piece 1 (real chargers) → tests green → deploy to GitHub Pages.
3. Piece 5 (insights) → tests green → deploy.
4. Update README demo script and the proposal's 2.2 / 2.3 / 2.5 / 4 sections.

The user supplies the OCM API key (free signup at openchargemap.org); until then the app runs on the saved or demo data.
