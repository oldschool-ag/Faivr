# FAIVR — Product Requirements Document

**Version:** 1.0  
**Date:** 2026-02-10  
**Author:** FAIVR Team  
**Operator:** Old School GmbH (CHE-485.065.843), Walchwil, Switzerland

> Status note: this is a historical product planning document. Statements about multisig, timelock, launch posture, or future architecture are target-state references unless independently verified onchain. See `docs/protocol-admin-risk.md`.

---

## 1. Executive Summary

FAIVR (pronounced "favor") is a non-custodial, on-chain marketplace for discovering, trusting, and hiring AI agents. Built on the ERC-8004 standard (Trustless Agents), FAIVR provides:

- **Discovery**: Agents register with on-chain identity NFTs, making them browsable and filterable
- **Trust**: Composable reputation and validation signals let clients assess agents without pre-existing relationships
- **Payments**: Non-custodial escrow with programmable fee splits, integrated with x402 for HTTP-native payments
- **Openness**: No walled gardens — any agent can register, any client can hire, any validator can attest

**First vertical:** DeFi agents (portfolio rebalancing, yield optimization, risk monitoring, strategy execution).

**Revenue model:** Protocol fee deducted at task settlement — 90% to Old School GmbH, 10% to dev fund.

**Target chain:** L2 (Base recommended — see Section 7).

---

## 2. Problem Statement

AI agents are proliferating but the infrastructure for **cross-organizational trust** doesn't exist:

- **Closed platforms** (OpenAI, Anthropic) act as trust authorities but create walled gardens
- **No portable identity** — an agent's track record on one platform doesn't transfer
- **No composable verification** — you can't programmatically check if an agent was audited, re-executed, or zkML-verified
- **Payment friction** — API keys, subscriptions, credit cards don't work for agent-to-agent transactions
- **No accountability** — when an agent fails, there's no on-chain record or dispute mechanism

FAIVR solves this by combining ERC-8004's three registries (Identity, Reputation, Validation) with non-custodial payments and a marketplace frontend.

---

## 3. Target Users

### 3.1 Agents (Supply Side)
- **DeFi bots**: Yield optimizers, portfolio rebalancers, MEV searchers, risk monitors
- **Service agents**: Code auditors, data analysts, content generators, document processors
- **Infrastructure agents**: Oracle providers, bridge relayers, keepers

**What they want:** Visibility, reputation building, payment for services, verifiable credentials.

### 3.2 Clients (Demand Side)
- **DeFi users**: Want automated portfolio management from trustworthy agents
- **DAOs**: Need vetted agents for treasury management, governance automation
- **Developers**: Looking for specialized agents to integrate into workflows
- **Enterprises**: Seeking audited, compliant agents for high-stakes tasks

**What they want:** Easy discovery, trust signals they can verify, non-custodial payments, recourse if things go wrong.

### 3.3 Validators (Trust Layer)
- **Stakers**: Re-execute agent workflows to verify outputs
- **Auditors**: Manual review of agent code, behavior, outputs
- **zkML provers**: Generate zero-knowledge proofs of model outputs
- **TEE operators**: Provide trusted execution environment attestations

**What they want:** Fees for validation work, reputation as a reliable validator.

---

## 4. User Flows

### 4.1 Agent Registration
```
Agent → FAIVR.app → Fill registration form (name, description, capabilities, 
endpoints MCP/A2A, pricing) → Upload to IPFS (pin metadata) → Mint ERC-8004 
Identity NFT (agentURI → IPFS hash) → Agent visible on marketplace
```

### 4.2 Discovery & Browsing
```
Client → FAIVR.app → Browse/filter agents by:
  - Category (DeFi, DevOps, Data, etc.)
  - Validation tier (manual, re-execution, zkML, TEE)
  - Reputation score (aggregated on-chain reviews)
  - Price range
  - Active status
→ View agent detail page → Inspect trust signals
```

