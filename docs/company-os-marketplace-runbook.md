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

Decision of 2026-09-29: for the next twelve months FAIVR is the Truchsess store, not a standalone marketplace. It is Old School's catalog of governed AI workers, installable on enrolled Truchsess appliances only. Payments are fiat, monthly, one price per function bundle, through the billing provider of the next section (Polar by default since T6b.1; Stripe stays as the second implementation). Escrow, per-task payment, task-based reputation and x402 are frozen: nothing behind `/api/company-os/**` reaches the chain, the fee module or the router (`web/tests/company-os-frozen-boundaries.test.ts` walks the import graph; the same directories carry an ESLint `no-restricted-imports` rule). There is no public listing, no review, no third-party publisher flow.

### What FAIVR stores

| Table | Content |
| --- | --- |
| `company_os_publishers` | Old School's publisher key: key id derived from the key (`ed25519-` plus 16 hex of SHA-256 over the raw key), PEM, publisher id and name |
| `company_os_packages`, `company_os_package_versions` | one catalog entry per signed Truchsess export: package id, version, package digest, publisher key id, the signed manifest with the permission strings verbatim and the plain-language summary |
| `company_os_package_artifacts` | the signed payload bytes when imported with `FAIVR_STORE_ARTIFACT_INLINE=1`; the download route serves them itself, no object store |
| `company_os_function_bundles`, `company_os_bundle_packages` | function bundles (name, description, Polar product id and/or Stripe price id, monthly amount) and their packages |
| `company_os_enrolment_codes` | the SHA-256 of every enrolment code, its tenant, label, expiry, the owner's email if given and, once used, the appliance it enrolled |
| `company_os_instance_keys` | enrolled appliances: tenant, instance, derived key id, public key, label, enrolled at, last contact |
| `company_os_bundle_subscriptions` | one row per bundle checkout: the provider name and its opaque checkout, subscription and customer ids, state, entitled at, cancel effective at, stopped at |
| `company_os_installations` | the installations of an appliance (package, version, state) riding a bundle subscription; the locked receipts and acknowledgements as before |

What FAIVR never receives from an appliance: run content, chats, files, knowledge, credentials. The lifecycle payloads carry appliance and package identifiers, the activation acknowledgement, the signed uninstall receipt and the "last contact" timestamp of each signed request.

### Publishing an entry (Old School)

1. Build the signed bundle on the build machine from the private agent-sources checkout (`build_local_install_bundle.py` in the product repository; T6a export gate, `approved_for_local_install`). It writes `<package>-<version>.truchsess-bundle.tar` and `<keyId>.pub`.
2. Register the publisher key once: `DATABASE_URL=... node scripts/company-os-store-admin.mjs enrol-publisher --public-key <keyId>.pub --publisher-id old-school --name "Old School AG"`.
3. Create the function bundle with the Polar product the CEO created in the Polar dashboard (sandbox first; see "Billing through Polar" below): `node scripts/company-os-store-admin.mjs create-bundle --id design-review --name "Design review" --description "..." --amount-cents 4900 --currency chf --polar-product <product id>`. Without the active provider's reference the bundle is listed but Subscribe is refused (`polar_product_not_configured`, or `stripe_price_not_configured` with `--stripe-price` under the Stripe provider). Change it later with `set-price`.
4. Import the bundle file and attach it to the bundle: `DATABASE_URL=... FAIVR_PACKAGE_ORIGIN=https://<store host> FAIVR_STORE_ARTIFACT_INLINE=1 FAIVR_STORE_BUNDLE=design-review node scripts/import-company-os-bundle.mjs <package>-<version>.truchsess-bundle.tar`. The importer verifies the publisher signature against the enrolled key, every archive member, the exhaustive content hashes, the managed root and the price state; the permission strings are stored verbatim in the declared order (the appliance owns the closed vocabulary and re-validates them at install).
5. Issue an enrolment code for the appliance: `node scripts/company-os-store-admin.mjs issue-code --label "CEO appliance" --days 14 --owner-email <the owner's email>`. The code is printed once; only its hash is stored. The owner email is optional; when given it pre-fills the billing provider's checkout for that owner. Hand the code to the CEO out of band.
6. `node scripts/company-os-store-admin.mjs list` shows bundles, packages, appliances, subscriptions and codes.

