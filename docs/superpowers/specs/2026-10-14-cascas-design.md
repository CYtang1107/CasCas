# CasCas prototype: design spec

Date: 2026-10-14
Status: approved in conversation, awaiting written-spec review
Competition: Sime Darby Property University Hackathon 2026, "Township of Tomorrow", Planet track
Deadline: proposal submission 2026-10-23 23:59 (prototype/code link is a required component)
Research: https://docs.google.com/document/d/1Yp6YD65kTBvHcK1LI8_fsMFm1HufMA65CWj7IQDzfD8/edit

## 1. Purpose

A clickable, always-online prototype that judges can open from the submission link and that the team can record for the 5-minute demo video. It must make the three differentiators visible and believable:

1. **Battery-aware demand balancing** across all charging providers.
2. **Idle-hour sharing**: condo chargers open to outside drivers at set times, with residents first.
3. **JMB income dashboard**: what each owner gains, using honest numbers (about RM10–20 per unit per month).

"CasCas" is a working name. All names live in one config constant so a rename is a single edit.

### Success criteria

- Opens from a public GitHub Pages URL with no login, no install and no server.
- A judge can complete the driver flow (trip → pick → book → charge → check-in) in under 2 minutes on a phone.
- Changing battery % or the demo clock visibly changes the recommendations and their reasons.
- JMB and SDP screens show figures that follow from the same engine as the driver screen and are consistent with the research doc's unit economics.
- Engine modules pass `node --test`.

### Out of scope

Real provider APIs, real payments, user accounts, a shared backend database, real road routing, push notifications, Bahasa Malaysia labels (stretch only).

## 2. Approach

Static web app on GitHub Pages under the user's account (same pattern as VO-AI):

- Plain HTML, CSS and JavaScript ES modules. No build step, no framework.
- Map: Leaflet (pinned version from cdnjs/unpkg) with OpenStreetMap tiles.
- All data simulated in the browser. Per-device state (bookings, check-ins, JMB settings) in `localStorage`, wrapped in try/catch, with a "Reset demo" button.
- Engine logic in pure modules with no DOM access, tested with `node --test`.

Accepted limitation: a booking made on one device does not appear on another.

## 3. Structure

```
cascas/
├── index.html            shell, role switcher, demo clock
├── styles.css
├── app.js                router: #driver | #jmb | #sdp, shared state, clock
├── config.js             product name, tagline, constants
├── data/
│   ├── chargers.js       ~25 chargers around KL East
│   ├── condos.js         6 condos (fictional names, SDP KL East setting)
│   ├── tariff.js         TNB ToU + provider price tables
│   ├── cars.js           4–5 common Malaysian EVs
│   └── demand.js         simulated occupancy by charger × hour × weekday/weekend
├── engine/
│   ├── geo.js            distance, detour estimate
│   ├── score.js          per-charger cost/time/risk score + reasons
│   ├── balance.js        demand-balancing penalty and message
│   ├── sharing.js        is a condo bay open to outsiders at time t
│   └── economics.js      revenue split, per-unit saving, payback, CO₂
├── views/
│   ├── driver.js
│   ├── jmb.js
│   └── sdp.js
└── test/
    ├── score.test.js
    ├── balance.test.js
    ├── sharing.test.js
    └── economics.test.js
```

## 4. Data model

**Charger**
`{ id, name, operator, lat, lng, type: 'AC'|'DC', kw, connectors: ['Type2'|'CCS2'], siteType: 'condo'|'mall'|'public', condoId?, bays, reliability (0–1), priceTable }`

Operators: condo operator (partner CPO), Gentari, ChargEV, JomCharge, DC Handal, Tesla (non-Tesla price). Prices from the research doc:
- AC public about RM0.90–1.15/kWh
- DC Gentari RM1.30–1.80, JomCharge about RM1.20–1.40, ChargEV RM1.13–1.50, Tesla RM1.80

**Condo**
`{ id, name, units, bays, jmbShare (0–1), monthlyFee, sharing: { enabled, days, start, end, reservedBays, visitorPrice }, residentPrice }`

**Tariff**
TNB domestic ToU: peak weekdays 14:00–22:00 at 28.52 sen/kWh, otherwise 24.43 sen/kWh. Condo electricity cost uses this. Condo resident price defaults to RM0.90/kWh and the visitor price to RM1.10/kWh.

**Car**
`{ id, name, batteryKwh, efficiencyKwhPerKm, acKw, dcKw, connectors }`. The default is Proton e.MAS 7.

**Demand**
Deterministic occupancy 0–1 per charger for each hour, with weekday and weekend profiles. Condo sites: evening and overnight peak from residents, idle daytime. Mall: afternoon and evening peak. Highway DC: commute peaks.

## 5. Engine

All functions are pure, take explicit inputs, and return plain objects.

### score.js

For each charger the car can use (connector match, and within remaining range with a 10% buffer):

- `kWhNeeded` = energy from current % to target % (default 80%), capped by the battery size.
- `cost` = kWhNeeded × price at the arrival hour. Condo chargers use the resident price for residents and the visitor price for outsiders.
- `detourMin` = (distance to charger + charger to destination − direct distance) × road factor 1.3 ÷ 30 km/h average.
- `waitMin` = predicted occupancy at the arrival hour mapped to a queue estimate (0 below 0.6, rising to 20 min at 1.0).
- `chargeMin` = kWhNeeded ÷ min(charger kW, car AC/DC kW).
- `risk` = 1 − reliability.

`score = wCost·normCost + wTime·normTime + wRisk·risk`, where each term is normalised 0–1 across the candidate set. Lower is better.

Modes are set by battery %:

