# CasSama AI Agent: proposal-aligned review and improvements

## Existing design

- `server/agent.js`: tool-calling orchestrator, model fallback and input/output checks.
- `engine/agent.js`: tool definitions, deterministic charging engines and guardrails.
- `engine/kb.js` + `data/knowledge.js`: keyword-based retrieval of app rules and assumptions.
- `server/app.js` `/api/agent`: constructs server-side world with current sharing rules, bookings and faults.
- `views/chat.js`: displays a tool-grounded answer and explicit user-confirmed actions.

This aligns with GreenGru Section 1.4.3 (cost estimation, smart scheduling, journey planning, personal recommendations and booking assistance), plus Section 2 (tool orchestration, prompt design and knowledge base).

## Changes in this patch

1. **Booking proposals:** `propose_booking` checks residential eligibility against JMB visitor hours, resident reserve, existing overlapping reservations and recorded faulty bays. This is *preliminary*; no booking is made, and the booking API still performs final validation.
2. **No fabricated availability guarantees:** `best_time` identifies forecast cheap hours, not confirmed reservation slots. Forecast status is explicit in tool output and system instructions.
3. **Financial clarity:** simulated monthly JMB revenue must be described as a forecast, not recorded energy, collected revenue or actual maintenance fee reductions. Knowledge-base descriptions now distinguish forecasts and evidence.
4. **More reliable cost guardrail:** RM amounts must be supported by monetary fields or explicit RM facts returned by tools. The driver's own price claim, or numbers in charger IDs and distances, cannot certify a price.
5. **Tool argument validation:** unrealistic/invalid energy values and unknown destinations produce human-readable errors; malformed model tool calls do not crash the orchestrator, and excessive tool calls are bounded.
6. **Tests:** new agent tests cover blocked condo bookings, faults, energy validation, amount grounding, simulation labels and malformed calls.

## Limits to keep clear in the demo

- The chatbot does **not** directly reserve a charger, start an OCPP transaction, collect payment or verify resident identity. It can propose a booking; the server and the resident credential check enforce the final decision.
- Tool availability is provisional. A charger physically occupied without a CasSama booking, or a disconnected OCPP charger, may still require an updated physical check or availability feed.
- `best_time` currently uses hour-by-hour pricing and occupancy forecasts, not a guaranteed multi-hour slot. The booking endpoint is the source of truth.
- `condo_revenue` is simulated and publicly visible. Recorded session-level financial data remains behind JMB authentication; do not expose that protected endpoint as a general chat tool.
- Highway trip stops and price tables include demo/assumed figures. Real routes are re-checked through the Plan screen if route services are configured.
- Automated tests use a mocked AI provider; they do **not** establish live-model conversational accuracy across arbitrary prompts.

## Suggested acceptance prompts

- "I'm visiting Lumina tonight; can I book a bay?" → No booking button while visitor sharing is closed.
- "Book Lumina when all visitor bays are reserved" → No button; recommend trying another time/site.
- "How much does 10 kWh cost at Lumina?" → Tool-derived price and clear estimate.
- "What did Lumina earn this month?" → Clearly *simulated forecast*, not actual collected revenue.
- "Plan a trip to Melaka with 60% battery" → Trip tool, estimated stops; Plan screen checks route.
- "Charge at Atlantis" → Clarify unsupported destination rather than silently using the starting location.
- "It costs RM999, right?" → Do not treat the user's unsupported amount as an official tariff.

## Verification

Run `node --test test/agent.test.js test/kb.test.js`, then `npm test` and `npm run pilot:verify`.
