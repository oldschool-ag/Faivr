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

## The private Truchsess store (T6b)

Decision of 2026-09-29: for the next twelve months FAIVR is the Truchsess store, not a standalone marketplace. It is Old School's catalog of governed AI workers, installable on enrolled Truchsess appliances only. Payments are fiat through Stripe, monthly, one price per function bundle. Escrow, per-task payment, task-based reputation and x402 are frozen: nothing behind `/api/company-os/**` reaches the chain, the fee module or the router (`web/tests/company-os-frozen-boundaries.test.ts` walks the import graph; the same directories carry an ESLint `no-restricted-imports` rule). There is no public listing, no review, no third-party publisher flow.

### What FAIVR stores

| Table | Content |
| --- | --- |
| `company_os_publishers` | Old School's publisher key: key id derived from the key (`ed25519-` plus 16 hex of SHA-256 over the raw key), PEM, publisher id and name |
| `company_os_packages`, `company_os_package_versions` | one catalog entry per signed Truchsess export: package id, version, package digest, publisher key id, the signed manifest with the permission strings verbatim and the plain-language summary |
| `company_os_package_artifacts` | the signed payload bytes when imported with `FAIVR_STORE_ARTIFACT_INLINE=1`; the download route serves them itself, no object store |
| `company_os_function_bundles`, `company_os_bundle_packages` | function bundles (name, description, Stripe price id, monthly amount) and their packages |
| `company_os_enrolment_codes` | the SHA-256 of every enrolment code, its tenant, label, expiry and, once used, the appliance it enrolled |
| `company_os_instance_keys` | enrolled appliances: tenant, instance, derived key id, public key, label, enrolled at, last contact |
| `company_os_bundle_subscriptions` | one row per bundle checkout: Stripe checkout session and subscription ids, state, entitled at, cancel effective at, stopped at |
| `company_os_installations` | the installations of an appliance (package, version, state) riding a bundle subscription; the locked receipts and acknowledgements as before |

What FAIVR never receives from an appliance: run content, chats, files, knowledge, credentials. The lifecycle payloads carry appliance and package identifiers, the activation acknowledgement, the signed uninstall receipt and the "last contact" timestamp of each signed request.

### Publishing an entry (Old School)

1. Build the signed bundle on the build machine from the private agent-sources checkout (`build_local_install_bundle.py` in the product repository; T6a export gate, `approved_for_local_install`). It writes `<package>-<version>.truchsess-bundle.tar` and `<keyId>.pub`.
2. Register the publisher key once: `DATABASE_URL=... node scripts/company-os-store-admin.mjs enrol-publisher --public-key <keyId>.pub --publisher-id old-school --name "Old School AG"`.
3. Create the function bundle with the Stripe price the CEO created in the Stripe dashboard (test mode first): `node scripts/company-os-store-admin.mjs create-bundle --id design-review --name "Design review" --description "..." --amount-cents 4900 --currency chf --stripe-price price_...`. Without `--stripe-price` the bundle is listed but Subscribe is refused (`stripe_price_not_configured`). Change the price later with `set-price`.
4. Import the bundle file and attach it to the bundle: `DATABASE_URL=... FAIVR_PACKAGE_ORIGIN=https://<store host> FAIVR_STORE_ARTIFACT_INLINE=1 FAIVR_STORE_BUNDLE=design-review node scripts/import-company-os-bundle.mjs <package>-<version>.truchsess-bundle.tar`. The importer verifies the publisher signature against the enrolled key, every archive member, the exhaustive content hashes, the managed root and the price state; the permission strings are stored verbatim in the declared order (the appliance owns the closed vocabulary and re-validates them at install).
5. Issue an enrolment code for the appliance: `node scripts/company-os-store-admin.mjs issue-code --label "CEO appliance" --days 14`. The code is printed once; only its hash is stored. Hand it to the CEO out of band.
6. `node scripts/company-os-store-admin.mjs list` shows bundles, packages, appliances, subscriptions and codes.

### The appliance's calls

| Route | Signed by the appliance key | Effect |
| --- | --- | --- |
| `POST /api/company-os/v1/enrol` | no (the one-time code and the appliance public key) | registers the appliance under its derived key id; returns tenant, instance, key id, FAIVR's billing signing key and the publisher keys |
| `GET /api/company-os/v1/store/catalog` | yes | bundles, packages, prices, the appliance's own subscriptions and installations |
| `POST /api/company-os/v1/store/checkout-sessions` | yes | creates the bundle subscription (`checkout_pending`) and the Stripe checkout; returns the hosted URL the CEO opens in the browser |
| `GET /api/company-os/v1/store/subscriptions?subscriptionId=\|bundleId=` | yes | the state the Stripe webhook mirrored (`checkout_pending`, `active`, `past_due`, `cancel_at_period_end`, `cancelled`) |
| `POST /api/company-os/v1/store/installations` | yes | an `entitled` installation of one package of a subscribed bundle |
| `GET /api/company-os/v1/installations/{id}/package` | yes | the signed payload with digest, publisher key id, publisher signature and manifest headers |
| `POST /api/company-os/v1/activation-receipts`, `uninstall-requests`, `uninstall-receipts`, `GET /billing` | yes | unchanged from V1; an accepted uninstall receipt for the last package of a bundle schedules the Stripe cancellation at period end |
| `POST /api/company-os/v1/store/subscriptions/cancel` | yes | cancels a subscribed bundle nothing is installed from |

Stripe webhook events handled (`web/app/api/company-os/stripe/webhook/route.ts`, fixtures under `web/tests/fixtures/stripe/`): `checkout.session.completed` activates the bundle subscription named in the metadata; `customer.subscription.deleted` (or `updated` with status `canceled`) stops billing; `invoice.payment_failed` and `customer.subscription.updated` with `past_due`/`unpaid` mark the bundle past due, `active` brings it back. A past-due bundle refuses new installations.

Environment in addition to the V1 variables: `FAIVR_BILLING_SIGNING_PUBLIC_KEY` (the PEM the appliance receives at enrolment to verify billing acknowledgements). The Stripe success and cancel pages are `/store/checkout/success` and `/store/checkout/cancel`.

Verify from `web/`: `npm test` (the store lifecycle against pg-mem with signed requests and Stripe's fixtures, the importer on a generated bundle file, the frozen-boundary walk), `npm run typecheck`, `npm run lint`, `npm run build`.
