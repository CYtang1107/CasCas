# CasCas

Shared EV charging for Sime Darby Property townships. Prototype for the SDP University Hackathon 2026 (Planet track).

**Live demo:** https://cytang1107.github.io/CasCas/

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
3. Set "How long will you park?" to 2 h: condo bays now qualify and show "+93 km in your 2 h stop" (at 30 min they are dropped as too slow). Book a shared condo bay (from the picks or "Choose another charger"): enter plate WXY 1234, tick consent → "Approved, show plate at the guardhouse", plus how it compares with the nearest charger.
4. **JMB**, Residensi Lumina: the plate is in "Expected visitors"; "Driver behaviour" shows the follow rate, savings and your booking at the top of the session log (anonymous). Export CSV.
5. Turn sharing off: visitors can no longer book; income falls.

## Run locally

    python -m http.server 8765
    # open http://localhost:8765

## Tests

    npm test

Engine modules (`engine/`) are pure and covered by `node --test`.