| Mode | Battery | wCost | wTime | wRisk |
|---|---|---|---|---|
| Urgent | ≤15% | 0.1 | 0.6 | 0.3 |
| Balanced | 16–50% | 0.4 | 0.4 | 0.2 |
| Saver | >50% | 0.6 | 0.25 | 0.15 |

The function returns a ranked list. Each item carries `reasons[]`, short phrases such as "RM6.40 for 30 kWh", "+4 min detour", "97% reliable", "Off-peak price" and "Shared condo bay".

### balance.js

In Saver mode, a charger whose predicted occupancy is ≥ 0.8 gets a penalty of +0.25 on its score. If the top pick changes because of this, a `balanceNote` is attached: "Leaving the busy fast charger at X for low-battery drivers. You save RM Y." The penalty never applies in Urgent mode.

### sharing.js

`isOpenToVisitors(condo, datetime)` checks `sharing.enabled`, the day and the time window. It also returns available visitor bays (`bays − reservedBays − resident occupancy`). Condo chargers that are not open are excluded for outside drivers, and are always available to residents of that condo.

### economics.js

Per condo per month, from simulated demand:

- `kWhSold` = resident kWh + visitor kWh
- `revenue` = resident kWh × residentPrice + visitor kWh × visitorPrice
- `electricityCost` = kWh × ToU rate by hour
- `margin` = revenue − electricityCost
- `jmbIncome` = margin × jmbShare
- `perUnitSaving` = jmbIncome ÷ units
- `paybackMonths` = bays × 6,000 ÷ margin
- `co2AvoidedKg` = kWh ÷ 0.15 × (0.16 − 0.15 × 0.74)

Reference check (must hold in tests): 10 bays × 7 kW × 4 h × 30 days, price 0.90, cost 0.30, share 0.7, 300 units → 8,400 kWh, margin RM5,040, JMB RM3,528, RM11.76 per unit, 12 months payback.

## 6. Screens

### Shared

- Header: product name, role switcher (Driver | JMB | SDP), demo clock with presets ("Now", "Tue 6:30 PM peak", "Sat 10 AM", "Wed 2 AM") plus a free picker.
- "Reset demo" in the footer.
- Responsive: the driver screen is phone-first, JMB and SDP are laptop-first and stack on phones.
- Light and dark themes.

### Driver (#driver)

1. Trip panel: car select, battery slider (5–100%), destination (KL East Mall, Melawati, KLCC, Wangsa Maju LRT, "Near me" = map centre), "I live at" (none or one of the condos), need-by (now / within 2 h / overnight).
2. Map: price pills per charger (RM/kWh, ⚡ for DC). Green = top 3, grey = available, red = busy or faulty, and a "Shared now" tag on condo chargers open to visitors. Tapping a pill shows details.
3. Recommendation list: top 3 with reasons and the balance note when present. A mode badge (Urgent / Balanced / Saver).
4. Book: holds for 15 minutes with a countdown and a QR placeholder that starts the session.
5. Session: sped-up counter (1 s = 1 min) showing kWh, RM and battery %, with a Stop button.
6. Check-in: "Worked" or "Problem" plus an optional note. This updates that charger's reliability (stored locally) and its fault list for the JMB view.

### JMB (#jmb)

Condo selector (defaults to the first condo).

- KPI row: income this month, JMB share, **saving per unit per month**, kWh delivered.
- Usage by hour: 24-bar chart split by resident and visitor, with peak hours shaded.
- Income for the last 6 months: line chart split by resident and visitor.
- Fee impact: "Management fee held at RM X instead of RM X + saving", plus a sinking-fund boost bar.
- Sharing settings form: enabled, days, open hours, reserved bays, visitor price. Projected income updates live, and the settings feed the driver screen.
- Charger health: one row per bay with status, reliability and recent problem check-ins.

### SDP / operator (#sdp)

- Township KPIs across all condos and the mall: kWh, income returned to JMBs, CO₂ avoided, average utilisation.
- Condo comparison table: utilisation, income, per-unit saving, sharing on or off. The data should show sharing condos earning more.
- Scale-up calculator: slider from 1 to 28 townships, showing projected chargers, JMB income, CO₂, and the share of the national 30,000-by-2030 target.
- Pilot readiness checklist: CPO partner, JMB resolution, TNB sub-meter, Energy Commission CPO registration, Bomba/council approval. Each item has a one-line note from the research.

Charts are hand-built SVG drawn from theme tokens, with no chart library.

## 7. Error handling

- No reachable charger: "No charger in range at this battery level" with the nearest option and its distance.
- Leaflet or tiles fail to load: the list view still works, and a notice replaces the map.
- `localStorage` unavailable: the app runs with in-memory state and "Reset demo" still works.
- Invalid JMB settings (start time after end time, reserved bays above total bays) are blocked inline with a message.

## 8. Testing

`node --test` over `test/`:

- score: a 5% battery picks the nearest working DC even when it is pricier; at 70% battery a cheaper charger further away wins; connector mismatch is excluded; out-of-range is excluded.
- balance: in Saver mode a busy charger is demoted and a note is produced; in Urgent mode there is no penalty.
- sharing: open and closed by day and time; reserved bays respected.
- economics: the reference case in section 5 matches exactly; CO₂ for 840 kWh is about 274 kg.

UI is checked by hand in a desktop and a phone-width browser before each deploy.

## 9. Delivery

- GitHub repo `CYtang1107/CasCas` (public), deployed via GitHub Pages from `main`.
- A README with the live link, a 60-second demo script for the video, and the run-tests command.
- Target: deployed and demo-ready by 2026-10-21, which leaves 2 days for the deck and video.
