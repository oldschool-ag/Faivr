# Workflows in the store (NR1, design)

Status: **design, step 1, decided.** The CEO decided D1 to D6 "as advised" on Tue 24 Nov 2026
(section 9). Nothing here is built. The box side
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
| `offerFunctionId` | Not used (D1 chose A); kept free for a later bundle (C) |
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
several functions had three ways. **Decided (D2): the chain**, one payment page per agent, one after
the other.

| Way | What she sees | Store change | Risk |
|---|---|---|---|
| **Chain (chosen, D2)** | Several payment pages in one browser tab: "Payment 1 of 2: Product Owner, second copy". The store opens the next page after each success | A `checkout-groups` record linking several checkouts; success page forwards to the next | Payments. A chain can stop halfway; each finished copy stays valid and installable |
| **One payment, several subscriptions** | One page | **Not possible with Polar** (section 3a) | |
| **One offer function** (not chosen, D1) | One page | A function whose agents are the workflow's | Double payment when she already has an agent. Kept only for Client Follow-up |

**Subscriptions stay per function copy** in every way, so removing one agent ends only its own
subscription, and copies count as today.

**Spike F-NR0** is answered in section 3a: Polar cannot take one payment for several products.

Confidence for the section: 0.8.

## 3a. F-NR0: can Polar take one payment for several products or subscriptions?

**Answer: no.** One Polar checkout buys exactly one product and gives one order or one subscription.
Confidence 0.9: Polar's documentation says so in plain words. It was read on 24 Nov 2026 and not yet
tried in the sandbox.

### What Polar's documentation says

| Question | Polar's words | Page |
|---|---|---|
| Several products in one checkout? | "Customers always purchase a single product per checkout. Selecting multiple products on a Checkout Link gives the customer a choice between them; it doesn't bundle them together. True multi-product checkout (multiple products in the same order) isn't supported yet." | https://polar.sh/docs/features/checkout/links |
| What the `products` list at checkout means | "List of product IDs available to select at that checkout. The first one will be selected by default." and "Customers will be able to switch between those products." | https://polar.sh/docs/api-reference/checkouts/create-session |
| A price made for one checkout | `prices`: "Optional mapping of product IDs to a list of ad-hoc prices to create for that product." One product, one custom amount | same page; changelog 21 Nov 2025 "Ad-hoc Checkout Pricing", https://polar.sh/docs/changelog |
| Several products in one subscription? | A subscription has one `product_id`. It may have several price parts of that one product ("you can attach multiple metered prices to the same product") | https://polar.sh/docs/features/subscriptions/introduction.md; https://polar.sh/docs/features/products |
| Moving a subscription to another product | `product_id`: "Update subscription to another product.", with proration choices | https://polar.sh/docs/api-reference/subscriptions/update; https://polar.sh/docs/features/subscriptions/proration.md |
| Several subscriptions for one customer | "By default, no — a customer can only have one active subscription per organization at a time." There is a setting that allows it. Each subscription stays separate and is billed separately | https://polar.sh/docs/features/subscriptions/introduction.md |

### What the store's code does with this

- **The store sends one product.** The checkout body is `products: [reference.reference]`
  (`web/lib/companyOs/billing/polar.ts:104-105`). With one entry, Polar's switcher has nothing to
  switch, so this is already correct.
- **The customer is known to Polar.** Every checkout carries `external_customer_id` set to the
  owner's account (`polar.ts:106`).
- **Separate subscriptions are already required.** The store needs "Allow multiple subscriptions"
  for paid copies (`polar.ts:92-95`). A room with several functions uses the same setting.

### What this means for New room

| Way | Works with Polar today? | What she sees | Cost to us |
|---|---|---|---|
| **Chain** (one checkout per function, one after the other) | Yes | One payment page per function to buy: "Payment 1 of 2" | Small. Each copy stays its own subscription, as today |
| **One payment through a "room" product with an ad-hoc price** (the sum of the missing agents) | Yes, as a checkout | One page | Large. One Polar subscription would pay for several store copies. Removing one agent then means changing that subscription's price, which the documentation does not show for ad-hoc prices. The store's rule that one copy is one subscription breaks. Payments class |
| **One offer function** (option B or C) | Yes | One page | Not chosen (D1): she would pay twice for an agent she already has |
| **Later moves between single functions and an offer** | Partly: one subscription can move to another product with proration. Several subscriptions cannot be merged into one | | Only relevant for option C |

**Decided (D2, 24 Nov, "as advised"):** the chain. "One copy is one subscription" stays. The ad-hoc
"room" product is not chosen: it saves her one or two payment pages but makes every later removal a
billing change. One page later only if Polar allows several products in one checkout.

### Not verified in this step

