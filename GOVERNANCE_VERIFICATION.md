# CasSama resident governance verification — prototype

## Why this changed

Previously `POST /api/condos/:condoId/proposal/vote` accepted a caller-provided `voterId`. Anyone could submit arbitrary IDs to manufacture votes and quorum. This is now rejected. Device IDs are **never** voter credentials in shared-server mode.

## Shared-server flow

1. JMB logs in using its condo-specific token. JMB **must verify the resident and the unit they are entitled to vote for** using its independent records before issuing a unit-linked key. This app does not independently check ownership or tenancy.
2. JMB dashboard → **Resident Access Management** → enter standardized `unitId` such as `A-12-08` → Generate Resident Key. API: `POST /api/jmb/:condoId/resident-keys` with JMB bearer token and JSON `{"unitId":"A-12-08"}`.
3. Give the one-time-displayed secret privately to the verified resident. The store retains only the SHA-256 hash of the key and an HMAC of the canonical unit reference; it doesn't store plaintext keys or unit labels. Keys are valid for 30 days unless revoked.
4. A resident voting on a proposal enters that credential in the driver app. API: `POST /api/condos/:condoId/proposal/vote` with `{"residentKey":"<secret>","vote":"yes"}` (or `"no"`). The browser keeps the voting secret only in memory for that page session, not in local storage.
5. Server verifies the condo, expiry, non-revocation and unit eligibility, then records **one vote per unit**. An additional issued key for the same normalized unit can modify the vote, not add a vote. Public responses show counts only.
6. A JMB may close a proposal; only votes cast with eligible keys contribute to the 10% quorum and majority rule used by this prototype.

Keys issued earlier without `unitId` **still work for resident bookings**, but are not voting credentials. To vote, request a new key after JMB verifies the unit. For historical proposals created with device IDs, the JMB must create a fresh proposal: those old votes cannot be verified or enacted.

### Non-binding demonstration votes

`POST /api/jmb/:condoId/proposal/sample` creates a **preview** (`demoPreview`) and does **not** add official votes or change sharing rules. The preview is clearly labelled. Actual proposals only pass using verified unit votes. The offline/local-device-only simulation is distinct and must not be used as evidence of resident consent.

### API compatibility

- `POST /api/jmb/:condoId/resident-keys` accepts an optional `unitId`; omission issues a booking-only key for backward compatibility, with `votingEligible:false` in response.
- `GET /api/jmb/:condoId/resident-keys` now includes `votingEligible` on each key metadata entry; no unit address or secret appears.
- `POST /api/condos/:condoId/proposal/vote` **requires** `residentKey`. `voterId` is ignored and returns HTTP 403 without a valid credential.
- Keys revoked by the JMB cannot cast new votes, but revocation does not retroactively erase votes already cast. A unit's valid key can amend the unit's previous vote until the vote closes.

## Limitations / real pilot blockers

- Unit identity is asserted by the JMB operator; there is no independent ownership/tenancy registry integration. Keys can be transferred, and a stolen key can impersonate its unit. This is a pilot access-control mechanism, not legal proof of consent.
- Standardize the unit identifier (e.g. `A-12-08`) at issuance. Alternate spellings of the same physical unit could be counted separately if the JMB issues inconsistent references.
- One vote **per unit**, not necessarily per natural person: confirm the appropriate strata rules, quorum and decision authority with legal counsel, the JMB/MC and applicable by-laws before any legally binding community vote. The proposal's 10% quorum and simple-majority thresholds are software demo assumptions.
- Keep `JMB_SECRET` stable; rotating it changes the HMAC representation used for *future* unit credentials, which may fragment one-unit deduplication until a controlled migration is completed.
- Requires a transactional store and audited identity/authorization for use across multiple server replicas. Protect the app with HTTPS, use non-demo JMB credentials, and log approved identity verification workflows securely.

## Tests

Run `npm test`. Integration coverage includes device spoofing, booking-only keys, same-unit deduplication, cross-condominium isolation, revoked credentials, sample-vote non-interference, legacy-vote migration, and real verified-vote application.
