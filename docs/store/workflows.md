# Workflows in the store (NR1, design)

Status: **design, step 1. Nothing here is built.** It waits for the CEO's decisions. The box side
is in oldschool-ag/truchsess, `docs/architecture/new-room-flow.md` (same task, its own draft pull
request).

The CEO, 24 Nov 2026: "If I click on New room I expected it takes me through the process of the new
room. Like a description of the workflow, then Truchsess can recommend the agents I should install
and if the workflow already exists I can simply download it, or I can add the agents I need to
create my own workflow. This needs to be designed with FAIVR as well, as the store has to manage
the payment of the workflow or the agents."

Every claim about today's code names its file and line in this repository. Each answer ends with a
confidence from 0 to 1.

## 1. What the store has today

| What | Today | Where |
|---|---|---|
| A function | One row with one monthly price (CHF by default), one Polar product, and several agents (packages) through a join table. A lead and its roles are one function | `web/sql/company-os-marketplace.sql:27-28`, `:42`; `web/lib/companyOs/privateStore.ts:216-228` |
| The lead | A signed manifest flag `functionLead`; at most one lead per function | `scripts/import-company-os-bundle.mjs:170`, `:226-231`; `web/lib/companyOs/privateStore.ts:149-162` |
| Workflow | **Not found.** No table, type or field. "workflows" appears only as an allowed archive folder name and in test fixtures | `scripts/import-company-os-bundle.mjs:118-119`; `web/tests/company-os-bundle-import.test.ts:60` |
| Offers | **Not found** as an object. "Client Follow-up" is not in the store's code. The CHF 149 item is the `company-mail` function (Penn) | `docs/company-mail-admin.md:13` |
| "Flat with the box" | **Not found.** Every price is per box, per month, per copy | `web/app/catalog/page.tsx:47`; `docs/company-os-marketplace-runbook.md:179` |
| The catalog the box reads | `GET /api/company-os/v1/store/catalog`: functions with their packages, prices, permissions, images, the box's copies. Requests are signed by the box; **the answer is not signed as a document** | `web/app/api/company-os/v1/storeHandlers.ts:99-118`; `web/lib/companyOs/privateStore.ts:259-380`; request signature `web/lib/companyOs/http.ts:13-43` |
| Package signatures | Each package's manifest is signed by its publisher (Ed25519), verified at import, and again on the box | `scripts/import-company-os-bundle.mjs:207-210`; download headers `web/app/api/company-os/v1/handlers.ts:32` |
| The public catalog (W1 of the store) | A read-only list an administrator opts each function into; only signed, published packages appear; no customer or billing data | `web/sql/migrations/20261006_public_catalog.sql:1-3`; `web/lib/publicCatalogData.ts:18-37`; `web/lib/publicCatalogAdmin.ts:12-45` |
| One checkout | Exactly one function copy: one `bundleId` in, one Polar product out | `web/lib/companyOs/storeSchemas.ts:25-32`; `web/lib/companyOs/billing/polar.ts:104-105` |
| Copies | One subscription per copy at the same price; `copyNumber`; a live copy is refused a second checkout | `web/sql/migrations/20261017_f12_paid_copies.sql:1-25`; `web/lib/companyOs/privateStore.ts:432-443`; `web/app/api/company-os/v1/storeHandlers.ts:139-140` |
| Payment | Card data only at Polar; the box gets a hosted page address and opens it in the browser; Polar's webhook activates the copy; reconciliation every 15 minutes and on each catalog read | `docs/company-os-marketplace-runbook.md:159`; `web/lib/companyOs/billing/provider.ts:51-52`; `web/app/api/company-os/v1/billing/polar/webhook/route.ts:20-55`; `web/lib/companyOs/checkoutReconciliation.ts:77-115`; `web/vercel.json:5-6` |
| Polar setting | "Allow multiple subscriptions" must be on for copies | `web/lib/companyOs/billing/polar.ts:92-95` |
| Billing period | Monthly only | `scripts/import-company-os-bundle.mjs:178`; `scripts/company-os-store-admin.mjs:9` |
| Publishing | Command line only, with the store database's address; no web admin path | `scripts/company-os-store-admin.mjs:63-142`; `web/scripts/store-public-catalog-admin.mjs:1-60` |
| Permissions in plain words | Per package, including `delegate:<x>` as "Hand work to <x>" | `web/lib/publicPermissions.ts:1-39`, `:35` |

**What can carry a workflow today without new data:** a function already carries "a lead and its
team at one price" (option B below). Nothing carries a workflow that spans **several** functions,
its steps, its rhythm or its first task.

Confidence: 0.9 (read in the code).

## 2. A workflow as store data

A workflow is a **signed document**, separate from packages and functions. It sells nothing and
grants nothing. It names functions by id and says how their agents work together.

| Field | Meaning |
|---|---|
| `id`, `version`, `name`, `sentence` | Identity and what it does, in two sentences at most (English and German) |
| `lead` | A function id and role; `perProduct` when it leads one room per product |
| `team` | Function ids with `base` (needed) or extra |
| `routes` | The hand-offs the workflow expects, `{from, to}` by function id |
| `process` | Steps: who, rhythm (on request, daily, weekly with a day), optional routine, what it does |
| `connections` | What she will connect (GitHub, website, mailbox) |
| `firstTask`, `match` | The guided first task; phrases that find it |
| `minCompanyOsVersion` | Like packages |
| `offerFunctionId` | Only if the CEO chooses an offer price (section 4) |
| `signature`, `publisherKeyId` | Ed25519 over the canonical document, as for manifests |