### 4.3 Trust Inspection
```
Client → Agent detail page → View:
  - Reputation score (running average of 1-5 ratings)
  - Individual reviews (EIP-712 signed, verifiable)
  - Validation attestations (who validated, what type, when)
  - MultiTrust credential (ERC-8035 aggregated trust from multiple sources)
  - ENS trust graph (ERC-8107 transitive trust)
  - Payment history via x402 outcomes
  - Soulbound badges (ERC-5192 non-transferable credentials)
```

### 4.4 Task Initiation
```
Client → Agent detail page → "Hire Agent" → Define task parameters →
Deposit funds into FaivrFeeModule escrow (USDC or ETH) →
Agent receives task notification via MCP/A2A endpoint →
Agent accepts/rejects
```

### 4.5 Payment Settlement
```
Agent completes task → Client confirms completion (or timeout triggers auto-settle) →
FaivrFeeModule releases funds:
  - Agent receives: task amount minus protocol fee
  - Protocol fee split: 90% Old School GmbH wallet, 10% dev fund
  - Transaction recorded on-chain
→ Client prompted to leave review
```

### 4.6 Validation Flow
```
Agent/Client → Request validation (specify type: MANUAL/RE_EXECUTION/ZKML/TEE) →
Validator picks up request → Performs validation → Submits attestation on-chain →
Attestation visible on agent profile → Feeds into MultiTrust score
```

### 4.7 Dispute (Phase 2)
```
Client disputes task outcome → Dispute window opens →
Evidence submitted by both parties → Validator panel reviews →
Resolution: refund, partial payment, or full payment →
Outcome recorded in reputation registry
```
*Note: No existing ERC covers on-chain dispute resolution for agent services — this is a gap FAIVR could pioneer.*

---

## 5. Smart Contract Architecture

### 5.1 Contract Diagram
```
                    ┌──────────────────┐
                    │   FaivrRouter    │
                    │  (Orchestrator)  │
                    └────────┬─────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
   ┌────────▼───────┐ ┌─────▼──────┐ ┌───────▼────────┐
   │   Identity     │ │ Reputation │ │  Validation    │
   │   Registry     │ │ Registry   │ │  Registry      │
   │  (ERC-721 +    │ │ (EIP-712   │ │ (Attestations, │
   │   URIStorage)  │ │  reviews)  │ │  Validator WL) │
   └────────────────┘ └────────────┘ └────────────────┘
            │                │                │
            └────────────────┼────────────────┘
                             │
                    ┌────────▼─────────┐
                    │  FaivrFeeModule  │
                    │ (Escrow + Split) │
                    │  USDC / ETH      │
                    └──────────────────┘

  External integrations:
  ├── ERC-4337 (Account Abstraction) — smart accounts for agents
  ├── ERC-8035 (MultiTrust) — aggregated trust credentials
  ├── ERC-5192 (Soulbound) — non-transferable badges
  ├── ERC-7710 (Delegation) — granular capability grants
  ├── EAS (Attestation Service) — flexible attestation layer
  └── x402 — HTTP-native payment integration
```

### 5.2 Core Contracts

| Contract | Base | Purpose |
|----------|------|---------|
| `FaivrIdentityRegistry` | ERC-721 + URIStorage + UUPS | Agent registration, identity NFTs, metadata |
| `FaivrReputationRegistry` | UUPS + AccessControl | Signed reviews, ratings, aggregation |
| `FaivrValidationRegistry` | UUPS + AccessControl | Validation requests, attestations, validator whitelist |
| `FaivrFeeModule` | UUPS + ReentrancyGuard | Non-custodial escrow, fee split, settlement |
| `FaivrRouter` | UUPS | Orchestrator, helper functions for common flows |

### 5.3 Key Functions

**Identity Registry:**
- `registerAgent(string agentURI) → uint256 agentId` — mint NFT
- `updateAgentURI(uint256 agentId, string newURI)` — update metadata
- `deactivateAgent(uint256 agentId)` — mark as inactive

**Reputation Registry:**
- `postReview(uint256 agentId, uint8 rating, string commentURI, bytes signature)` — EIP-712 signed
- `getAverageRating(uint256 agentId) → (uint256 average, uint256 count)`
- `getReviews(uint256 agentId, uint256 offset, uint256 limit) → Review[]`

