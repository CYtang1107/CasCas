# CasCas

Shared EV charging for Sime Darby Property townships. Prototype for the SDP University Hackathon 2026 (Planet track).

**Live demo:** https://cytang1107.github.io/CasCas/

## What it shows

- **Driver:** battery-aware picks across every provider around KL East. Low battery gets the nearest working charger; high battery gets cheaper, quieter ones, with demand balancing that keeps busy fast chargers free for drivers who need them. Every booking records (anonymously) whether the driver took a CasCas pick and what it saved vs the nearest charger.
- **Ask CasCas:** type a trip in plain English ("Atto 3 at 20%, going to KL East Mall for 2 hours, under RM1.20, prefer Gentari") and the form fills itself. Rule-based, so it works offline and never guesses.
- **Long trips:** pick a longer trip (Seremban, Port Dickson, Melaka, Ipoh, Johor Bahru, Penang) or ask "Atto 3 at 71%, going to Melaka, arrive with 23%". The plan shows start battery, each leg, every fast-charging stop (arrive % → leave %, minutes, kWh, cost) and the battery on arrival, on the map too, with Google Maps directions. It charges only what the next leg needs and never past 80%, so stops stay short. Highway chargers are demo data.
- **Preferences, schedule and prices:** a budget, fast-DC-only and a preferred operator shape the picks; the smart schedule says when the next 24 hours are cheaper (residents at TNB peak are sent to 10 PM off-peak); "Compare prices" lists every suitable charger by the cost of your charge.
- **Idle-hour sharing:** condo bays open to outside drivers during the hours the JMB sets, with residents first. Visitors enter their number plate and are approved automatically while the condo is sharing.
- **During the charge:** picks near your destination show the walk ("7 min walk to KL East Mall"); the charging screen gives the slot end time, notifications and the overstay fee that keeps shared bays moving.
- **JMB:** charging income, saving per unit, sharing settings, charger health, expected visitors (plates for the guardhouse), and driver behaviour: follow rate, savings, weekly trend, mode breakdown and an anonymous session log with CSV export.
- **Cost recovery and operations (JMB):** receipts minus TNB electricity, other variable costs, fixed costs and logged repairs give the operating surplus, split between the JMB and the charging partner, with break-even kWh (the method in our proposal, section 6.2). Underused hours are flagged against the sharing hours. The PIN-gated maintenance log records faults, repairs and services with costs; a faulty bay leaves service for drivers until a repair is logged. A monthly performance report downloads as CSV.
- **OCPP 1.6-J (shared mode):** the server is a small central system for the condo bays. Chargers connect over WebSocket to `/ocpp/<condo>-<bay>` (subprotocol `ocpp1.6`, HTTP Basic auth, OCPP security profile 1) and send BootNotification, Heartbeat, StatusNotification, Start/StopTransaction and MeterValues. A Faulted status is logged in the maintenance log and takes the bay out of service; going back to Available logs the repair. Smart charging sends SetChargingProfile so the bays charging share the condo's safe load limit (60% of nameplate until an electrical assessment sets `loadLimitKw`). The demo starts one simulated charger per condo bay; the JMB page shows them live and can simulate a fault.

## Data

- **Public chargers:** live from [Open Charge Map](https://openchargemap.org) when a key is set; otherwise a saved copy (up to 7 days old) or the built-in demo list. The header shows which.
- **Simulated:** the OCPP chargers (energy runs 60x faster), condo bays (fictional condos), occupancy, and six months of session history. Prices come from public 2026 rates; unknown operators show "est.".

### Open Charge Map key

1. Sign up at openchargemap.org → My Profile → My Apps → create an app key.
2. Put it in `config.js`: `export const OCM = { key: 'YOUR_KEY', ... }`.
3. Reload. The header should read "Chargers: live from Open Charge Map".

## 60-second demo script

1. **Driver**, Wed 11 AM, battery 35%, "Not a resident here": three picks with reasons; condo pins tagged "Shared now".
2. Drag battery to 8%: Urgent mode, the nearest DC charger wins. Back to 75%: Saver mode, cheaper chargers first.
3. Set "How long will you park?" to 2 h: condo bays now qualify and show "+93 km in your 2 h stop" (at 30 min they are dropped as too slow). Book a shared condo bay (from the picks or "Choose another charger"): enter plate WXY 1234, tick consent → "Approved, show plate at the guardhouse", plus how it compares with the nearest charger.
   Start charging: "While you charge" shows the walk to the mall, the slot end time and the overstay fee (RM1 per 10 min after the slot).
4. **JMB**, Residensi Lumina: the plate is in "Expected visitors"; "Driver behaviour" shows the follow rate, savings and your booking at the top of the session log (anonymous). Export CSV.
5. Turn sharing off: visitors can no longer book; income falls.

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

Without the PIN, the JMB tab shows income and totals only. Plates, the session log and sharing settings need that condo's PIN. For a real pilot, set `JMB_PINS` as JSON (for example `{"lumina":"…"}`) in Render.

## Tests

    npm test

Engine modules (`engine/`) are pure and covered by `node --test`.
