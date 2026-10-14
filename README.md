# CasCas

Shared EV charging for Sime Darby Property townships. Prototype for the SDP University Hackathon 2026 (Planet track).

**Live demo:** https://cytang1107.github.io/CasCas/

## What it shows

- **Driver:** battery-aware picks across every provider around KL East. Low battery gets the nearest working charger; high battery gets cheaper, quieter ones, with demand balancing that keeps busy fast chargers free for drivers who need them.
- **Idle-hour sharing:** condo bays open to outside drivers during set hours, with residents always first.
- **JMB:** charging income, saving per unit per month, sinking-fund boost, sharing settings and charger health.

All data is simulated. Condo names are fictional. Prices and tariffs follow public 2026 figures (see the research brief).

## 60-second demo script

1. **Driver**, Wed 11 AM, battery 35%: three picks with reasons; condo pins tagged "Shared now".
2. Drag battery to 8%: the mode switches to Urgent and the nearest DC charger wins.
3. Switch time to Tue 6:30 PM and battery to 75%: Saver mode; the demand-balancing note steers you off the busy mall charger.
4. Book → scan → charge → report a problem: the charger's reliability drops.
5. **JMB**: saving per unit, the day chart showing outside drivers filling idle daytime bays. Turn sharing off and watch the income fall.

## Run locally

    python -m http.server 8765
    # open http://localhost:8765

## Tests

    npm test

Engine modules (`engine/`) are pure and covered by `node --test`.