**Validation Registry:**
- `requestValidation(uint256 agentId, ValidationType vType, string evidenceURI)`
- `submitAttestation(uint256 agentId, uint256 requestId, bool passed, string proofURI)`
- `addValidator(address validator)` / `removeValidator(address validator)`

**Fee Module:**
- `fundTask(uint256 agentId, uint256 taskId, address token, uint256 amount)` — deposit escrow
- `settleTask(uint256 taskId)` — release to agent + split fees
- `reclaimTask(uint256 taskId)` — client reclaims after timeout

---

## 6. Off-chain Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  FAIVR.app  │────▶│   API Layer  │────▶│   Indexer    │
│  (Next.js)  │     │  (REST/GQL)  │     │ (The Graph)  │
└─────────────┘     └──────────────┘     └──────┬───────┘
       │                                         │
       │            ┌──────────────┐             │
       └───────────▶│  IPFS/Pinata │             │
                    │  (metadata)  │             │
                    └──────────────┘     ┌───────▼───────┐
                                        │  L2 Contracts │
                                        │  (Base)       │
                                        └───────────────┘
```

### 6.1 Indexer (The Graph / Substreams)
- Listens to contract events: `AgentRegistered`, `ReviewPosted`, `AttestationSubmitted`, `TaskFunded`, `TaskSettled`
- Aggregates into queryable entities: Agent profiles, reputation scores, validation history, task status
- Provides GraphQL API for the frontend

### 6.2 API Layer
- REST + GraphQL endpoints
- Agent search with filters (category, rating, validation tier, price)
- Caching layer (Redis) for frequently accessed agent profiles
- Rate limiting and auth (for agent dashboard operations)

### 6.3 Frontend (FAIVR.app)
- **Next.js 14+** with App Router
- **Wallet connection**: RainbowKit / wagmi for ERC-4337 compatible wallets
- **Pages**: Home/browse, Agent detail, Agent dashboard, Client dashboard, Registration wizard
- **IPFS pinning**: Pinata SDK for agent metadata uploads
- **Real-time**: WebSocket subscriptions for task status updates

### 6.4 IPFS Metadata
- Agent registration files pinned to IPFS via Pinata
- Format follows ERC-8004 registration file spec (type, name, description, image, services, supportedTrust)
- Images stored on IPFS, referenced in metadata

---

## 7. L2 Evaluation & Recommendation

| Criteria | Base | Optimism | Arbitrum |
|----------|------|----------|----------|
| **Gas costs** | Very low (~$0.01-0.05/tx) | Low (~$0.02-0.10/tx) | Low (~$0.02-0.08/tx) |
| **Tooling** | Excellent (Foundry, Hardhat, all standard) | Excellent | Excellent |
| **DeFi TVL** | ~$8B+ | ~$7B+ | ~$12B+ |
| **Developer ecosystem** | Strong, Coinbase-backed | Strong, OP Stack | Strongest, most dApps |
| **Account Abstraction** | Native support, Coinbase Smart Wallet | Good ERC-4337 support | Good ERC-4337 support |
| **The Graph** | Supported | Supported | Supported |
| **x402 integration** | Native — Coinbase built x402 | Good | Good |
| **Onboarding** | Coinbase onramp (fiat → USDC) | Bridge from mainnet | Bridge from mainnet |
| **Brand alignment** | "Onchain economy" narrative | Retroactive public goods | DeFi powerhouse |

### Recommendation: **Base**

**Why Base:**
1. **x402 is a Coinbase protocol** — Base is the natural home for x402-integrated projects
2. **Coinbase Smart Wallet** — best-in-class account abstraction UX, aligns with ERC-4337 agent wallets
3. **Lowest costs** — critical for bootstrapped budget
4. **Fiat onramp** — Coinbase users can fund wallets with zero crypto knowledge
5. **USDC native** — primary settlement token, Circle + Coinbase alignment
6. **Ecosystem momentum** — fastest growing L2 for new protocols

**Fallback:** Arbitrum if DeFi depth is more important (more existing DeFi agents to onboard).

---

## 8. Revenue Mechanics

### 8.1 Fee Structure
- **Protocol fee**: Configurable percentage (initially **2.5%**) of task settlement value
- **Split**: 90% → Old School GmbH multisig, 10% → Dev fund multisig
- **Collected when**: `settleTask()` is called — fees deducted before agent payout
- **Supported tokens**: USDC (primary), ETH (secondary), extensible to other ERC-20s

### 8.2 Fee Flow
```
Client deposits 100 USDC → Escrow holds 100 USDC →
Task completed → settleTask() →
  Agent receives: 97.50 USDC
  Old School GmbH: 2.25 USDC (90% of 2.5%)
  Dev fund: 0.25 USDC (10% of 2.5%)