### The appliance's calls

| Route | Signed by the appliance key | Effect |
| --- | --- | --- |
| `POST /api/company-os/v1/enrol` | no (the one-time code and the appliance public key) | registers the appliance under its derived key id; returns tenant, instance, key id, FAIVR's billing signing key and the publisher keys |
| `GET /api/company-os/v1/store/catalog` | yes | bundles, packages, prices, the appliance's own subscriptions and installations |
| `POST /api/company-os/v1/store/checkout-sessions` | yes | creates the bundle subscription (`checkout_pending`) and the checkout at the billing provider; returns the hosted URL the CEO opens in the browser |
| `GET /api/company-os/v1/store/subscriptions?subscriptionId=\|bundleId=[&customerPortal=1]` | yes | the state the provider's webhook mirrored (`checkout_pending`, `active`, `past_due`, `cancel_at_period_end`, `cancelled`); with `customerPortal=1` also a fresh, short-lived `customerPortalUrl` to the provider's customer portal (T6b.1; absent before a purchase) |
| `POST /api/company-os/v1/store/installations` | yes | an `entitled` installation of one package of a subscribed bundle |
| `GET /api/company-os/v1/installations/{id}/package` | yes | the signed payload with digest, publisher key id, publisher signature and manifest headers |
| `POST /api/company-os/v1/activation-receipts`, `uninstall-requests`, `uninstall-receipts`, `GET /billing` | yes | unchanged from V1; an accepted uninstall receipt for the last package of a bundle schedules the cancellation at the provider at period end |
| `POST /api/company-os/v1/store/subscriptions/cancel` | yes | cancels a subscribed bundle nothing is installed from |

The provider's webhook events are mapped to the same seven states by `web/lib/companyOs/billing/events.ts`; the Polar and Stripe mappings are listed in the next section. A past-due bundle refuses new installations.

Environment in addition to the V1 variables: `FAIVR_BILLING_SIGNING_PUBLIC_KEY` (the PEM the appliance receives at enrolment to verify billing acknowledgements) and the billing provider's variables of the next section. The pages the provider returns the owner to are `/store/checkout/success` ("Payment received, go back to your appliance", nothing else) and `/store/checkout/cancel`.

