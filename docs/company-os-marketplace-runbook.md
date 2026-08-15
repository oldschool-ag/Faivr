# FAIVR ↔ Company OS marketplace lifecycle V1

This implementation is wire-compatible with the locked `faivr-marketplace-lifecycle.v1` Company OS contract. FAIVR owns catalog, checkout, entitlement, packages, subscription state, receipt acceptance, and billing acknowledgement. Company OS owns tenant-local activation, archive, uninstall effects, and customer data.

## Authentication

Enroll each appliance Ed25519 public key in `company_os_instance_keys`. Requests use the exact headers `X-FAIVR-Tenant-Id`, `X-FAIVR-Instance-Id`, `X-FAIVR-Key-Id`, `X-FAIVR-Timestamp`, `X-FAIVR-Nonce`, `Idempotency-Key` (mutations), and `X-FAIVR-Signature`.

The signature covers these exact UTF-8 bytes without a trailing newline:

```text
METHOD
EXACT_PATH_QUERY
lowercase_body_sha256_no_prefix
timestamp
nonce
tenantId
instanceId
idempotencyKey_or_empty
```

`keyId` selects the enrolled key but is not part of the canonical bytes. Empty bodies use SHA-256 of zero bytes. Durable embedded signatures use RFC 8785 canonical JSON with the top-level `signature` member omitted.

## V1 endpoints

- `GET /api/company-os/v1/catalog`
- `GET /api/company-os/v1/models/{modelId}`
- `GET /api/company-os/v1/models/{modelId}/versions/latest?companyOsVersion={semver}`
- `POST` and `GET /api/company-os/v1/checkout-sessions`
- `POST` and `GET /api/company-os/v1/installations`
- `GET /api/company-os/v1/installations/{id}/package`
- `POST /api/company-os/v1/activation-receipts`
- `GET /api/company-os/v1/updates`
- `POST /api/company-os/v1/archive-receipts`
- `POST /api/company-os/v1/uninstall-requests`
- `POST /api/company-os/v1/uninstall-receipts`
- `GET /api/company-os/v1/billing`

Identifiers use UUID for tenant, instance, installation, subscription, checkout session, receipt, and event. `modelId` matches `faivr.agent.<slug>`, version is SemVer, and `packageDigest` is `sha256:` plus 64 lowercase hexadecimal characters.

Installation state is persisted separately as `selected`, `payment_pending`, `entitled`, `downloading`, `installing`, `active`, `update_available`, `disabled`, `uninstall_pending`, `removed`, or `failed`. Subscription state is separately `checkout_pending`, `active`, `past_due`, `suspended`, `cancellation_pending_uninstall`, `cancel_at_period_end`, or `cancelled`.

Archive receipts must be `agent.archived`, keep billing `unchanged`, attest every locked archive effect, and retain historical data read-only. Uninstall receipts may report `completed`, `partial`, or `failed`, but FAIVR accepts only `completed` with every required verified effect true. Acceptance schedules period-end cancellation (`cancel_at_period_end`); only the later provider event moves the subscription to `cancelled`. FAIVR signs the billing acknowledgement with Ed25519.

## Operations

Apply `web/sql/company-os-marketplace.sql` only to an approved disposable/test Postgres database. Required secrets remain server-side: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FAIVR_BILLING_SIGNING_PRIVATE_KEY`, `FAIVR_BILLING_SIGNING_KEY_ID`, and `FAIVR_PACKAGE_ORIGIN`. `FAIVR_PACKAGE_ORIGIN` must be the exact HTTPS origin used for immutable package artifacts; imports and downloads reject every other origin and redirects. `FAIVR_MAX_PACKAGE_BYTES` optionally changes the default 50 MiB download ceiling. This change does not authorize deployment, migration, or a live charge.

An isolated staged process-boundary run may set `FAIVR_STAGED_LOCAL_PROVIDERS=1`, `FAIVR_STRIPE_API_ORIGIN=https://127.0.0.1:<port>` (or TLS `localhost`/`::1`), and `FAIVR_STAGED_PROVIDER_CA_PATH` to an ephemeral local CA file to use a local Stripe-compatible provider double. The override is rejected in production, without the explicit staged flag and CA, over plaintext HTTP, or for any non-loopback host. It is not a live Stripe/test-account configuration.

Verify from `web/` with `npm test -- --run tests/company-os-marketplace.test.ts`, `npm run typecheck`, `npm run lint`, `npm run build`, and the built route-module method check described in the completion proof.

### Publishing real Company OS bundles

Company OS exports a signed sidecar manifest plus a content-addressed deterministic `.tar.gz`; it does not freeze or sign FAIVR's eventual hosting URL. The archive requires root `AGENT.md` and `agent-definition.json`, with optional files only below `skills/`, `tools/`, `workflows/`, `docs/`, and `assets/`. The signed manifest exhaustively hashes every regular member and binds the exact compressed digest and byte length. Links, devices, absolute/traversal paths, duplicate normalized paths, variable archive metadata, customer data, credentials, runtime memory, and caches are forbidden.

After an approved operator uploads the exact artifact, ingest it with `DATABASE_URL=... FAIVR_PACKAGE_ORIGIN=https://packages.example FAIVR_ARTIFACT_URL=https://packages.example/<immutable-object> node scripts/import-company-os-bundle.mjs /approved/export/manifest.json /approved/export/artifact.tar.gz`. The importer verifies the enrolled publisher Ed25519 content signature, strict manifest fields, compressed and expanded size bounds, every tar entry, exhaustive per-file hashes, artifact size/digest, managed root, signed positive monthly amount and price activation state, immutable version identity, configured artifact origin, and common embedded-secret patterns before a transaction publishes the package/version. An offline proof can use `FAIVR_VALIDATE_ONLY=1 FAIVR_PUBLISHER_PUBLIC_KEY_PATH=/approved/proof-public.pem` instead of `DATABASE_URL`. The importer never invents agent definitions or payloads. Actual catalog payload publication remains blocked until Company OS supplies its signed portable exports and the target Stripe price IDs; do not substitute FAIVR-authored sample payloads.
