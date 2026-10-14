# CasCas: shared server (piece 4, Kakehashi-style)

Date: 14 Oct 2026 · Status: approved design

## Goal

Bookings, visitor plates, check-ins, sessions and JMB sharing settings are shared across phones, so a driver books on one phone and the JMB and guardhouse see it on another. Modelled on the Kakehashi repo: one Express service on Render's free plan serves both the website and an API, with JSON-file storage.

Out of scope: driver accounts (drivers stay anonymous), payments, a real database.

## Architecture

- `server/` (new) — Express 4 app, Node 20+, ES modules. Serves the existing static files from the repo root and `/api/*`.
- `server/store.js` — JSON storage in `server/data/store.json` (git-ignored), written atomically (temp file + rename), loaded on start. Empty on a fresh deploy; Render's free disk is wiped on restart, like Kakehashi.
- `render.yaml` — one free web service: `npm ci`, `npm start`; env `OCM_KEY` (not synced), `JMB_SECRET` (generated), optional `JMB_PINS`.
- The app has two modes. On start it calls `GET /api/health` (same origin, 3 s timeout). OK → **shared mode**. Fails → **local mode**, today's behaviour, which also keeps GitHub Pages working as a backup link.

The server reuses the pure engine modules (`engine/access.js`, `engine/sharing.js`, `engine/normalise.js`, `data/*.js`) so rules are identical on both sides.

## Data held by the server

```js
{
  sharing:  { [condoId]: { enabled, days, start, end, reservedBays, visitorPrice } }, // overrides
  checkins: { [chargerId]: [{ ok, note, at }] },            // capped 200 per charger
  sessions: [ session ],                                     // anonymous, capped 5,000
  passes:   [ { id, condoId, chargerId, plate, slotStart, slotEnd, createdAt, cancelToken } ],
  bookings: [ { id, chargerId, start, end, cancelToken } ]   // active holds, for bay counts
}
```

Passes are purged 30 days after `slotEnd` on load and every hour. Bookings are dropped once `end` has passed.

## API

All bodies are JSON. Inputs are validated; anything malformed returns `400 { error }`.

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | — | `{ ok: true }` |
| `GET /api/chargers` | — | `{ source: 'live'|'saved'|'demo', ageDays, chargers }`. The server fetches Open Charge Map with `OCM_KEY`, caches for 24 h in memory and in `server/data/ocm.json`, falls back to the demo list. The key never reaches the browser |
| `GET /api/world` | — | `{ sharing, checkins, activeBays: { [chargerId]: n } }` for building the driver's world |
| `POST /api/bookings` | — | `{ session, booking, pass? }` → stores the anonymous session and the hold; if `pass` is present the server checks the plate, the consent flag and `canAutoApprove(condo, slotStart)` itself and returns `{ bookingId, cancelToken, pass }` or `409 { error: 'Not sharing at that time' }` |
| `DELETE /api/bookings/:id` | `cancelToken` in body | Cancels the hold and its pass (the session record stays) |
| `POST /api/checkins` | — | `{ chargerId, ok, note }` (note ≤ 120 chars) |
| `GET /api/condos/:id/summary` | — | Totals only: follow rate, savings and sessions for 30 days, overstay totals. No log, no plates |
| `POST /api/jmb/login` | — | `{ condoId, pin }` → `{ token, expiresAt }` (12 h) or `401` |
| `GET /api/jmb/:condoId` | Bearer token | `{ sessions (that condo), passes (upcoming, with plates) }` |
| `PUT /api/jmb/:condoId/sharing` | Bearer token | Validated with `validateSharing`; saved and returned |

**Tokens.** `HMAC-SHA256(JMB_SECRET, condoId + '.' + expiresAt)` → `condoId.expiresAt.sig`; constant-time compare. A token works only for its own condo. Login is rate-limited to 10 tries per condo per 10 minutes.

**PINs.** `JMB_PINS` env as JSON `{ condoId: pin }`; if unset, demo PINs from `server/pins.js` (listed in the README for judges).

**Bay counts.** Active bookings at a charger are added to its simulated occupancy (`total = min(1, base + bookedBays / bays)`), and to visitor-bay use for condo bays, so a full condo really fills up.

## Client changes

- `data/api.js` (new): `detectServer()`, `getChargers()`, `getWorld()`, `postBooking()`, `cancelBooking()`, `postCheckin()`, `getSummary()`, `jmbLogin()`, `getJmb()`, `putSharing()`; every call has a timeout and returns `{ ok, data | error }`.
- `app.js`: picks the mode, loads chargers from `/api/chargers` (shared) or `loadChargers()` (local), and merges `/api/world` into the world (sharing overrides, check-ins, active bays). A small "Shared demo" / "This device only" line next to the data source.
- Driver: in shared mode, booking waits for `POST /api/bookings`; on failure it shows "Couldn't save your booking, try again." and stays on the picks. Cancel and check-in go to the server. Local mode is unchanged.
- JMB in shared mode: a PIN form per condo. Without a token: income cards and the summary only. With a token: expected visitors (plates), the session log and CSV, and sharing settings saved to the server. "Log out" clears the token (kept in `sessionStorage`).
- If a call fails because the server is down, a banner says "Server unavailable, showing this device only" and the app falls back to local mode.

## Privacy

- Plates are returned only by `GET /api/jmb/:condoId` with that condo's token.
- Sessions never contain a plate (as today).
- Passes are deleted 30 days after the slot.
- The README notes that the public demo resets on restart and that real plates should not be entered.

## Testing

- `test/server.test.js`: starts the app on port 0 with a temp data dir and fake `fetch` for Open Charge Map:
  - health; chargers from live, then the demo fallback when OCM fails;
  - booking → world shows `activeBays`; cancel with a wrong token fails, with the right token works;
  - pass inside sharing hours is approved; outside hours → 409; invalid plate or missing consent → 400;
  - summary has no plates and no log;
  - login with a wrong PIN → 401; rate limit after 10 tries; token for condo A rejected for condo B; expired token rejected;
  - JMB data includes plates with a valid token; sharing update validated;
  - store survives a restart (write then reload).
- `test/api-client.test.js`: client helpers with a fake `fetch` (timeout, error shape).
- All existing tests keep passing.

## Delivery

1. Server + store + tests.
2. Client API layer and shared mode.
3. JMB PIN view.
4. `render.yaml`, README; the user creates the Render service (Blueprint) and sets `OCM_KEY`.
