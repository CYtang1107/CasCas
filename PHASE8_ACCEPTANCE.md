# CasSama — Phase 8 End-to-End Acceptance Report

**Project:** GreenGru / CasSama, Sime Darby Property hackathon
**Scope:** Proposal §1.4 (discovery/booking, JMB operations, AI planning), §1.5 (two scenarios), §6 (2–4-charger pilot), §7 (risks and controls)
**Verification date:** 22 October 2026
**Test basis:** Last available CasSama copy incorporating the Gemini endpoint and timeout fixes. The user's local `jirui` branch may contain additional frontend changes not present in this copy.
**Verdict:** **Automated prototype acceptance: PASS**. **Full release acceptance: OPEN** until human UI checks and environment/security checks below are completed.

## 1. How to reproduce

From the project directory (Node.js >=20):

```bash
npm ci
npm run acceptance:verify
npm test
```

`acceptance:verify` runs five scenarios on **temporary, isolated HTTP/OCPP servers**. It saves a machine-readable summary to `acceptance-results/phase8-latest.json`; this folder is intentionally Git-ignored. No normal server data, Google/Alibaba keys, connected physical chargers, real plates, or payment services are accessed. The tests use a fixed local time of **Wednesday 21 October 2026 at 11 AM Malaysia time** to make resident/visitor windows deterministic. `npm test` runs the full regression suite, including the five acceptance scenarios.

**Recorded run on this working copy:** 5/5 acceptance scenarios passed; 259/259 full automated tests passed; 0 failures. The test environment was Node.js v22.16.0. Re-run these commands on `jirui` after applying the patch; this report is not a claim that the local branch or a deployed instance was independently exercised.

## 2. Automated acceptance evidence

| ID | User/business acceptance condition | Test | Result |
| --- | --- | --- | --- |
| A1 | A visitor can book only in allowed sharing hours. Three of four bays may be reserved by visitors; fourth visitor gets **409** with alternatives. Resident can reserve the protected bay using a JMB-issued key. | `test/acceptance.test.js` | **PASS** |
| A1b | Only a booking owner can cancel; valid cancellation frees visitor capacity. A revoked resident credential cannot be reused. Public world data hides booking secrets. | `test/acceptance.test.js` | **PASS** |
| A2 | JMB issues verified-unit keys; unverified keys cannot vote, multiple credentials for the **same unit** count as one vote, demo votes do not count, quorum/majority govern the result. Passed proposal changes sharing settings. | `test/acceptance.test.js` | **PASS** |
| A3 | With a **mock** OpenAI-compatible/Gemini provider, Ask CasSama invokes recommendation tools, generates charger cards and proposes a booking **without writing a booking**. Sensitive card input never reaches the model. | `test/acceptance.test.js` | **PASS (mock AI)** |
| A4 | Four simulated AC OCPP points connect. A linked visitor and resident transaction report 12.5 + 10.0 = **22.5 kWh** and **RM22.75 calculated receipts**. JMB private report excludes booking/plate secrets; a faulty bay blocks check-in. | `test/pilot-readiness.test.js` | **PASS (simulation)** |
| A5 | An eligible Type 2 driver is recommended a shared condo charger during JMB visitor hours, and excluded after closure. | `test/pilot-readiness.test.js` | **PASS (deterministic engine)** |
| R1 | Complete automated regression (booking, revenue reconciliation, agent, API, governance, OCPP, frontend helper logic, etc.). | `npm test` | **PASS: 259/259** |

### Financial interpretation of A4

The pilot's **RM22.75** is calculated from **simulated OCPP meter readings**; it is **not confirmed collected money** or audited billing. With the illustrative monthly fixed operating cost, the simulated operating surplus is approximately **−RM490.76**, so the allocation to the JMB is **RM0**. This is deliberately different from the proposal's **4,050 kWh / RM715 surplus** monthly base-case *forecast*; never combine these two scenarios as though they were one recorded month. The illustrative software load cap is **not an electrical safety assessment**.

## 3. Human acceptance checklist — still to execute

Use **fictional test identities**, a test JMB PIN and a simulator. Record date, browser/device, tester and evidence screenshots in the notes column. Do not invent successful outcomes or use a production key in screenshots.

