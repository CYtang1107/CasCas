# CasSama charging lifecycle — backend MVP

**Scope:** GreenGru proposal §1.4.2 (utilisation, revenue, maintenance recovery), §1.4.3 (booking assistance), §6.2 (illustrative financial assumptions), §7.2 (operational risk). This extension keeps the existing driver/JMB frontend unchanged. It is a **single-process demonstration**, not a payment service or a production charger-management system.

## What is now implemented

1. A successful residential reservation (`POST /api/bookings`) still reserves *aggregate* capacity. Visitors obey approved JMB sharing periods and residents must pass resident-key verification.
2. During the reservation, the booker can check into a particular **available, connected, non-faulty** OCPP charging bay using their existing booking ID and cancel token. This assigns the bay and issues a one-time, 18-character OCPP `idTag`.
3. The OCPP 1.6-J charger uses that tag in `Authorize`/`StartTransaction`. The server matches it to the **same bay and booking**. A successful `StartTransaction` snapshots the resident/visitor per-kWh rate, including the peak surcharge if applicable.
4. `MeterValues` update live energy telemetry. A matching `StopTransaction` with a valid cumulative `meterStop` yields measured kWh and an itemised session receipt. Bad readings, disconnections or server restarts are flagged `needs_review`, **not billed**.
5. A PIN-authenticated JMB may retrieve completed, booking-linked charging sessions and a monthly maintenance-recovery calculation. It includes receipts from metered charging only; anonymous OCPP simulator activity and historic scenario forecasts are excluded.

The existing simulated JMB/CPO visual dashboards remain **unchanged and scenario-based**. The new authenticated API gives the frontend team a separate source for *recorded* sessions.

## API contract for frontend integration

All URLs are relative to the same host (`http://localhost:4300` during local development). All POST requests use `Content-Type: application/json`.

### Check in (driver)

`POST /api/bookings/<bookingId>/check-in`

```json
{"cancelToken":"<token received with booking>","bay":1}
```

**201 response:** `{ "sessionId": "...", "bay": 1, "status": "awaiting_charge", "idTag": "CS..." }`.

**403:** cancel token doesn't match. **409:** outside booked time, faulty/offline/occupied bay, or this booking has already checked in. The `idTag` is a single-booking bearer credential, for use at the corresponding charger; it is returned once and never published through world or JMB report endpoints. Keep it private in the driver app.

### Charging progress (driver)

`POST /api/bookings/<bookingId>/charging-status`

```json
{"cancelToken":"<booking cancel token>"}
```

**200 response:** `{"status":"not_checked_in"}` or a session object with `status`, `bay`, `startedAt`, `endedAt`, and (when completed) `energyKwh` and `revenueRm`. Statuses: `awaiting_charge`, `charging`, `completed`, or `needs_review`.

### Monthly booked-charging report (JMB)

First login to `POST /api/jmb/login` using the configured PIN; send `Authorization: Bearer <JMB token>`.

`GET /api/jmb/<condoId>/charging-revenue?month=2026-10`

**200 response:** `condoId`, `month`, `sessionCount`, `sessions` (no plate number or charging tag), `financials` (including `kWh`, `revenue`, `electricityCost`, `variableCost`, `fixedMonthly`, `maintenanceRm`, `operatingSurplus`, `jmbIncome`, `partnerIncome`, `perUnit`), `costAssumptions`, `evidence` and `warning`.

Only sessions completed inside the selected calendar month in **Malaysia time (UTC+08)** appear. Missing `month` defaults to the current Malaysian month. Wrong condo token returns **401**; invalid month **400**.

## How OCPP links a booking

For a charger connected to `ws://<host>/ocpp/lumina-1`:

1. Send `Authorize {"idTag":"CS..."}` with the tag from check-in. Expect `idTagInfo.status = "Accepted"`.
2. Send `StartTransaction {"connectorId":1,"idTag":"CS...","meterStart":10000,"timestamp":"..."}`; expect an accepted transaction ID.
3. Send `MeterValues` as usual; these readings do not by themselves create revenue.
4. Send `StopTransaction {"transactionId":<returned transactionId>,"meterStop":22500,"timestamp":"..."}`; in this example the completed session has `12.5 kWh`.

The backend **does not remotely start** the charger. Hardware must support using the issued `idTag` with its own charging flow. The built-in simulator's random `CASSAMA` transactions intentionally remain **unlinked** to bookings and will not appear in the booked revenue report. For deterministic integration tests, see `test/charging-lifecycle.test.js` (uses a mock OCPP device over real WebSocket).

## Pricing and limits

- Per-kWh rates come from the existing `engine/pricing.js` at **charging start**, using the condo's configured resident/visitor rate and peak surcharge. The rate is a start-time snapshot; long sessions crossing tariff boundaries are not split yet.
- The energy and receipt figures derive from OCPP cumulative meter readings. **Electricity cost RM0.55/kWh, variable cost RM0.05/kWh, fixed RM500/month and JMB share from condo config are illustrative assumptions from proposal §6.2**, not actual supplier invoices or signed contracts.
- A completed booking cannot be cancelled to erase its financial record. Cancelling after check-in but before charging starts removes its pending session and releases its reservation.
- For real pilots: add verified identity and credential revocation, full OCPP authorization (the legacy prototype also permits unlinked demo transactions), electrical assessment and safe aggregate limits, real bay assignment/parking enforcement, signed CPO tariff/fee structures, payment reconciliation, database transactions for concurrent server replicas, time-varying tariff settlement, OCPP reconciliation across device/server reconnects and operational alerts. No fees are charged or collected by these endpoints.
- Never confuse the new *recorded OCPP charges* with pre-existing `simulateCondoMonth()` financial forecasts in the frontend.

## Verify

```bash
npm ci
node --test test/charging-lifecycle.test.js
npm test
```

All added lifecycle tests use independent temporary stores and fake OCPP chargers; no physical hardware or API keys are required.
