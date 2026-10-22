# CasSama

*Formerly CasCas. Old links to the CasCas repo redirect here.*

Shared EV charging for Sime Darby Property townships. Prototype for the SDP University Hackathon 2026 (Planet track).

Two front doors, one codebase:

| | Shared demo (Render) | This device only (GitHub Pages) |
|---|---|---|
| **Driver app** (Home, Map, Plan, Activity, Account) | https://cassama-9nha.onrender.com/ | https://cytang1107.github.io/CasSama/ |
| **JMB portal** | https://cassama-9nha.onrender.com/jmb.html | https://cytang1107.github.io/CasSama/jmb.html |

A condo's own portal link: add its id, e.g. `jmb.html#lumina`. Bookings made in the driver app show up in the portal (live on Render).

Charging partner (CPO) view across all condo sites: `jmb.html#cpo` (its 70% share, energy, bay use, bays in service, idle hours not yet shared). The AI Revenue agent also answers "When are Lumina's bays idle?" with the same monthly report.

## What it shows

- **Driver:** battery-aware picks across every provider around KL East. Low battery gets the nearest working charger; high battery gets cheaper, quieter ones, with demand balancing that keeps busy fast chargers free for drivers who need them. Every booking records (anonymously) whether the driver took a CasSama pick and what it saved vs the nearest charger.
- **Ask CasSama:** type a trip in plain English ("Atto 3 at 20%, going to KL East Mall for 2 hours, under RM1.20, prefer Gentari") and the form fills itself. The rule-based preference parser still works without an AI key; with a server AI key, conversational questions are handled by the live agent.
- **CasSama AI agents** (when the server has an AI key): Ask CasSama on Home and Plan opens the conversational AI on Home. An orchestrator model calls CasSama's own engines as agents (Recommendation, Journey planning, Booking, Cost estimation, Revenue) and a knowledge base of checked facts (`data/knowledge.js`, BM25 search). Guardrails: card numbers, passwords and PINs are refused before reaching the model; every RM amount in a reply must come from an agent's result, or the answer is corrected or the amount removed; the assistant can only *propose* a booking, the driver taps to confirm. Each reply shows which agents worked on it and which facts it used. The OpenAI-compatible integration has been tested with Google Gemini 2.5 Flash, and Qwen remains configurable through the same adapter.
- **Notifications** (Account → Notifications, opt-in): charge complete, 15 minutes before your slot ends, and a new sharing vote at your condo.
- **Long trips:** pick a longer trip (Seremban, Port Dickson, Melaka, Ipoh, Johor Bahru, Penang) or ask "Atto 3 at 71%, going to Melaka, arrive with 23%". The plan shows start battery, each leg, every fast-charging stop (arrive % → leave %, minutes, kWh, cost) and the battery on arrival, on the map too, with Google Maps directions. It charges only what the next leg needs and never past 80%, so stops stay short. Highway chargers are demo data.
- **From / To:** type any start or destination in Malaysia (our places first, then [Photon](https://photon.komoot.io) OpenStreetMap search) or tap the location button to start from your GPS position, which never leaves the phone. Destinations over about 40 km become a long trip automatically.
- **Real roads and traffic:** routes come from [OSRM](https://project-osrm.org) (OpenStreetMap routing): the blue road line on the map with its time, an alternative route, turn-by-turn steps, and trip plans re-checked against real road distances. Times are for free-flowing roads, so a typical-traffic estimate for the hour is shown beside them (not live). Live traffic colours come from TomTom when the server has `TOMTOM_KEY`; the server fetches the tiles so the key stays hidden.
- **Preferences, schedule and prices:** a budget, fast-DC-only and a preferred operator shape the picks; the smart schedule says when the next 24 hours are cheaper (residents at TNB peak are sent to 10 PM off-peak); "Compare prices" lists every suitable charger by the cost of your charge.
- **Idle-hour sharing:** condo bays open to outside drivers during the hours the JMB sets, with residents first. Visitors enter their number plate and are approved automatically while the condo is sharing. Booking checks enforce the sharing window, resident-protected capacity and conflicting reservations; only the booker can cancel a pending reservation.
- **During the charge:** picks near your destination show the walk ("7 min walk to KL East Mall"); the charging screen gives the slot end time, notifications and the overstay fee that keeps shared bays moving. Activity shows reservation, check-in, in-progress and completed charging states. Cancelling before charging starts removes the pending booking estimate rather than displaying it as a paid session.
- **JMB:** the portal now has four focused tabs: **Overview** (monthly forecast KPIs, average-day use and illustrative six-month income), **Operations** (live OCPP bays, charger faults, maintenance, visitors and **Recorded charging activity**), **Financials** (operating surplus, owner benefits and reports), and **Governance** (sharing settings, proposals, voting and resident access management). The condo selector and JMB login remain accessible. Driver behaviour still includes follow rate, savings, weekly trend, mode breakdown and an anonymous session log with CSV export.
- **Auto-share (JMB):** besides fixed hours, a condo can choose Auto: visitor bays open whenever residents are not expected to need them (7 AM–10 PM only), always keeping the chosen number of bays spare on top of expected residents plus a 10% buffer. The portal compares a month of Auto with fixed hours (Lumina: about +RM170 for the JMB).
- **Residents vote:** any change to sharing is a proposal residents vote on in the driver app (Account, with a nudge on Home). It passes on a simple majority with at least 10% of units voting, and only then takes effect. The JMB can pause sharing at once. Voting uses JMB-issued resident keys linked to a verified condominium unit (one vote per unit); keys without a verified unit permit resident booking but not voting. Votes are anonymous totals; sample votes for the demo are labelled and non-binding.
- **Resident access management:** an authenticated JMB can verify a unit, issue a resident key, copy the newly generated key with the **Copy Resident Key** button and revoke keys when needed. Keep real credentials out of the public demo.
- **"My condo earned":** residents see this month's charging income for their condo, how much came from visitors using idle bays, where the money goes and what it is worth off their fee.
- **Cost recovery and operations (JMB):** forecast receipts minus TNB electricity, other variable costs, fixed costs and logged repairs give the forecast operating surplus, split between the JMB and the charging partner, with break-even kWh (the method in our proposal, section 6.2). Underused hours are flagged against the sharing hours. The PIN-gated maintenance log records faults, repairs and services with costs; a faulty bay leaves service for drivers until a repair is logged. A forecast performance report downloads as CSV; metered OCPP records are available separately in Operations.
- **OCPP 1.6-J (shared mode):** the server is a small central system for the condo bays. Chargers connect over WebSocket to `/ocpp/<condo>-<bay>` (subprotocol `ocpp1.6`, HTTP Basic auth, OCPP security profile 1) and send BootNotification, Heartbeat, StatusNotification, Start/StopTransaction and MeterValues. A Faulted status is logged in the maintenance log and takes the bay out of service; going back to Available logs the repair. Smart charging sends SetChargingProfile so the bays charging share the condo's safe load limit (60% of nameplate until an electrical assessment sets `loadLimitKw`). The demo starts one simulated charger per condo bay; the JMB page shows them live and can simulate a fault.

### Recorded charging sessions (new backend API)

A confirmed residential booking can be checked in to a connected OCPP bay. The returned one-time charger tag links a matching `StartTransaction`/`StopTransaction` to metered kWh and a **calculated receipt**. The integration now appears in **JMB → Operations → Recorded charging activity**, with a month selector, completed sessions, energy, calculated receipts and an estimated JMB allocation. The authenticated API is `GET /api/jmb/:condoId/charging-revenue?month=YYYY-MM`; booking check-in is `POST /api/bookings/:id/check-in`. **Overview and the illustrative six-month chart remain forecasts**, not recorded revenue. Demo OCPP receipts are labelled DEMO; none of these calculated receipts proves that a payment was collected. The platform does not process real payments or remotely start physical chargers.

## Data

- **Public chargers:** live from [Open Charge Map](https://openchargemap.org) when a key is set; otherwise a saved copy (up to 7 days old) or the built-in demo list. The header shows which.
- **Simulated:** the OCPP chargers (energy runs 60x faster), condo bays (fictional condos), occupancy, and six months of session history. The JMB average-day and six-month income charts are **illustrative scenario outputs**, not payment records; the authenticated recorded charging panel is separate. Prices come from public 2026 rates; unknown operators show "est.".

### Open Charge Map key

1. Sign up at openchargemap.org → My Profile → My Apps → create an app key.
2. Put it in `config.js`: `export const OCM = { key: 'YOUR_KEY', ... }`.
3. Reload. The header should read "Chargers: live from Open Charge Map".

## 60-second demo script

1. **Driver**, Wed 11 AM, battery 35%, "Not a resident here": three picks with reasons; condo pins tagged "Shared now".
2. Drag battery to 8%: Urgent mode, the nearest DC charger wins. Back to 75%: Saver mode, cheaper chargers first.
3. Set "How long will you park?" to 2 h: condo bays now qualify and show "+93 km in your 2 h stop" (at 30 min they are dropped as too slow). Book a shared condo bay (from the picks or "Choose another charger"): enter plate WXY 1234, tick consent → "Approved, show plate at the guardhouse", plus how it compares with the nearest charger.
   Start charging: "While you charge" shows the walk to the mall, the slot end time and the overstay fee (RM1 per 10 min after the slot).
4. **JMB**, Residensi Lumina: open **Operations** to check expected visitors, live OCPP bays and the separate recorded charging panel. Open **Overview** for the average-day and six-month illustrative charts. Driver behaviour still shows follow rate, savings and an anonymous session log with CSV export.
5. Open **Governance** to pause sharing (visitors can no longer make new bookings), review a resident proposal and issue a verified resident key. The financial charts are simulated; do not present their forecast as a collected payment.

## Run locally

Shared mode (website + API, bookings shared across browsers):

    npm install
    npm start
    # open http://localhost:4300

Local mode only (no server; everything stays on one device, like GitHub Pages):

    python -m http.server 8765
    # open http://localhost:8765

The header shows which mode is running: "Shared demo" or "This device only".

## Shared demo on Render

One free Render web service serves both the website and the API (`render.yaml`).

1. Sign in to render.com with GitHub → **New → Blueprint** → pick this repo → **Apply**.
2. Optional: set `OCM_KEY` (Open Charge Map key) in the service's Environment tab. The key stays on the server.
3. Open the service URL. The first visit after 15 minutes idle can take up to a minute while it wakes.

Live TomTom data: get a free key at developer.tomtom.com (My Dashboard → Keys), then add `TOMTOM_KEY` in Render → Environment. With it, the server (which keeps the key) adds:
- **Live bays** for stations that report them (about 25 of 77 around KL East), shown as "Live: 2 of 2 free" and used for ranking when the demo time is "Right now". Stations we did not have are added to the map.
- **Routes with live traffic**: times for leaving now, the delay, slow sections in amber or red on the route, and turn-by-turn steps.
- **Incidents**: roadworks, jams, accidents and closures on your route, and an Incidents switch on the Map tab.
- **Live traffic** colours on the map.

Answers are cached (stations 6 h, bays 5 min, routes 3 min, incidents 5 min) to stay inside the free daily allowance.

AI agents: set `AI_API_KEY` (or `DASHSCOPE_API_KEY` for Qwen) in Render → Environment. The server code defaults to Qwen through DashScope (`AI_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1`, `AI_MODELS=qwen-plus-latest,qwen-flash`), while `render.yaml` can define different deployment defaults; always check the actual Render environment. The live agent was also validated using Google Gemini: `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `AI_MODELS=gemini-2.5-flash`, and optionally `AI_TIMEOUT_MS=60000`. Provider keys must match their endpoint; never commit or expose them. Limits: 20 questions per visitor per 10 minutes and 1,500 a day. Without a key, the Ask input only extracts trip preferences; it cannot answer conversational scheduling, booking-policy or revenue questions. Check `/api/config` for `"ai": true` before live-agent evaluation (this confirms configuration, not provider authentication).

OCPP: real chargers would use `OCPP_PASSWORD` (set it in Render). Without it, only the built-in simulator can connect. `OCPP_SIM=0` turns the simulated chargers off.

The public demo is shared by everyone and resets when the server restarts. Do not enter a real number plate.

### JMB PINs for the demo

| Condo | PIN |
|---|---|
| Residensi Lumina | 4821 |
| Serini Park | 7305 |
| Kenanga Heights | 1946 |
| Vista Melati | 5582 |
| Azalea Suites | 3017 |
| Teratai Residence | 6643 |

Without the PIN, the JMB portal shows public forecast information and totals only. Plates, recorded charging activity, resident-key issuance, the private session log and sharing controls require authentication for that condo. For a real pilot, set `JMB_PINS` as JSON (for example `{"lumina":"…"}`) in Render.

## Tests

    npm test

Engine modules (`engine/`) are pure and covered by `node --test`.

## Four-charger pilot verification

Run `npm run pilot:verify` for an isolated end-to-end four-AC-bay test of resident-protected visitor sharing, booking-linked OCPP charging, meter-based receipts and the JMB reconciliation report. The test does **not** change normal app data or connect to physical chargers. It verifies the demo workflow, not field readiness or permission to operate real equipment.


## Phase 8 — End-to-end acceptance

Run `npm run acceptance:verify` for a reproducible, isolated HTTP + OCPP + governance + mocked AI acceptance suite. The command recreates `acceptance-results/` and saves a machine-readable verdict at `acceptance-results/phase8-latest.json` (ignored by Git). Run `npm test` for the full regression suite. The automated test does **not** use actual charging hardware, payment services, real resident data, or an external model; device and live-provider checks must be performed separately.

### Controlled demo: complete a booking-linked simulated OCPP session

By default, checking into a residential bay waits for an actual OCPP charger to initiate charging. This is intentional: **CasSama cannot remotely start physical equipment.** For the hackathon demonstration only, start a fresh local development server with `DEMO_OCPP_CONTROLS=1 npm start` (keep `OCPP_SIM` enabled). The bundled OCPP simulator then disables random background sessions so booked bays remain available. Reload the frontend and create a fresh booking (the one-time tag from an earlier tab is not restored). After a booking during the **actual server-clock interval**, choose an OCPP bay, check in, and select **Start simulated charge** → **Complete simulated charge** on Activity. The simulator sends a real booking-linked OCPP 1.6-J `Authorize`, `StartTransaction`, `MeterValues` and `StopTransaction` sequence to the existing backend. The UI progresses to Complete, and JMB's **Recorded charging activity** shows a clearly labelled **DEMO** session with calculated (not collected) receipts.

The demo control is *disabled by default*, requires both the booking's private cancellation token and one-time OCPP authorization tag, and works only when the assigned charger connection is owned by CasSama's simulator. Demo kWh is server-chosen (up to 5 kWh, capped using illustrative 7 kW AC and slot length); users cannot submit fabricated meter values. Do **not** enable the control on a production/field charger deployment. Normal `npm start`, real chargers, JMB governance and forecast calculations retain their prior behaviour. `OCPP_SIM=0` disables the simulator and these demo actions regardless of the demo flag.