- Whether a returning customer pays a second checkout without typing the card again (a saved card
  offered on the next checkout). Polar's documentation describes saved cards for the customer portal
  and for pausing and resuming. It says nothing clear about a new checkout. **This decides how much
  the chain hurts.** It can be checked with two sandbox checkouts by the same customer, under the
  CEO's eyes.
- Polar's changelog before October 2025 was read only as a summary. No roadmap entry for baskets was
  found.

## 4. A workflow price

**Decided (D1, Tue 24 Nov 2026, the CEO: "as advised"): A.** A workflow is free; she pays for the
agents she does not have. Client Follow-up stays the one offer with one price (B, only there).
Cheaper workflow bundles (C) only later, after a second workflow sells. The store builds no workflow
price now.

The options as they were weighed:

- **A (the 3 Nov rule), chosen:** the workflow has no price. Nothing to build at the store but section 3.
- **B (one offer), not chosen** except for Client Follow-up: the offer **is** a function whose agents are the workflow's lead and team. The
  workflow's `offerFunctionId` points to it. One checkout, one subscription. Needs a rule for an
  agent she already has: refuse the offer and sell the missing agents, or accept paying twice.
- **C (hybrid), not chosen for now:** B plus single functions still sold. The box shows the cheaper total for what is
  missing. Needs: which subscription covers an agent bought both ways; what happens when she removes
  one agent of an offer (the offer stays whole until she ends it).

Example prices for the arithmetic only (real prices are set per function with
`scripts/company-os-store-admin.mjs:89-94`): Product Owner CHF 249, Software delivery (Bob and roles)
CHF 299, Website Owner CHF 99. A product room is CHF 647 one by one (A), or an offer at, say,
CHF 549 (B, C). Customers stays Client Follow-up at CHF 149.


## 5. Copies

- A copy is one subscription (`tenantId, instanceId, bundleId, copyNumber`), unchanged.
- **One lead install can lead several rooms** when it leads per product (the Product Owner): the box
  makes one room per product it works for. The company's own rule keeps one Product Owner copy per
  product, so a new product room usually sells a new copy (D5).
- **One team agent may work in several rooms** (Bob in GDER and in Webshop) when the box allows it,
  shown in both rooms (D5). The store sells nothing extra for that.
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

| # | Pull request | Risk class | When |
|---|---|---|---|
| F-NR0 | Spike: Polar and several subscriptions in one payment; written answer only. **Done: section 3a, the answer is no** | none | Done |
| F-NR1 | Workflow documents: table, signature check, `import-workflow`, `workflows[]` in the store catalog, public listing; no price (D1); Old School's key only (D6) | Catalog the box reads | Can start |
| F-NR2 | Several functions in one purchase: one payment page per agent, one after the other (D2); subscriptions stay per copy | **Payments** | D1 and D2 decided |
| ~~F-NR3~~ | Offer price for a workflow: **not built** (D1 chose A); comes back as C only after a second workflow sells | Payments | Not chosen |

Payments pull requests merge only with the supervisor's review, the other company's code and security
review, the box's full test against the store change, and the CEO's own "merge".

## 9. The CEO's decisions

The CEO decided NR1 **"as advised"** on Tue 24 Nov 2026, about 13:20 Swiss time (relayed by the
supervisor). The same table is section 12 of the box document. Nothing here is open any more.

| # | Decided | Not chosen, and why | What it means for the store |
|---|---|---|---|
| D1 | **Price: A.** A workflow is free; she pays for the agents she does not have. Client Follow-up stays the one offer with one price (B, only there). Cheaper workflow bundles (C) only later, after a second workflow sells | B for every workflow: she would pay twice for an agent she has. C now: too early, no sales data | No workflow price, no offer table; `offerFunctionId` unused; F-NR3 not built |
| D2 | **Several agents to buy: one payment page per agent, one after the other.** Polar takes one product per checkout (F-NR0). One page later only if Polar allows it | One "room" product with a made-up total: one subscription would pay for several copies | F-NR2 builds the chain; one copy stays one subscription |
| D3 | **Members:** a member may create a room only from agents she already has; anything to buy goes to an administrator as one ask | A member buying | Nothing: the store only sells to the box's signed requests, which only an administrator's press starts |
| D4 | **Rooms come back** only when the room shows its real team and every red state has its reason and one button, proven on box 2 | Rooms back before the room page is true | Nothing: box only |
| D5 | **One agent may work in several rooms** when allowed, shown in both. Each product still gets its own Product Owner copy | One Bob copy per room | Nothing new to sell; a new product room still sells a new Product Owner copy |
| D6 | **Only Old School publishes workflows** for now | Other publishers: needs a review process for their routes and texts first | `import-workflow` accepts Old School's enrolled publisher key only |