| ID | Manual action | Expected result | Status / notes |
| --- | --- | --- | --- |
| M1 | Load app on desktop and phone, switch Home → Map → Plan → Activity → Account. | Navigation works, essential actions are reachable and readable without controls covering them. | **PENDING** |
| M2 | On Plan, enter an EV, battery percentage, KL East Mall destination and parking duration. Open the recommended charger from Map. | Ranked compatible charging options and cost estimates match the selected inputs; detail and Book action are usable. | **PENDING** |
| M3 | On Home, ask live Gemini for a charging suggestion, then a cost or scheduling follow-up, then a condo booking policy. | Reply uses tools, retains relevant context, labels forecasts, and offers confirmation rather than booking directly. | **PENDING (user has reported working basic/retested prompts)** |
| M4 | Sign in as JMB. Open visitor sharing hours. Use a **different browser** as external driver to book during those hours. | Approved visitor booking appears, plate only in privileged JMB view. Outside hours or overflow shows a sensible rejection. | **PENDING** |
| M5 | Issue a unit-verified resident key. Test resident booking and governance from a separate browser. | Resident booking succeeds, resident-protected capacity remains; a second key for the same unit does not yield a second vote. | **PENDING** |
| M6 | With OCPP simulator connected, create a booking during **actual current server time**, choose a connected bay and check in. For an isolated hackathon demonstration, restart with `DEMO_OCPP_CONTROLS=1 npm start`, then use Activity → **Start simulated charge** → **Complete simulated charge** (or let a real charger send its own OCPP start/stop events when demo controls are disabled). | Driver activity shows awaiting → charging → completed; JMB **recorded** financial report updates for that booking. Demo simulator sessions are labelled DEMO and are not payments or real energy delivered. | **PENDING** |
| M7 | From JMB, simulate a charger fault and then clear it. | Fault is visible, unavailable bay cannot be checked in, repair restores eligibility. | **PENDING** |
| M8 | Compare JMB forecast panel with recorded session revenue. | Forecast clearly reads **simulated**; recorded figures reflect linked charging sessions, not demo simulator idle energy or payment settlement. | **PENDING** |
| M9 | Try invalid/revoked resident key, incorrect cancellation token, stale booking/check-in, and expired sharing window. | Clear errors, no data corruption, secrets not exposed in public UI or API. | **PENDING** |
| M10 | Verify local/deployed AI is configured with a **fresh, non-exposed key** and provider/model. | `/api/config` reports `ai: true`, live questions answer without timeout, no secrets in Git or screenshots. | **PENDING — rotate any previously exposed API key** |

**Suggested screenshots:** one driver recommendation; one valid visitor booking; one overlapping booking rejection; one JMB sharing screen; one live OCPP/Activity state; one *recorded* revenue report; one governance tally; one live AI answer and tool trace. Capture no plates, access keys, bearer tokens or PINs.

## 4. Six-minute end-to-end judge demo

**Scenario 1 — sharing and maintenance recovery (about 4 minutes):**

1. Show JMB rules: a fictional four-bay pilot protects one resident bay and enables weekday visitor hours. Distinguish the normal demo UI's bay counts from the **four-bay test fixture**.
2. Ask CasSama for charging recommendations or use Map; choose a condo charger only when visitor sharing is allowed.
3. Reserve as a visitor. Show a rejected overlapping booking and one valid resident booking using a JMB-issued key.
4. Show the OCPP-connected bay and booking-linked charging. In a controlled test, demonstrate meter-to-session-to-JMB reporting. Identify **calculated** receipts versus actual payments.
5. Explain resident-priority, faults/recovery and maintenance-cost allocation; do not claim a positive surplus in the 22.5 kWh sample.

**Scenario 2 — AI-assisted planning (about 2 minutes):**

1. Ask Gemini: *“I have 35% battery. Find me an affordable charger near KL East Mall.”* Display ranked cards, price estimates and tool trace.
2. Ask a follow-up about cost or cheaper charging times. Show that a scheduling suggestion is a **forecast**, not a confirmed booking.
3. Explain that accepting a Book action still requires explicit user confirmation and a fresh server-side availability check.

**Demo reliability:** If the live provider is rate-limited or unavailable, use the deterministic Map/Plan results and clearly identify the AI portion as temporarily unavailable. Never fabricate a model answer or present the mock provider as live.

## 5. Release gates

**Already satisfied in the isolated prototype:** authenticated JMB endpoints, resident-protected booking limit, cancellation ownership, simulated OCPP charge-to-revenue linkage, verified-unit vote tally, AI tool orchestration behind a mock provider, full regression suite.

**Required before the hackathon demonstration:** Finish manual M1–M10 (prioritise M3, M4, M6 and M8); rotate the previously shared Gemini API key; verify the exact local branch and deployed environment; keep a reproducible fallback for external AI and map providers.

**Not a field-deployment approval:** actual JMB/MC/CPO authorisation, certified electrical/load assessment and charger commissioning, privacy compliance and production identity verification, payment settlement, real tariff accuracy, multi-instance database consistency, production operations and independent security testing all remain open. The governance mechanism is a prototype voting rule, **not a legally binding strata vote**.

## 6. How to record the human result

Copy the table in §3 into the team QA tracker. For each M1–M10, write `PASS`, `FAIL` (include exact reproduction steps), or `NOT TESTED`; attach a screenshot or log; record the environment (local/deployed), git commit, browser and device. A single failed high-priority booking, revenue or access-control test blocks a **full** acceptance verdict even when the automated suite passes.
