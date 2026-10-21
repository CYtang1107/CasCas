# CasSama security audit — pilot prototype

Scope: JMB PIN authentication, resident booking keys, API permissions, JSON persistence and deployment settings. This is a code-level review and tested pilot hardening, **not** a penetration test or production-security certification.

## Changes in this patch

1. **Resident-key revocation.** The JMB can list metadata (not the raw secrets) and revoke individual condo-scoped credentials. Already-confirmed bookings remain confirmed; a revoked key cannot authorize *new* resident bookings. Old keys stored before the patch are also listable/revocable. Key IDs are the first 16 hexadecimal digits of SHA-256 of the random bearer key; they cannot authorize a reservation.
2. **Private persistence.** `server/store.js` creates the JSON data file with mode `0600` on Unix-like systems and tightens existing store files to `0600`; atomic saves use exclusive, randomized temp filenames. This does **not** encrypt files or make snapshots/backups private; protect data volumes and backups as well.
3. **JMB login throttling.** Failed login attempts are counted per `(condo, client IP)` for 10 minutes rather than enabling one outsider to block every JMB user at a condo. A reverse proxy or WAF should still apply overall rate limiting.
4. **Proxy trust.** Express does not trust client-supplied forwarding headers by default. Set `TRUST_PROXY=1` only when running behind a trusted single reverse proxy, such as a verified platform setup; update this for your actual proxy chain before relying on `req.ip`.
5. **Sensitive response caching.** `/api/jmb/*` responses, including PIN login and authenticated statements, use `Cache-Control: no-store`.

## API additions

All three endpoints below require the JMB bearer token scoped to `:condoId`.

- `POST /api/jmb/:condoId/resident-keys` — previously present; the response now includes `keyId` along with `residentKey` and `expiresAt`. Deliver the secret to a verified resident by a trusted channel; do not publish it in the dashboard after issuance.
- `GET /api/jmb/:condoId/resident-keys` — returns `{keys:[{keyId,issuedAt,expiresAt,revokedAt,active}]}`. No plaintext key, and no full hashed key is returned.
- `DELETE /api/jmb/:condoId/resident-keys/:keyId` — revokes a key for future new bookings. A token from another condo cannot revoke it.

The existing driver app continues to use `residentKey` exactly as before. JMB key listing/revocation are **API-only** until a management UI is added.

## High-priority gaps before a real pilot

- **Resident identity.** Keys are transferable bearer credentials; generating a key doesn't independently verify who owns it. Add a verified resident roster, one account per resident or unit as appropriate, expiry/revocation workflow and auditable approval history.
- **Governance voting (prototype improved).** The vote API no longer trusts self-declared device IDs. JMB-issued, unit-linked resident keys control one vote per standardized condo unit; sample votes are non-binding. See `GOVERNANCE_VERIFICATION.md`. **Still not legally binding**: JMB must actually verify unit entitlement; tokens are transferable; unit labels must be standardized; voting rules need strata/legal review, and credentials and transactions need a production identity system.
- **Demo PINs and access.** Default JMB PINs are public and four digits. For any shared/public deployment, set a private `JMB_PINS` map and strong `JMB_SECRET`, limit access, and replace PIN-only auth with proper JMB accounts/MFA for production. A secret randomly regenerated every restart invalidates all JMB sessions; configure persistence appropriately.
- **OCPP network.** OCPP 1.6 Basic authentication must be carried over TLS (`wss://`) outside localhost; use per-charger credentials and validate charge point identity, safety settings and authorizations with the actual CPO. The current global `OCPP_PASSWORD` and simulation are pilot simplifications.
- **Personal data.** Visitor plates and booking records are stored as plaintext JSON; ensure retention periods, access policies, backups, lawful basis/consent and Malaysia PDPA requirements are assessed before deployment. Mode `0600` alone is not sufficient.
- **Financial labels.** Meter-linked charging receipts are estimates until payment collection is reconciled. Electricity costs, fixed costs and revenue sharing are illustrative assumptions, not verified bank transfers.
- **Multiple instances.** The JSON store is single-process. An external transactional database and locking/atomic capacity enforcement are required before multi-instance deployment to prevent double-booking.

## Quick verification

```bash
npm test
node --test test/server-units.test.js test/server.test.js
```

The tests cover condo-scoped key issuance/list/revocation, invalid-key rejection, PIN throttling, ignoring forged forwarding headers in direct mode, and private file modes.
