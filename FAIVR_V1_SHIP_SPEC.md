# FAIVR v1 ship spec

Product truth: **FAIVR is a USDC-on-Base task marketplace for verifiable AI services.**

Every surface must be consistent with that one sentence.

---

## Must-ship checklist (P0)

### 1. USDC as primary payment rail

**Problem:** Funding flow sends ETH via `value`. Product framing says USDC. These contradict.

**Fix:**
- Add USDC address (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) to `lib/contracts.ts`
- Add `useFundTaskUSDC` hook: ERC-20 approval + `fundTask(agentId, USDC_ADDRESS, amount, deadline)` flow
- `FundTaskForm` defaults to USDC with 2-step fund flow (approve → fund)
- `TaskManager` shows USDC amounts with correct 6-decimal formatting
- ETH support exists on-chain but is removed from primary UX

**Files:** `lib/contracts.ts`, `hooks/useEscrow.ts`, `components/escrow/FundTaskForm.tsx`, `components/escrow/TaskManager.tsx`

---

### 2. Task brief as first-class artifact

**Problem:** Current hire flow goes straight to "amount + deadline". No task definition. No scope. No acceptance criteria. Settlement provenance weakens. Disputes become he-said/she-said.

**Fix:** Replace `FundTaskForm` modal with 3-step flow:
- **Step 1 — Brief:** title (required), what you need done (required), expected output (optional), acceptance criteria (optional)
- **Step 2 — Terms:** USDC amount (required), deadline, fee preview
- **Step 3 — Fund:** task summary, approve USDC (if needed), fund escrow button

Task brief is captured before any payment commitment. Shown in confirmation. Stored client-side.

**Files:** `components/escrow/FundTaskForm.tsx`

---

### 3. Explicit trust states instead of rating theatre

**Problem:** `AgentCard` shows star ratings and review counts. `useAgents` always returns `rating: 0, reviews: 0`. So the UI shows "0.0 (0 settled reviews)" — which looks broken and is fake-precision trust theatre.

**Fix:** Replace star/count display with explicit state chips:
- `Identity minted` — green, always present if agent is listed
- `Domain verified` / `Not verified` — from `agent.verified`  
- `No settled tasks yet` — honest current state since we don't have on-chain task counts yet

This is more honest, more informative, and doesn't pretend to have data it doesn't have.

**Files:** `components/agent/AgentCard.tsx`

---

### 4. Contextual Basescan links

**Problem:** "View on Basescan" links to the generic Identity Registry contract address. Not useful for most buyers.

**Fix:** Link to the specific agent NFT token page:
`https://basescan.org/nft/{CONTRACTS.identity}/{agent.id}`

This shows the specific token, its owner, its transfer history. Actually useful for inspection.

**Files:** `lib/site.ts`, `components/agent/AgentCard.tsx`

---

### 5. Onboarding: operator track before technical track

**Problem:** `OnboardForm` leads with technical fields (MCP/A2A endpoints). Non-technical operators will bounce. The form should build the service definition first, endpoints second.

**Fix:** Visually split form into two sections:
- **What your agent does:** name, category, description, delivery description, pricing mode (fixed / quote)
- **Technical access (optional):** MCP endpoint, A2A endpoint

Also update the onboard page side panel to describe the two-track model.

**Files:** `app/onboard-agent/page.tsx`, `components/onboarding/OnboardForm.tsx`

---

## P1 (after this pass)

- Agent detail page with full capability/service fields
- On-chain task brief anchoring (briefURI stored in fundTask call)
- Task-level Basescan deep links (tx hash stored in task record)
- Pricing mode surfaced in marketplace card
- Reputation hook reading real on-chain summaries

---

## Screen-by-screen v1 spec

### Screen A: Marketplace — Agent Card

**Job:** Let buyer quickly assess agent fit and decide to inspect.

**Trust state strip (replaces star rating):**
```
[✓ Identity minted]  [✓ Domain verified] or [— Not verified]  [— No settled tasks yet]
```

Chips use explicit label, small border-badge style. Green for confirmed, gray for unconfirmed/absent. No stars. No detached numeric scores.

**Basescan button:** removed from card (still in detail modal). Card shows name, description, tags, trust strip, "View details →".

---

### Screen B: Agent Detail Modal → Hire flow

**Step 1 — Brief**
- Header: "Task brief"
- Subtext: "Define what you need before committing funds."
- Fields: Task title*, What you need done*, Expected output, Acceptance criteria
- CTA: "Set payment terms →"
- Progress bar: 3 steps, step 1 active

**Step 2 — Terms**
- Header: "Payment terms"  
- Fields: Amount (USDC*), Deadline (select)
- Fee preview: "Agent receives / Protocol fee / You pay" breakdown
- Brief summary card (condensed, read-only)
- CTA: "Review and fund →"
- Progress bar: step 2 active

**Step 3 — Fund**
- Header: "Fund escrow"
- Task summary (title, brief excerpt, amount, deadline)
- If allowance insufficient: "Approve USDC spending" → confirms → switches to "Fund task"
- If allowance sufficient: "Fund X.XX USDC" directly
- Footnote: "Funds held by contract, not FAIVR. Reclaim available after deadline."
- Error state: inline red banner

**Step 4 — Confirmed**
- Checkmark
- Task ID (if extractable from receipt)
- Brief title
- Amount + agent name
- "Done" button

---

### Screen C: My Tasks (TaskManager)

**Change:** Show correct token symbol and amount.
- ETH tasks: `formatEther(amount)` + "ETH" label
- USDC tasks: `formatUnits(amount, 6)` + "USDC" label

---

### Screen D: Agent Detail Modal — Trust panel

Replaces star/review line with:
```
Identity: minted
Verification: [complete | not verified]
Settled tasks: [count or "None yet"]
```

Basescan button → `https://basescan.org/nft/{identity_contract}/{agent.id}`

---

### Screen E: Onboard Agent

**Side panel (NEEDS cards):**
- Track 1 cards: "Define your service" (description, delivery, pricing), "Pick your category"
- Track 2 cards: "Technical access (optional)" (endpoints), "Trust discipline"

**Form sections:**
1. About your agent — name, category, description
2. What you deliver — delivery description (what buyers receive and when), pricing mode (Fixed price / Request a quote)
3. Technical access (optional) — MCP endpoint, A2A endpoint

---

## Acceptance checklist

- [ ] USDC shows as primary payment denomination throughout
- [ ] ETH label is absent from primary hire/fund UX
- [ ] Task brief step 1 is required before any payment
- [ ] Fund step shows correct USDC amount with 2-decimal formatting
- [ ] Agent card shows trust state chips, not stars
- [ ] "View on Basescan" in detail modal links to NFT-specific URL
- [ ] Onboard form has visible "About" / "Technical" section split
- [ ] `pricingMode` and `deliveryDescription` included in mint metadata
- [ ] Build passes with zero new TypeScript errors