The shape is the box's W1 catalog (oldschool-ag/truchsess, branch `claude/w1-workflows`,
`apps/installer/nixos-image/payload/company-os-workflows.v1.json`) plus `lead`, `team` and `routes`.

**Where it lives:** a new table `company_os_workflows` (id, version, document, publisher key id,
signature, status, public flag), listed in the store catalog as `workflows[]` next to `bundles[]`.
Not a package kind: a package installs and runs; a workflow does neither, and mixing them would let a
workflow ride the package install path.

**Who publishes:** an enrolled publisher signs it; the store administrator imports it with a new
command (`import-workflow`), which verifies the signature against the enrolled key, checks that every
function id exists and is active, and refuses an unknown field. Public listing works like W1:
`setWorkflowPublic` refuses unless every function it names is public.

**What the store must not decide:** whether a route is allowed. The box checks every route against
the sending agent's own signed manifest. The store's validator refuses obvious mistakes early.

Confidence: 0.75. A new table is the cleanest; the alternative (a function with a workflow field)
saves one table but ties a workflow to one function.

## 3. One checkout for several agents

Today one checkout is one function copy, one Polar product, one subscription. A room that needs
several functions has three ways:

| Way | What she sees | Store change | Risk |
|---|---|---|---|
| **Chain** | Several payment pages in one browser tab: "Payment 1 of 2: Product Owner, second copy". The store opens the next page after each success | A `checkout-groups` record linking several checkouts; success page forwards to the next | Payments. A chain can stop halfway; each finished copy stays valid and installable |
| **One payment, several subscriptions** | One page | Depends on Polar (spike F-NR0) | Unknown until verified |
| **One offer function** | One page | A function whose agents are the workflow's (option B or C) | Double payment when she already has an agent |

**Subscriptions stay per function copy** in every way, so removing one agent ends only its own
subscription, and copies count as today.

**Spike F-NR0, before any build:** read Polar's checkout documentation and test in the sandbox
whether one checkout can create several subscriptions for several products. My inference from
`polar.ts:104-105` (the store already sends a list, `products: [...]`) is that Polar's list is a
choice of products, not a basket. Confidence that it is not a basket: 0.6. Not verified in this step.

Confidence for the section: 0.7.

## 4. A workflow price, if the CEO wants one

The store already has the parts: a function with several agents at one price, one Polar product.

- **A (the 3 Nov rule):** the workflow has no price. Nothing to build at the store but section 3.
- **B (one offer):** the offer **is** a function whose agents are the workflow's lead and team. The
  workflow's `offerFunctionId` points to it. One checkout, one subscription. Needs a rule for an
  agent she already has: refuse the offer and sell the missing agents, or accept paying twice.
- **C (hybrid):** B plus single functions still sold. The box shows the cheaper total for what is
  missing. Needs: which subscription covers an agent bought both ways; what happens when she removes
  one agent of an offer (the offer stays whole until she ends it).

Example prices for the arithmetic only (real prices are set per function with
`scripts/company-os-store-admin.mjs:89-94`): Product Owner CHF 249, Software delivery (Bob and roles)
CHF 299, Website Owner CHF 99. A product room is CHF 647 one by one (A), or an offer at, say,
CHF 549 (B, C). Customers stays Client Follow-up at CHF 149.

Recommendation (same as the box document): **A as the rule, B only for Client Follow-up, C after a
second workflow sells.** Confidence 0.65.

## 5. Copies

- A copy is one subscription (`tenantId, instanceId, bundleId, copyNumber`), unchanged.
- **One lead install can lead several rooms** when it leads per product (the Product Owner): the box
  makes one room per product it works for. The company's own rule keeps one Product Owner copy per
  product, so a new product room usually sells a new copy.
- An offer bought twice is two copies of the offer function, each priced again (17 Oct rule).

Confidence: 0.85.

## 6. What the box must verify

1. The workflow's signature against a trusted publisher, before it is shown.
2. Every function id in the workflow is in the same catalog answer, and active.
3. Every route is declared by the sending agent's own signed manifest (`delegate:<package>`); a
   workflow never adds a permission or a route the agents do not declare.
4. The price on her Yes card equals the catalog's price when the checkout is created (the box's copy
   flow does this already).
5. A workflow for a newer box (`minCompanyOsVersion`) is not offered.

## 7. Risks that must not happen, on the store side

| Risk | Stop |
|---|---|
| A payment without her tap | The store only creates a checkout for a signed box request; the box sends it only after her press; card entry is at Polar in her browser |
| A chain that charges for something she cancelled | Each page is its own checkout; cancelling leaves the paid ones paid and creates nothing more |
| A workflow that grants more | The store's validator refuses unknown fields and permissions; the box re-checks (section 6) |
| A public workflow naming a private function | `setWorkflowPublic` refuses it, as W1 refuses an unsigned package |

## 8. Build order (store)

| # | Pull request | Risk class | Before the pricing decision? |
|---|---|---|---|
| F-NR0 | Spike: Polar and several subscriptions in one payment; written answer only | none | Yes |
| F-NR1 | Workflow documents: table, signature check, `import-workflow`, `workflows[]` in the store catalog, public listing; no price | Catalog the box reads | Yes |
| F-NR2 | Several functions in one purchase (chain, or one payment after F-NR0); subscriptions stay per copy | **Payments** | After |
| F-NR3 | Offer price for a workflow (only if B or C) | **Payments** | After, only if chosen |

Payments pull requests merge only with the supervisor's review, the other company's code and security
review, the box's full test against the store change, and the CEO's own "merge".
