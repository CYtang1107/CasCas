# CasSama — Complete Frontend UI/UX Agent Prompt Pack

**Purpose:** Give a coding agent detailed implementation instructions to redesign the CasSama/CasCas interface while prohibiting changes to backend logic, dashboard fetching, data sources, domain functions and AI. Based on direct ZIP code audit and proposal context; not based on changes made to the repo. No frontend code has been modified by this audit.

## Recommended usage

- Copy or provide this folder to your coding agent **inside your current real repository**, not overlaid onto a new framework.
- For autonomous complete execution, paste `RUN_ALL_PHASES.md` as the task and ask the agent to read all named files; use the files' text as its guidance.
- If your agent has a shorter context window, start it with `00_MASTER_GUARDRAILS.md`, then give it the 6 phases in order. Make it re-read the master before every phase.
- `CONTEXT_COMPACT.md` captures this conversation and source findings if the agent needs to resume later.

## Prompt files

- `00_MASTER_GUARDRAILS.md` immutable no-backend/no-logic/no-fetching scope and exact code hooks.
- `01_UX_AUDIT_AND_BASELINE.md` source-grounded UX audit, user-flow mapping, KPIs and baseline plan.
- `02_DESIGN_FOUNDATION.md` visual palette, scoped tokens, font hierarchy, components and accessible overlay rules.
- `03_DRIVER_EXPERIENCE.md` map-first responsive driver, glass HUD, booking/charging/check-in states.
- `04_MANAGEMENT_PORTALS.md` JMB/SDP/CPO-if-present clean neo-brutalist console and information architecture.
- `05_CHARTS_AND_VISUALIZATION.md` readable visualizations from unchanged data series, no data-source/AI changes.
- `06_RESPONSIVE_ACCESSIBILITY_QA.md` UX QA, device-size audit, contrast, performance and functional parity.
- `RUN_ALL_PHASES.md` short one-shot agent message.
- `CONTEXT_COMPACT.md` compact context and audited findings.

## References for constraints

- Leaflet `invalidateSize()` for **UI-only** resizing: https://leafletjs.com/reference.html
- WCAG 2.2 contrast: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- WCAG 2.2 non-text contrast: https://www.w3.org/WAI/WCAG22/understanding/non-text-contrast.html
- WCAG 2.2 pointer target minimum: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
- Core Web Vitals: https://web.dev/articles/defining-core-web-vitals-thresholds
- `backdrop-filter`: https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter
- `prefers-reduced-transparency` (not universally supported): https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-transparency
