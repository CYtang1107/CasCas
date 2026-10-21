# CasSama — Four-Charger Pilot Readiness

**GreenGru proposal references:** §1.5 (application scenarios), §1.4.1–1.4.3 (three functional categories), §4 (demonstration), §6 (feasibility), §7 (risks), §8 (implementation).

## What this provides

A **repeatable, isolated proof-of-workflow** for a fictional residential site with **four 7 kW AC Type 2 charging bays** and one pilot CPO. This is a software test, not a real-world launch or certification. The default app's condo configurations and your server's runtime data are **not modified**.

Run from the repository root after `npm ci`:

```bash
npm run pilot:verify
npm test
```

The pilot verifier starts its **own temporary HTTP/OCPP server**, uses a mock OCPP 1.6-J charge point for each bay, runs the scenario, and removes its temporary database. No live stations, payment accounts, network API keys, or JMB login sessions are required. It uses a fixed simulation time of **Wednesday, 21 October 2026, 11 AM Malaysia time**, to keep bookings repeatable and within the approved sharing window.

**Do not expect the 4-bay fixture to appear in the normal phone app.** This is an isolated scenario tested through the actual backend endpoints; the default Lumina demonstration remains configured with 10 fictional bays. `createApp({ condos })` and the charger-data builder accept an optional fixture only for controlled simulation/testing.

## Scenario configuration (assumptions, not verified site facts)

| Item | Pilot assumption |
| --- | --- |
| Development | Fictional Residensi Lumina; not an approved live site |
| Chargers | 4 AC Type 2 bays, modeled at 7 kW each |
| Resident protection | 1 bay held from visitors |
| Visitor allowance | Up to 3 simultaneous bookings, subject to actual resident use |
| Visitor hours | Weekdays, 9 AM–5 PM |
| Example power cap | 16 kW simulated configuration; **not an electrical engineering assessment** |
| Visitor price | RM1.10/kWh (configured demo rate) |
| Resident rate | RM0.90/kWh, plus configured peak surcharge if applicable |
| Cost assumptions | Electricity RM0.55/kWh; other variable RM0.05/kWh; fixed RM500/month; JMB share 30% of **positive** operating surplus |

For a real site, commission a competent electrical assessment and verify tariffs, ownership, regulatory permissions, capital expenditure, connection arrangements, and actual revenue-sharing terms *before* enabling physical chargers or visitor access.

## GreenGru scenario 1 — Sharing + maintenance recovery

The test covers the following API/OCPP sequence:

1. All four mock AC charge points connect and report `Available`.
2. Three visitors reserve the same daytime interval; the fourth visitor request returns **409** and suggested later times.
3. A resident cannot book without a JMB-issued access key (**403**); a verified resident can book the protected fourth bay.
4. An additional resident is blocked once all four physical bays are reserved (**409**).
5. One visitor checks in at bay 1 and one resident at bay 4. OCPP charger tags are tied to the *right booking and bay*.
6. OCPP `StartTransaction`, `MeterValues` and `StopTransaction` settle **12.5 kWh** for the visitor and **10 kWh** for the resident.
7. An authenticated JMB report shows **two** valid completed charging sessions, **22.5 kWh** and **RM22.75 calculated charging receipts**. There is no assumption that this money was paid.
8. Under the illustrative RM500 fixed monthly cost, the example period has an **operating deficit** and **RM0 allocated to the JMB**. This is a *critical* caveat for the maintenance-cost-recovery claim.
9. A logged charger fault prevents check-in, and a JMB-recorded repair restores that bay's eligibility.
10. No vehicle plates, access keys or charger authorization tags are present in the JMB financial response.

The sample calculation is **not** the proposal's RM715/month base case. The base case in §6.2 assumes **4,050 kWh/month** and is a separate demand scenario. Do not label two simulated charging sessions as measured site utilisation or audited revenue.

## GreenGru scenario 2 — AI-assisted charging planning

The second pilot test calls the existing deterministic charging recommendation engine with an EV that supports Type 2. It checks that:

- The condo AC charger is recommended during approved visitor sharing hours and within the driver's charging needs.
- The same charger is **excluded** from outside-visitor recommendations after sharing closes.

The existing project tests separately cover routing, vehicle/range filtering, operator prices and the AI agent's tool workflow. This fixture does **not** evaluate an LLM's quality or call any live LLM provider.

## Suggested 6-minute judge demonstration (running normal app)

This is a **script for the normal web app**, where the default development contains ten Lumina bays. To show **exactly four physical bays**, present `npm run pilot:verify` and its printed evidence; do **not** imply that the normal UI has been reconfigured to four.

1. **0:00–1:00 — Why:** JMB maintenance pressures and unused residential charging capacity. State that figures are illustrative.
2. **1:00–2:00 — JMB:** Show approved visitor sharing hours and resident-priority policy.
3. **2:00–3:00 — Driver:** Use the charging locator, compare prices, show eligible residential charging or an AI-assisted recommendation.
4. **3:00–4:00 — Booking:** Confirm a resident/visitor reservation and explain the server-side 409 capacity check. For an authentic on-screen check-in, use a real-time reservation and a connected OCPP simulator.
5. **4:00–5:00 — Recorded charging:** Explain that booking-specific charging requires the OCPP device to use the issued `idTag`; the random simulator's `CASSAMA` activity does **not** count as recorded revenue.
6. **5:00–6:00 — Finance:** Show the authenticated JMB recorded report separately from simulated forecasts, then run `npm run pilot:verify` to demonstrate meter-to-report traceability.

**Do not change your Mac clock or bypass the booking-time rules for a demo.** The automated pilot uses a controlled server clock; the normal UI and server use real time for check-in.

## What remains before field deployment

- **Site permission:** Written JMB/MC and parking-bay rights approval; approved visitor-access procedures; CPO commercial agreement.
- **Electrical safety:** Competent site inspection, load capacity, protection, equipment certification and applicable ST/local approvals. The sample 16 kW cap is not a safety finding.
- **Real charger integration:** Authorised OCPP/CPO integration, charger identity and physical-bay mapping, network failure behaviour, overstay and access enforcement.
- **Identity/privacy:** Verified resident accounts, revocable short-lived credentials, PDPA controls, data retention and incident response.
- **Payments/finance:** Verified invoices, collection status, billing disputes, metering reconciliation, actual electricity costs, capex and taxes, and signed JMB/CPO allocation terms.
- **Deployment:** Transactional storage if more than one server instance, monitoring/alerts, backups and recovery, penetration testing, mobile-device testing.

**Interpretation:** Passing the pilot tests establishes that the **prototype workflows** operate as designed under a repeatable simulation. It does not establish customer demand, project profitability, regulatory clearance, electrical safety or real-world charger interoperability.