```

### 8.3 Fee Governance
- Fee percentage adjustable by admin (Old School GmbH) via `setFeePercentage()`
- Hard cap at 10% (smart contract enforced)
- 7-day timelock on fee changes (transparency)

---

## 9. Validator MVP Design

### 9.1 Initial Model: Whitelisted Validators
- Admin-managed whitelist of trusted validator addresses
- Validators can be individuals, services, or DAOs
- Each validator has a profile (name, specialization, methodology)

### 9.2 Validation Types (MVP)
| Type | Description | Implementation |
|------|-------------|----------------|
| **MANUAL** | Human review of agent behavior/output | Validator submits attestation with evidence URI |
| **RE_EXECUTION** | Re-run agent task, compare outputs | Validator runs same inputs, submits match/mismatch result |

### 9.3 Validation Types (Phase 2)
| Type | Description | Implementation |
|------|-------------|----------------|
| **ZKML** | Zero-knowledge proof of model output | Integration with zkML frameworks (EZKL, etc.) |
| **TEE** | Trusted execution environment attestation | Intel SGX / ARM TrustZone attestation verification |

### 9.4 Display
- Agent profile shows validation badges with tier indicators
- Validation history timeline (when, who, what type, result)
- Trust score incorporates validation tier weight

---

## 10. Security Considerations

### 10.1 Smart Contract Security
- **UUPS proxy**: Upgrade restricted to admin with timelock
- **Reentrancy guards**: On all payment functions
- **Access control**: Role-based (ADMIN, VALIDATOR, AGENT_OWNER)
- **Input validation**: URI format checks, rating bounds (1-5), amount > 0
- **Audit**: Pre-mainnet audit essential (budget for Phase 3)

### 10.2 Economic Security
- **Sybil resistance**: Registration fee (small, covers gas + discourages spam)
- **Review manipulation**: EIP-712 signatures tie reviews to wallets; can weight by reviewer reputation
- **Validator collusion**: Initially mitigated by whitelist; later by staking + slashing

### 10.3 Operational Security
- **Admin keys**: Multi-sig (Gnosis Safe) for Old School GmbH and dev fund
- **Timelock**: On fee changes and contract upgrades
- **Emergency pause**: Circuit breaker on FeeModule for critical bugs

### 10.4 Data Security
- **On-chain**: All public — no private data in contracts
- **IPFS**: Agent metadata is public; private info (API keys, etc.) stays off-chain
- **Frontend**: Standard web security (CSP, HTTPS, auth for dashboards)

---

## 11. Budget & Timeline

### 11.1 Budget Breakdown (≤$1k ETH)
| Item | Estimated Cost |
|------|---------------|
| L2 contract deployments (Base) | ~$50-100 |
| The Graph subgraph deployment | Free (hosted) or ~$50 |
| IPFS pinning (Pinata free tier) | $0 |
| Domain (faivr.app) | ~$15/yr |
| Vercel hosting (frontend) | $0 (free tier) |
| Testnet deployment + testing | ~$0 (free testnet ETH) |
| Buffer | ~$800 |

### 11.2 Timeline

**Phase 1: Design & Specification (Weeks 1-2)** ← WE ARE HERE
- [x] EIP/ERC research
- [x] PRD
- [ ] Contract architecture
- [ ] Legal docs review
- [ ] Final tech stack decisions

**Phase 2: Smart Contract Development (Weeks 3-5)**
- [ ] Contract implementation (Foundry)
- [ ] Unit tests (100% coverage target)
- [ ] Integration tests
- [ ] Base Sepolia testnet deployment
- [ ] Internal testing

**Phase 3: Off-chain & Frontend (Weeks 6-8)**
- [ ] The Graph subgraph
- [ ] API layer
- [ ] Frontend MVP (Next.js)
- [ ] IPFS integration
- [ ] Wallet connection + tx flows

**Phase 4: Launch (Weeks 9-10)**
- [ ] Security review / audit (basic — budget permitting)
- [ ] Base mainnet deployment
- [ ] Seed first DeFi agents (manual onboarding)
- [ ] Public launch
- [ ] Marketing push

---

## 12. Open Questions & Decisions

| # | Question | Status |
|---|----------|--------|
| 1 | Exact protocol fee percentage (2.5% vs 5%?) | Leaning 2.5% |
| 2 | Registration fee for agents? (spam prevention vs. onboarding friction) | TBD |
| 3 | Dispute resolution mechanism for Phase 2 | Opportunity to pioneer new ERC |
| 4 | Token launch? (governance token for validators, staking) | Out of scope for MVP |
| 5 | Cross-chain deployment timeline (Arbitrum, Optimism) | Phase 2+ via ERC-7683 |
| 6 | Validator incentive model (fees, staking rewards) | Phase 2 |
| 7 | Agent-to-agent transactions (agents hiring agents) | Architecturally supported, UX TBD |
| 8 | FINMA classification of ERC-8004 NFTs under Swiss DLT law | Needs legal review |

---

## 13. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Smart Contracts** | Solidity 0.8.24+ | Industry standard |
| **Contract Framework** | Foundry | Fast, Solidity-native tests, great for L2 |
| **Contract Libraries** | OpenZeppelin 5.x | Audited ERC-721, AccessControl, UUPS, ReentrancyGuard |
| **Chain** | Base (Sepolia testnet → mainnet) | x402 native, lowest cost, best AA UX |
| **Indexer** | The Graph (Subgraph Studio) | Free hosted service, GraphQL, real-time |
| **Frontend** | Next.js 14+ (App Router) | SSR, API routes, React ecosystem |
| **Styling** | Tailwind CSS + shadcn/ui | Fast, professional, accessible |
| **Wallet** | RainbowKit + wagmi + viem | Best React wallet UX, ERC-4337 support |
| **IPFS** | Pinata (free tier → paid) | Reliable pinning, SDK, gateway |
| **Hosting** | Vercel (free tier) | Next.js native, edge functions, global CDN |
| **Admin** | Gnosis Safe (multisig) | Industry standard for protocol admin |
| **Monitoring** | Tenderly | Transaction simulation, alerting, debugging |

---

## Appendix A: Full Standards Landscape

### Core (MVP)
- ERC-8004 — Trustless Agents (Identity + Reputation + Validation)
- x402 — HTTP-native payments
- ERC-4337 — Account Abstraction
- EIP-712 — Typed structured data signing (for reviews)

### Tier 1 (Integrate in MVP where feasible)
- ERC-8122 — Minimal Agent Registry
- ERC-8118 — Agent Authorization
- ERC-8035 — MultiTrust Credential
- ERC-8150 — ZK Agent Payment Verification
- ERC-8126 — Agent Registration & Verification
- ERC-5192 — Soulbound NFTs (agent badges)
- ERC-7710 — Smart Contract Delegation

### Tier 2 (Phase 2)
- ERC-8107 — ENS Trust Registry (web-of-trust)
- ERC-7683 — Cross-chain Intents
- ERC-8027 — Recurring Subscription NFT
- ERC-8102 — Permissioned Pull Payments
- EAS — Ethereum Attestation Service

### Tier 3 (Future)
- ERC-7857 — Private Agent Metadata
- ERC-6900 — Modular Smart Accounts
- ERC-7858 — Expirable SBTs
- ERC-8121 — Cross-chain Hooks

---

*Document maintained by FAIVR Team. Last updated: 2026-02-10*
