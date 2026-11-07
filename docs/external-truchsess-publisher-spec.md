# External Truchsess publisher specification (proposal)

- Status: **documentation-only proposal; not implemented**
- Audience: external agent publishers, Truchsess/FAIVR operators, security reviewers
- Last updated: 2026-10-15

## 1. Purpose and status language

This document specifies a proposed path for external companies to publish signed
Truchsess agent packages through the FAIVR Store. It deliberately does not define a
general agent runtime or change the appliance, Store, billing, or deployment behavior.

The terms below are normative throughout this document:

- **CURRENT** describes behavior supported by the repository at this document's base
  commit.
- **PROPOSED** describes a future contract that requires separate implementation,
  security review, migrations, tests, release approval, and deployment.
- **MUST**, **SHOULD**, and **MAY** are requirements only inside the section's CURRENT or
  PROPOSED status. No PROPOSED requirement is available merely because this document
  exists.

### Current boundary

**CURRENT:** FAIVR is a private Truchsess Store with Old School as the only publisher.
There is no public listing, publisher self-service, review system, or third-party
publisher flow. Enrolled boxes receive the active publisher keys and the signed private
catalog. The Store receives appliance/package lifecycle metadata, but not runs, chats,
files, knowledge, or credentials. See the [marketplace lifecycle runbook](company-os-marketplace-runbook.md#the-private-truchsess-store-t6b).

**PROPOSED:** Extend this private, appliance-only model to reviewed external publishers.
The proposal does not make packages public on the web and does not expose tenant data to
publishers.

## 2. Existing contracts that this proposal preserves

| Area | CURRENT behavior and source |
| --- | --- |
| Portable package | A deterministic `package.tar.gz` contains root `AGENT.md` and `agent-definition.json`; optional files are limited to `skills/`, `tools/`, `workflows/`, `docs/`, and `assets/`. See [import validation](../scripts/import-company-os-bundle.mjs#L103-L125). |
| Bundle envelope | A `.truchsess-bundle.tar` contains exactly `bundle-index.json`, `manifest.json`, and `package.tar.gz`, with digest and identity agreement. See [bundle-file parsing](../scripts/import-company-os-bundle.mjs#L129-L148). |
| Manifest | The strict `faivr-portable-agent-bundle.v1` schema, exact fields, compatibility range, permissions, slots, managed root, `tenantDataIncluded: false`, price state, optional `functionLead`, and exhaustive content hashes are validated at import. See [manifest validation](../scripts/import-company-os-bundle.mjs#L150-L176). |
| Publisher signature | The top-level `signature` is omitted, the remainder is canonicalized, and an Ed25519 signature is verified against an active enrolled publisher key. See [signature verification](../scripts/import-company-os-bundle.mjs#L191-L202) and [key derivation](../web/lib/companyOs/publisherKeys.ts). |
| Immutable version | A `(modelId, version)` conflict is accepted only when signed material and artifact digest agree; otherwise import fails. See [transactional import](../scripts/import-company-os-bundle.mjs#L203-L232). |
| Function bundle lead | A signed version may declare `functionLead: true`; a function bundle may have at most one package whose latest version is the lead. See [lead enforcement](../scripts/import-company-os-bundle.mjs#L212-L223) and the [catalog projection](../web/lib/companyOs/privateStore.ts#L186-L360). |
| Box enrolment | A one-time code is stored only as a SHA-256 hash, binds a tenant UUID, and is redeemed with a box Ed25519 public key. See [enrolment implementation](../web/lib/companyOs/privateStore.ts#L41-L115) and [request schema](../web/lib/companyOs/storeSchemas.ts#L15-L22). |
| Box authentication | Signed requests bind method, exact path/query, body hash, timestamp, nonce, tenant, instance, and idempotency key; clock skew is limited to five minutes. See [request authentication](../web/lib/companyOs/auth.ts#L3-L53). |
| Catalog and trust roots | Enrolment and catalog responses return active publisher public keys; package rows expose publisher identity, digest, permissions, compatibility, and, when entitled, signed artifact metadata. See [Store handlers](../web/app/api/company-os/v1/storeHandlers.ts#L63-L117) and [catalog projection](../web/lib/companyOs/privateStore.ts#L186-L360). |
| Install verification | Activation acknowledges `compatibilityVerified`, `publisherSignatureVerified`, and `packageChecksPassed`; updates require all three to be true. See [lifecycle schemas](../web/lib/companyOs/schemas.ts#L20-L30). |
| Lifecycle | Installation and subscription states, signed archive/uninstall receipts, and billing acknowledgement remain separate. See [lifecycle runbook](company-os-marketplace-runbook.md#v1-endpoints). |
| Box release channel | Truchsess OS updates are a separate, signed, enrolled-box channel. FAIVR returns verified GitHub asset metadata and does not proxy large assets. See [Truchsess release administration](truchsess-release-admin.md). |

## 3. Goals and non-goals

### PROPOSED goals

1. Let a verified publisher submit portable Truchsess packages without receiving Store
   database or operator access.
2. Preserve end-to-end package provenance from publisher signature through box-side
   verification.
3. Bind publishers, customer companies, tenants, boxes, entitlements, and installations
   without disclosing a company's source identifier in manifests or catalog responses.
4. Provide reviewable trust, rejection, withdrawal, key rotation, and emergency
   revocation states.
5. Keep knowledge and customer data on the Truchsess box and make requested capabilities
   visible before installation.
6. Keep existing Old School packages and enrolled boxes compatible during migration.

### Explicit non-goals

- No runtime SDK, agent execution protocol, model gateway, hosted agent runtime, or remote
  tool execution.
- No package code changes, Store route changes, schema migrations, deployment, or billing
  changes in this documentation PR.
- No public-web marketplace, on-chain identity, escrow, task reputation, x402, or token
  settlement for Truchsess packages.
- No transfer of box knowledge, chats, files, prompts, credentials, or run telemetry to
  FAIVR or a publisher.
- No promise that signature verification proves quality, safety, legal compliance, or
  fitness for a customer.
- No automatic approval, publication, or activation after upload.

## 4. Publisher, company, tenant, and box identity

### 4.1 Publisher identity

**CURRENT:** `company_os_publishers` identifies an active signing key by a derived
`ed25519-<16 hex>` key ID and stores `publisher_id` and display name. The current admin
command can enroll or refresh a key, and the importer accepts only a key whose row is
`active`. See [publisher administration](../scripts/company-os-store-admin.mjs#L45-L80)
and the [Store schema](../web/sql/company-os-marketplace.sql#L2-L6).

**PROPOSED:** A publisher is a verified organization record, separate from its keys:

- `publisherId`: immutable, non-secret Store identifier such as `publisher.acme`;
- legal name, display name, jurisdiction, and verification evidence held in the operator
  control plane, not the package;
- status: `pending`, `verified`, `suspended`, or `revoked`;
- one or more signing keys with status `active`, `retiring`, or `revoked`, validity
  interval, creation/rotation evidence, and revocation reason;
- named publisher operators with least-privilege access and auditable actions.

The signed manifest's `publisher.publisherId` and `publisher.name` MUST match the verified
publisher owning `signature.keyId`. A key MUST NOT be reassigned between publishers.

### 4.2 Privacy-preserving company identifiers

**CURRENT:** An enrolment code binds a random tenant UUID and may store an owner email.
There is no separate company identity column or publisher-facing company identifier.

**PROPOSED:** FAIVR creates opaque, versioned company references from an operator-verified
source identifier:

```text
companyRef(scope) = "fco1_" + base64url(
  HMAC-SHA-256(K_company_v1,
    "faivr-company-ref.v1" || NUL || scope || NUL || issuer || NUL || canonicalSubject)
)[0:27]
```

- `issuer` identifies the authoritative namespace (for example, a registry or the
  verified billing/customer identity), and `canonicalSubject` is normalized only inside
  that namespace.
- `K_company_v1` is a Store-held secret in a managed secret system. It MUST NOT be in the
  database, application logs, publisher tooling, package, catalog, or box.
- The 27 base64url characters encode at least 160 bits. Full HMAC output SHOULD be kept
  internally if collision handling is required.
- The source identifier MUST be encrypted or kept in the verification provider, with
  restricted access and documented retention. It MUST NOT be recoverable from
  `companyRef` by publishers or boxes.
- Use scope `faivr-internal` for Store joins. If a publisher has a legitimate need for a
  stable customer reference, derive `scope = publisher:<publisherId>` so publishers
  cannot correlate the same company with one another. Do not reveal the internal value.
- Rotation creates `fco2_...` plus an internal alias mapping; it MUST NOT silently change
  tenant ownership or entitlement.

This is pseudonymization, not anonymization. Access controls, minimization, retention,
and deletion handling remain required.

### 4.3 Tenant/company and box binding

**PROPOSED:** Every tenant MUST bind to exactly one internal company reference. A company
MAY have multiple tenants only through an explicit operator-reviewed relationship. Each
enrolment code MUST bind `companyRef`, `tenantId`, expiry, allowed box count, and intended
release channel before it is issued. Redemption MUST atomically consume the code and bind
the derived box key ID and new `instanceId` to that tenant.

Package manifests remain tenant-neutral and reusable. Company restrictions, private
offers, subscriptions, and entitlements belong in Store-side policy records keyed by the
internal company reference. A publisher MUST NOT supply a tenant UUID, company reference,
entitlement, or installation identity in a package submission.

## 5. Package and manifest contract

### 5.1 CURRENT accepted package

Publishers MUST treat the importer as authoritative. In summary:

- outer bundle: exactly `bundle-index.json`, `manifest.json`, `package.tar.gz`;
- payload: regular files/directories only; no links, devices, path traversal, duplicate
  normalized paths, foreign roots, customer data, credentials, runtime memory, or caches;
- required payload files: `AGENT.md` and `agent-definition.json`;
- manifest: exact `faivr-portable-agent-bundle.v1` fields; `slots`, `releaseNotes`, and
  `functionLead` are optional; unknown fields are rejected;
- identity: `modelId` is `faivr.agent.<slug>`, version is SemVer, entrypoint is
  `agent-definition.json`, and managed root is `agents/<modelId>/<version>`;
- integrity: compressed digest/size and every regular file's digest/size are signed;
- data boundary: `tenantDataIncluded` is exactly `false`;
- compatibility: minimum and optional maximum Company OS versions are declared;
- permissions and dependencies are unique strings. Store-side mail permissions currently
  allow only `mail.read` and `mail.draft`; the box owns and revalidates its full closed
  vocabulary;
- installation questions (`slots`) may currently be `repository`, `product`, or `website`
  and may be referenced by permission placeholders;
- `functionLead`, when present, is a boolean; at most one package whose latest signed
  version sets it to `true` may belong to a function bundle;
- package size defaults to 50 MiB compressed, with expanded output capped at four times
  the configured compressed limit;
- release notes are at most 1,000 Unicode characters.

### 5.2 PROPOSED external-publisher profile

The first external-publisher release SHOULD keep `faivr-portable-agent-bundle.v1`
byte-for-byte compatible. Publisher/company verification, submission metadata, review
findings, catalog eligibility, and company targeting MUST be Store-side records rather
than new v1 manifest fields.

An external package additionally MUST:

1. use a `modelId` namespace allocated to that publisher and prove ownership at
   submission;
2. use a never-reused SemVer for changed bytes or metadata;
3. declare the least permissions and installation slots needed for useful operation;
4. explain each dependency and permission in `AGENT.md`;
5. include no customer-specific examples containing real data;
6. document failure, degraded-mode, and human-review behavior;
7. pass automated validation and operator/security review before publication.

If future needs cannot be represented without changing the signed manifest, introduce a
new schema version with a separate validator and compatibility negotiation. Do not add
optional fields to v1: the current importer rejects unknown keys.

## 6. Signing and verification

### CURRENT

1. Derive `keyId` from the raw 32-byte Ed25519 public key as
   `ed25519-` plus the first 16 lowercase hex characters of SHA-256.
2. Build the deterministic payload and exhaustive manifest.
3. Set `signature` to `{ keyId, algorithm: "Ed25519", value }`.
4. Sign the RFC 8785 canonical JSON bytes of the manifest with the top-level `signature`
   member omitted; encode the signature as unpadded base64url.
5. The importer verifies the active enrolled key, signature, artifact digest/size, archive
   safety, every content digest, exact schema, price state, compatibility fields, and
   secret-pattern gate before committing.
6. The box receives publisher keys at enrolment/catalog, re-verifies signature, digest,
   compatibility, permissions, and package checks, then acknowledges the result.

### PROPOSED additions

- Publisher private keys MUST remain publisher-controlled and SHOULD use an HSM, KMS, or
  hardware-backed signer. FAIVR MUST accept signatures and public keys, never private
  keys or recovery phrases.
- New keys require proof of publisher-admin control and an out-of-band verification step.
- Rotation SHOULD overlap old and new active keys. Existing package signatures remain
  valid unless the old key or package is revoked; packages MUST NOT be silently re-signed.
- Submission authentication and package signing are separate credentials. Compromise of
  a portal token MUST NOT authorize package signatures.
- All verification results, reviewer decisions, key changes, and publication actions MUST
  be append-only audited with actor, timestamp, object digest, and reason code.

## 7. Submission, review, import, and catalog workflow

### CURRENT operator workflow

The operator enrolls a publisher key, creates a priced function bundle, imports a signed
Truchsess bundle transactionally, attaches it to the bundle, and issues box enrolment
codes. The exact commands are documented in [Publishing an entry](company-os-marketplace-runbook.md#publishing-an-entry-old-school).

### PROPOSED external workflow

1. **Publisher onboarding:** verify the publisher company, contractual authority, named
   operators, support/security contacts, model-ID namespace, and signing-key proof.
2. **Local preparation:** build, validate, inspect, and sign the portable bundle. Generate
   a machine-readable validation report without uploading source directories or keys.
3. **Submission:** upload the immutable bundle plus submission metadata over an
   authenticated publisher endpoint. The service computes its own digest; client-provided
   digests are assertions, not trust anchors.
4. **Automated intake:** parse in isolation with bounded resources; apply the current
   importer checks; scan for secrets, unsafe archives, policy violations, and malware;
   verify publisher/key/model namespace and reject mutable version reuse.
5. **Review:** record release notes, capability rationale, compatibility evidence, support
   contact, data-handling declaration, and reviewer decision. Reviewers cannot alter and
   publish different bytes under the submitted signature.
6. **Staging:** create a non-catalog staging record and make it available only to explicit
   test tenants/boxes. Staging is not production publication.
7. **Publication:** a separate authorized operator approves the exact digest, package
   version, catalog bundle, price, audience policy, and release channel. Publication is an
   audited state transition; it never follows upload automatically.
8. **Box install:** an enrolled box fetches its signed catalog, verifies package and trust
   state, displays publisher/permissions/compatibility/release notes, obtains owner
   confirmation, and installs through the existing lifecycle.
9. **Update/withdrawal:** every changed package is a new signed version. Withdrawal or
   revocation follows Section 8 and never replaces historical bytes in place.

The proposed submission endpoint SHOULD be asynchronous and content-addressed. Repeated
submission of identical publisher, model, version, digest, and signature MAY return the
existing submission. A conflicting tuple MUST return an immutable-version conflict.

## 8. Trust, revocation, and error states

### 8.1 CURRENT limitations

- Import accepts only publisher keys with `status='active'`.
- Enrolment/catalog return active publisher keys.
- Package versions support `draft`, `published`, and `withdrawn` in SQL, but the current
  importer publishes immediately after successful validation.
- Current admin tooling has no complete external-publisher review, suspension, key
  rotation, revocation propagation, quarantine, or appeals workflow.
- Making a publisher key inactive alone is not specified as removing already-published
  versions from catalog or disabling existing installations.

### 8.2 PROPOSED state model

| Object | States | Required effect |
| --- | --- | --- |
| Publisher | `pending`, `verified`, `suspended`, `revoked` | Only `verified` may submit/publish. Suspension blocks new submissions/publications; revocation also revokes or quarantines affected keys/packages by explicit policy. |
| Signing key | `pending`, `active`, `retiring`, `revoked` | Only `active` signs new submissions. `retiring` verifies existing versions during overlap. `revoked` blocks new download/install/update and carries effective time/reason. |
| Submission | `uploaded`, `validating`, `review_required`, `approved`, `rejected`, `cancelled` | No catalog visibility until an approved submission is separately published. |
| Package version | `staged`, `published`, `withdrawn`, `quarantined`, `revoked` | `withdrawn` blocks new acquisition; `quarantined` blocks download/install/update pending investigation; `revoked` is terminal and must include reason/severity. |
| Company binding | `active`, `suspended`, `ended` | Controls tenant entitlement, not package signature validity. |

Boxes SHOULD receive a Store-signed trust document with monotonic revision, generated and
expiry times, publisher/key/package states, reason codes safe to display, and the service
key ID. A box MUST reject stale, expired, invalidly signed, or rollback trust documents.
Critical revocation policy SHOULD block new runs and disable the affected runtime binding
while preserving tenant data read-only; non-critical withdrawal SHOULD block new installs
but not silently stop an existing agent. Exact fail-closed behavior requires a separate
Truchsess runtime design and release.

### 8.3 Error contract

**PROPOSED:** Publisher APIs return a stable machine code, human-safe message, correlation
ID, and optional field issues; they MUST NOT reveal another publisher, company, tenant, or
key. Recommended codes:

- `publisher_not_verified`, `publisher_suspended`, `publisher_revoked`;
- `publisher_key_unknown`, `publisher_key_inactive`, `publisher_key_revoked`;
- `publisher_manifest_mismatch`, `model_namespace_forbidden`;
- `invalid_bundle_layout`, `invalid_manifest`, `invalid_signature`,
  `artifact_digest_mismatch`, `content_digest_mismatch`, `secret_detected`;
- `version_conflict`, `compatibility_unsupported`, `permission_unsupported`;
- `review_required`, `submission_rejected`, `package_withdrawn`,
  `package_quarantined`, `package_revoked`;
- `company_binding_required`, `company_binding_suspended`, `tenant_scope_mismatch`;
- `rate_limited`, `payload_too_large`, `service_unavailable`.

Authentication/authorization failures SHOULD avoid confirming whether a target object
exists. Validation failures MAY identify the publisher's own field/path but MUST redact
suspected secret values.

## 9. Proposed publisher SDK

No SDK exists under this specification. A future SDK is convenience tooling over the
normative package and submission contracts; the Store/importer remains authoritative.

### Proposed scope and API

An initial TypeScript package and matching CLI MAY provide:

```ts
type Signer = {
  keyId: string;
  signCanonical(bytes: Uint8Array): Promise<Uint8Array>;
};

validateSource(options): Promise<ValidationReport>;
buildPackage(options): Promise<{ bundlePath: string; digest: string }>;
signManifest(unsignedManifest, signer: Signer): Promise<SignedManifest>;
verifyBundle(bundlePath, trustedPublicKeys?): Promise<VerificationReport>;
inspectBundle(bundlePath): Promise<RedactedPackageSummary>;
createSubmission(bundlePath, metadata): Promise<SubmissionRequest>;
submitPackage(client, request): Promise<{ submissionId: string; state: string }>;
getSubmission(client, submissionId): Promise<SubmissionStatus>;
```

CLI equivalents SHOULD be `truchsess-publisher validate`, `build`, `sign`, `verify`,
`inspect`, `submit`, and `status`. Build output MUST be deterministic. `Signer` SHOULD be
callback-based so KMS/HSM integrations need not expose private key bytes. Reports MUST
redact content that resembles secrets.

### SDK non-goals

- It does not execute, test-run, install, activate, schedule, or update agents.
- It does not access box knowledge, tools, credentials, tenant data, or runtime logs.
- It does not approve, price, publish, revoke, or grant entitlements.
- It does not generate a production signing key by default, store private keys in project
  files, or upload a source tree.
- It does not weaken or duplicate the Store importer as an alternative authority.
- It does not promise compatibility merely because local validation succeeds.

## 10. Truchsess box benefits and onboarding

### Benefits

Under the proposed model, a Truchsess owner gains a reviewed catalog with cryptographic
publisher provenance, immutable package versions, visible permission/compatibility
requirements, tenant-bound entitlements, box-local knowledge, auditable install/update/
uninstall receipts, and actionable withdrawal/revocation status. FAIVR remains the Store
and trust broker; Truchsess remains the execution and customer-data boundary.

### Box onboarding

**CURRENT:** An operator issues a single-use `TRS-...` code. The box generates/uses its
Ed25519 key, posts the code and public key to `/api/company-os/v1/enrol`, and receives its
tenant ID, instance ID, derived key ID, Store origin, Store service key, and active
publisher keys. Subsequent requests are box-signed. See [enrolment response](../web/app/api/company-os/v1/storeHandlers.ts#L63-L94).

**PROPOSED:** Keep that flow and add company-binding confirmation, trust-document revision,
publisher key validity/revocation metadata, and capability negotiation. The UI MUST show
the customer company, publisher, package/version, requested permissions, installation
questions, compatibility, price, and trust state before owner confirmation. The box MUST
not send company source identifiers or knowledge to the publisher or Store.

Publisher onboarding and box onboarding are separate. A publisher account never grants
box access; an enrolment code never grants publisher rights.

## 11. Building agents that use box-provided knowledge safely

**CURRENT:** Packages declare permissions/dependencies/slots, must state that tenant data
is absent, and may contain no credentials. FAIVR states that it never receives appliance
run content, chats, files, knowledge, or credentials.

**PROPOSED publisher guidance:** Agent packages SHOULD assume all company knowledge is
tenant-local, sensitive, mutable, and potentially adversarial.

1. **Request, do not bundle.** Ask for the minimum runtime knowledge/tool grants through
   declared permissions and installation slots. Never include customer data, API tokens,
   copied repositories, mail, chat exports, or learned runtime memory in the package.
2. **Least privilege.** Separate read, draft, and execute capabilities. Prefer scoped
   retrieval and draft output; require explicit human approval for external side effects,
   destructive changes, spending, publication, access grants, or sending messages.
3. **Treat retrieved content as data.** Do not treat instructions found in documents,
   mail, web pages, code comments, or tool output as higher-priority policy. Defend against
   prompt injection and preserve the box/runtime instruction hierarchy.
4. **Preserve provenance.** Keep source identifiers, timestamps, and confidence with
   retrieved facts; cite sources to the owner when the task depends on them. Distinguish
   retrieved evidence from agent inference.
5. **Minimize context and retention.** Retrieve only what the current task needs. Do not
   create hidden long-term memory, training data, publisher telemetry, or cross-tenant
   indexes from customer knowledge.
6. **Fail closed.** If required knowledge, permission, compatibility, or verification is
   missing, return a clear blocked/degraded result. Do not broaden scope or substitute
   untrusted external data silently.
7. **Contain outputs.** Write only to runtime-approved tenant paths and tools. Keep
   temporary material within box policy, redact secrets from logs, and never use package
   assets as an exfiltration channel.
8. **Test safely.** Use synthetic data for examples and tests. Document expected knowledge
   sources, allowed side effects, human checkpoints, and deletion/retention behavior in
   `AGENT.md`.

## 12. Security and privacy requirements

The proposed external flow MUST preserve or strengthen these constraints:

- Ed25519 signing and content addressing do not authorize execution; signature, package,
  publisher, entitlement, compatibility, and box policy must all pass independently.
- Parse and scan untrusted archives in an isolated, non-networked, resource-bounded worker.
  Reject links, special files, path escapes, duplicate normalized paths, decompression
  bombs, unsupported encodings/types, and undeclared files.
- Enforce compressed/member/expanded size, file count, path length, nesting, and processing
  time limits before publication and again on the box.
- Keep publisher authentication, signing keys, Store service keys, enrolment codes, billing
  credentials, company-reference HMAC keys, and box keys in separate trust domains.
- Never request or log private signing keys. Redact tokens, suspected secrets, source
  identifiers, owner email, tenant IDs, and signed URLs from publisher-visible logs.
- Use HTTPS, replay protection, bounded timestamp skew, nonces, idempotency, rate limits,
  and object-level authorization for all publisher and box operations.
- Make all package and review artifacts immutable/content-addressed; serve only the exact
  reviewed bytes. Do not follow cross-origin redirects for package downloads.
- Run secret, malware, dependency/license, permission, and policy checks, but describe
  them as risk reduction rather than proof of safety.
- Preserve tenant isolation in database queries, catalog projection, entitlements, billing,
  artifacts, receipts, and audit access. Publishers receive aggregate commercial data only
  when separately approved, never box content or tenant-local knowledge.
- Document retention, deletion, incident response, key compromise, package quarantine,
  customer notification, and appeal/escalation procedures before launch.
- Require independent security review and end-to-end tests for key rotation/revocation,
  company alias rotation, tenant-scope denial, rollback resistance, and compromised
  package containment.

## 13. Migration and compatibility

This document changes no schema or behavior. A future implementation SHOULD use these
phases, each independently deployable and reversible before publication:

1. **Registry foundation:** add publisher organization, key lifecycle, company identity,
   company-reference aliasing, and audit records. Backfill Old School as a verified
   publisher and existing tenants with internal company references. Do not change existing
   package bytes or signatures.
2. **Staged intake:** add authenticated upload/submission records and isolated validation,
   still requiring the existing importer and operator publication gate. No external
   package appears in production catalog.
3. **Trust distribution:** add Store-signed, rollback-resistant trust metadata and box
   capability negotiation. Legacy boxes receive only states they already understand.
4. **Limited pilot:** allow an explicit set of companies/tenants and one reviewed external
   publisher. Keep packages private and appliance-only.
5. **SDK:** release only after the server contracts stabilize; pin SDK compatibility to
   manifest and submission API versions.

Compatibility rules:

- Existing `faivr-portable-agent-bundle.v1` packages, digests, signatures, model IDs,
  subscriptions, installations, and receipts remain valid.
- Existing publisher keys remain valid until an explicit lifecycle event; migration MUST
  NOT rewrite or re-sign historical packages.
- New catalog/trust fields must be additive and optional for legacy clients, or served only
  after explicit capability negotiation. A required semantic change needs a new contract
  version.
- The Store must retain one authoritative validator per manifest version. Never reinterpret
  historical v1 bytes under new rules.
- Package withdrawal/revocation and company suspension must not delete tenant history.
  Preserve it read-only according to the existing archive/uninstall model.
- The Truchsess OS release channel remains independent from agent package publication.

## 14. Launch acceptance criteria for a future implementation

External publishing is not supported until all of the following are implemented and
verified:

- publisher/company verification and key lifecycle with separation of duties;
- privacy-reviewed company-reference derivation, rotation, and tenant binding;
- isolated staged submission, current bundle validation, review, approval, and immutable
  publication;
- Store-signed trust/revocation distribution and defined box enforcement;
- stable publisher error contract and tenant-safe audit/logging;
- compatibility tests for existing Old School packages and legacy boxes;
- threat model, incident/revocation drill, independent security review, migration/rollback
  runbook, support ownership, and production release approval.

Until then, the only supported path remains the current operator-controlled Old School
publisher workflow documented in the repository.