Verify from `web/`: `npm test` (the store lifecycle against pg-mem with signed requests and both providers' fixtures, the importer on a generated bundle file, the frozen-boundary walk), `npm run typecheck`, `npm run lint`, `npm run build`.

## Billing through Polar (T6b.1)

Decision of 2026-09-30: billing goes through Polar (polar.sh), merchant of record. Polar collects VAT and sales tax and issues the invoices; FAIVR only mirrors subscription state. The T6b Stripe code was not thrown away: it sits behind the billing-provider interface (`web/lib/companyOs/billing/`) as the second implementation with its tests. Polar is the default. Nothing in this slice needs a Stripe account.

### The interface

`web/lib/companyOs/billing/provider.ts` names exactly the five operations the store needs: create one checkout for one function bundle and one appliance (returns the URL the browser opens and the provider's checkout id), read one subscription, cancel at the period end, verify and parse a webhook into one small provider-neutral event (subscription id, appliance id and bundle id from the metadata, the new state, the period end), and build the owner's customer-portal link. `polar.ts` and `stripe.ts` implement it; `index.ts` selects by `FAIVR_BILLING_PROVIDER` (`polar` or `stripe`, default `polar`). The subscription state machine (`privateStore.ts`) is the single source of truth; the provider's objects are stored as opaque ids next to it (`billing_provider`, `provider_checkout_id`, `provider_subscription_id`, `provider_customer_id`). At server start (`web/instrumentation.ts`) the store logs one line naming the provider and its environment; with a provider whose credentials are missing the line says which variables, and every store route answers 503 `billing_provider_not_configured:<provider>:<variables>` until they are set.

Polar's API is date-versioned. This integration is pinned to `2026-10` (`Polar-Version: 2026-10` on every request; the version that becomes Current on 1 October 2026 and is supported into 2027). The webhook endpoint must be created with the same `api_version`. Upgrading the version is a code change (`POLAR_API_VERSION` in `billing/config.ts`) plus the endpoint's `api_version` in the Polar dashboard.

### Set Polar up once (Old School)

Sandbox first. Everything below is in the Polar dashboard of the **sandbox** organization at `https://sandbox.polar.sh` (production later has its own organization, tokens and secrets at `https://polar.sh`).

| Step | Where in the Polar dashboard | What goes where |
| --- | --- | --- |
| 1. Organization | `sandbox.polar.sh/start`: create a user and an organization (or **Go to sandbox** from the organization switcher of the production dashboard) | the organization id, shown in the organization's **Settings** (copy it into `POLAR_ORGANIZATION_ID`) |
| 2. Access token | **Settings**, scroll to **Developers**, **New Token**: name it `faivr-store`, set an expiry, select the scopes `checkouts:write`, `subscriptions:read`, `subscriptions:write`, `customer_sessions:write`, `customers:read`, `products:read` | the token (`polar_oat_...`) shown once, into `POLAR_ACCESS_TOKEN` |
| 3. Webhook endpoint | **Settings**, **Webhooks**, **Add Endpoint**: URL `https://<store host>/api/company-os/v1/billing/polar/webhook`, format **Raw**, API version `2026-10`, events `subscription.created`, `subscription.active`, `subscription.updated`, `subscription.canceled`, `subscription.uncanceled`, `subscription.revoked`, `subscription.past_due`, `subscription.cycled`, `order.paid` | the endpoint's secret (`whsec_...`, generated by Polar) into `POLAR_WEBHOOK_SECRET` |
| 4. One product per function bundle | **Products**, **New Product**: name = the bundle name, billing **Subscription**, interval **Monthly**, one fixed price in the bundle's currency | the product id (product menu, **Copy Product ID**) into the catalog entry: `node scripts/company-os-store-admin.mjs create-bundle ... --polar-product <product id>` (or `set-price --id <bundle> --polar-product <product id>`) |
| 5. Environment | Vercel project, **Settings**, **Environment Variables** (Preview for the sandbox) | `FAIVR_BILLING_PROVIDER=polar`, `POLAR_ENVIRONMENT=sandbox`, `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_ORGANIZATION_ID` |

Redeploy after step 5 and read the start line `[faivr-store] billing provider polar (sandbox, API 2026-10, https://sandbox-api.polar.sh)` in the function logs.

### Test one purchase end to end (sandbox)

1. On the appliance: Administration, Packages, Store, **Subscribe** on the bundle. The store creates the Polar checkout (`POST /v1/checkouts/` with `products: [<product id>]`, `external_customer_id` = the owner's tenant id, `customer_email` if the enrolment code carried one, `metadata` with `faivr_subscription_id`, `faivr_tenant_id`, `faivr_instance_id`, `faivr_bundle_id`, `success_url` = `/store/checkout/success`, `return_url` = `/store/checkout/cancel`) and the appliance shows **Open the payment page**.
2. In the browser, on Polar's page: card `4242 4242 4242 4242`, any future expiry, any CVC, any name and email (the sandbox charges nothing). Polar returns the browser to "Payment received, go back to your appliance".
3. Polar delivers `subscription.created` (a refresh, nothing changes), `subscription.active` (the store activates the bundle subscription: its row is found by the checkout id the store recorded, and the metadata must agree) and `order.paid`. The appliance's poll shows **active** within a few seconds; **Install** becomes available. **Settings**, **Webhooks**, the endpoint's **Deliveries** page shows each delivery and its 202.
4. Install the package; run one task.
5. Cancellation, two ways: **Uninstall** the last package of the bundle on the appliance (the store patches the Polar subscription with `cancel_at_period_end: true`; Polar sends `subscription.canceled`, the appliance shows "cancels <period end>") or cancel in Polar's customer portal (**Manage subscription** on the appliance opens it; the same event follows). At the period end Polar sends `subscription.revoked`: the appliance's poll shows **subscription ended** and the T6b uninstall-with-receipt path applies exactly as with Stripe. To see the end without waiting a month, revoke the subscription in the dashboard (**Sales**, **Subscriptions**, the subscription, **Revoke**): Polar sends `subscription.canceled` and `subscription.revoked` at once and the store ends the subscription immediately.
6. Redelivery: **Deliveries**, **Redeliver** on any event answers 202 `replayed` and changes nothing (the `webhook-id` is recorded).

### Events and states

| Polar event | Store state |
| --- | --- |
| `subscription.active`, `order.paid` (of a subscription) | `active` (from `checkout_pending` by the checkout id, or back from `past_due`) |
| `subscription.canceled` | `cancel_at_period_end` with the date from `ends_at`; an immediate revocation (status `canceled`, `ended_at` set) ends it at once |
| `subscription.revoked` | `cancelled` (billing stopped; the appliance sees "subscription ended") |
| `subscription.uncanceled` | back to `active`, the cancellation date cleared |
| `subscription.past_due` | `past_due` (new installations refused; Polar retries the charge for up to 21 days) |
| `subscription.updated`, `subscription.created`, `subscription.cycled` | a refresh of the known fields (period end, past due and back), never a state source of its own; never activates a pending checkout, never ends a subscription |
| anything else | verified, recorded, ignored |

Stripe's mapping (unchanged from T6b, `web/app/api/company-os/stripe/webhook/route.ts`): `checkout.session.completed` activates; `customer.subscription.deleted` or `updated` with `canceled` stops billing; `invoice.payment_failed` and `updated` with `past_due`/`unpaid` mark past due, `active` brings it back.

### What goes to Polar, what stays

To Polar: the owner's account id (the store tenant id, as Polar's `external_customer_id`: one Polar customer per owner, any number of appliances) and, if given at `issue-code`, the owner's email; the bundle id, the appliance (instance) id, the tenant id and the store's subscription id in the checkout metadata; the payment itself, entered by the owner on Polar's page. Never package contents, never run data, never anything from the appliance. Card data lives at Polar (and its processor) only.

At FAIVR: the state machine and Polar's opaque ids (checkout, subscription, customer), the verified webhook payloads with their `webhook-id` for idempotency.

### Cancellation and refunds

Old School's own cancellation and refund actions stay in the Polar dashboard (**Sales**, **Subscriptions** and **Orders**; refunds under **Refunds**): the FAIVR side only mirrors state and never issues a refund or revokes a subscription itself. The appliance owner cancels at the period end from the appliance (uninstall of the last package, or **Cancel subscription** on a bundle nothing is installed from) or from Polar's customer portal (**Manage subscription**); both reach the store as `subscription.canceled`.

### Production

A separate Polar organization at `https://polar.sh` (Polar reviews the account before the first payout: **Finance**, **Account** in the dashboard, up to 14 days; test purchases with real cards are not allowed there), its own organization access token and webhook endpoint (same URL path, `api_version` `2026-10`, its own secret), one product with a monthly price per function bundle (product ids differ from the sandbox: `set-price --polar-product` on each bundle), and in Vercel (Production): `POLAR_ENVIRONMENT=production`, the production `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_ORGANIZATION_ID`. Prices are the CEO's decision and are set on the Polar product, not in the store; the store's `--amount-cents` is the amount it shows the appliance and must match.

### Enrolment and Polar license keys

Enrolment stays as T6b built it: a FAIVR-issued one-time code, before any purchase. Polar's license keys are not used: tying the appliance's identity to the billing provider would defeat the interface. They could later replace the code if the CEO wants a purchase to carry the enrolment.

### Verify

From `web/`: `npm test` runs the billing-provider contract suite against both providers with recorded answers (`web/tests/company-os-billing-providers.test.ts`, fixtures under `web/tests/fixtures/polar/` and `web/tests/fixtures/stripe/api/`), the Polar store flow with webhooks signed in both of Polar's forms (the Standard Webhooks key of secrets generated on or after 8 September 2026 and the earlier Polar HMAC key; `web/tests/company-os-polar-store.test.ts`), idempotency on redelivered events, the T6b Stripe flow behind the interface, and the frozen-boundary walk extended to the billing paths. Then `npm run typecheck`, `npm run lint`, `npm run build`.
