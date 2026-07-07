# FAIVR Smart Contract Architecture

**Version:** 1.0  
**Date:** 2026-02-10  
**Target:** Solidity 0.8.24+ | OpenZeppelin 5.x | UUPS Upgradeable  
**Chain:** Base (L2)

> Status note: this is a historical/target architecture document. Its multisig and timelock statements must not be read as verified live posture. See `docs/protocol-admin-risk.md` for the current production blocker.

---

## 1. Contract Inheritance Diagram

```
                        OpenZeppelin 5.x
                    ┌───────────────────────┐
                    │ ERC721URIStorageUpgr. │
                    │ UUPSUpgradeable       │
                    │ AccessControlUpgr.    │
                    │ ReentrancyGuardUpgr.  │
                    └───────────┬───────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
┌───────▼────────┐   ┌─────────▼─────────┐   ┌─────────▼──────────┐
│ FaivrIdentity  │   │ FaivrReputation   │   │ FaivrValidation    │
│ Registry       │   │ Registry          │   │ Registry           │
│                │   │                   │   │                    │
│ ERC721URI +    │   │ UUPSUpgradeable + │   │ UUPSUpgradeable +  │
│ UUPSUpgr. +   │   │ AccessControl     │   │ AccessControl      │
│ AccessControl  │   │                   │   │                    │
└───────┬────────┘   └─────────┬─────────┘   └─────────┬──────────┘
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │    FaivrFeeModule     │
                    │                      │
                    │ UUPSUpgradeable +    │
                    │ ReentrancyGuard +    │
                    │ AccessControl        │
                    └───────────┬──────────┘
                                │
                    ┌───────────▼───────────┐
                    │     FaivrRouter       │
                    │    (Orchestrator)     │
                    │                      │
                    │ UUPSUpgradeable +    │
                    │ AccessControl        │
                    └──────────────────────┘
```

---

## 2. Interface Definitions

### 2.1 IFaivrIdentityRegistry

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IFaivrIdentityRegistry
/// @notice ERC-8004 compliant agent identity registry
/// @dev Extends ERC-721 with URIStorage for agent metadata
interface IFaivrIdentityRegistry {

    // ─── Events ───────────────────────────────────────────
    
    /// @notice Emitted when a new agent is registered
    event AgentRegistered(
        uint256 indexed agentId,
        address indexed owner,
        string agentURI
    );

    /// @notice Emitted when an agent's metadata URI is updated
    event AgentURIUpdated(
        uint256 indexed agentId,
        string oldURI,
        string newURI
    );

    /// @notice Emitted when an agent is deactivated
    event AgentDeactivated(uint256 indexed agentId);

    /// @notice Emitted when an agent is reactivated
    event AgentReactivated(uint256 indexed agentId);

    // ─── Core Functions ───────────────────────────────────

    /// @notice Register a new agent by minting an identity NFT
    /// @param agentURI IPFS/HTTPS URI to the agent registration file
    /// @return agentId The newly minted agent's token ID
    function registerAgent(string calldata agentURI) external payable returns (uint256 agentId);

    /// @notice Update the metadata URI for an agent
    /// @param agentId The agent's token ID
    /// @param newURI The new metadata URI
    function updateAgentURI(uint256 agentId, string calldata newURI) external;

    /// @notice Deactivate an agent (remains on-chain but marked inactive)
    /// @param agentId The agent's token ID
    function deactivateAgent(uint256 agentId) external;

    /// @notice Reactivate a previously deactivated agent
    /// @param agentId The agent's token ID
    function reactivateAgent(uint256 agentId) external;

    // ─── View Functions ───────────────────────────────────

    /// @notice Check if an agent is currently active
    /// @param agentId The agent's token ID
    /// @return active Whether the agent is active
    function isActive(uint256 agentId) external view returns (bool active);

    /// @notice Get the total number of registered agents
    /// @return count Total agent count
    function agentCount() external view returns (uint256 count);

    /// @notice Get the registration timestamp for an agent
    /// @param agentId The agent's token ID
    /// @return timestamp When the agent was registered
    function registeredAt(uint256 agentId) external view returns (uint256 timestamp);
}
```

### 2.2 IFaivrReputationRegistry

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IFaivrReputationRegistry
/// @notice ERC-8004 compliant reputation registry with EIP-712 signed reviews
interface IFaivrReputationRegistry {

    // ─── Structs ──────────────────────────────────────────

    struct Review {
        address reviewer;
        uint256 agentId;
        uint8 rating;          // 1-5
        string commentURI;     // IPFS URI for detailed comment (optional)
        bytes32 taskReference; // Reference to a task in FeeModule (optional)
        uint256 timestamp;
    }

    struct AgentScore {
        uint256 totalRating;   // Sum of all ratings
        uint256 reviewCount;   // Number of reviews
        uint256 lastUpdated;   // Timestamp of last review
    }

    // ─── Events ───────────────────────────────────────────

    /// @notice Emitted when a review is posted
    event ReviewPosted(
        uint256 indexed reviewId,
        uint256 indexed agentId,
        address indexed reviewer,
        uint8 rating,
        string commentURI,
        bytes32 taskReference
    );

    // ─── Core Functions ───────────────────────────────────

    /// @notice Post a signed review for an agent
    /// @param agentId The agent to review
    /// @param rating Rating from 1-5
    /// @param commentURI IPFS URI for detailed comment
    /// @param taskReference Optional reference to a completed task
    /// @param signature EIP-712 signature from the reviewer
    /// @return reviewId The ID of the posted review
    function postReview(
        uint256 agentId,
        uint8 rating,
        string calldata commentURI,
        bytes32 taskReference,
        bytes calldata signature
    ) external returns (uint256 reviewId);

    // ─── View Functions ───────────────────────────────────

    /// @notice Get the aggregate score for an agent
    /// @param agentId The agent's token ID
    /// @return average Average rating (multiplied by 100 for precision, e.g., 450 = 4.50)
    /// @return count Total number of reviews
    function getAverageRating(uint256 agentId) external view returns (uint256 average, uint256 count);

    /// @notice Get a page of reviews for an agent
    /// @param agentId The agent's token ID
    /// @param offset Starting index
    /// @param limit Max reviews to return
    /// @return reviews Array of Review structs
    function getReviews(
        uint256 agentId,
        uint256 offset,
        uint256 limit
    ) external view returns (Review[] memory reviews);

    /// @notice Get a specific review by ID
    /// @param reviewId The review ID
    /// @return review The Review struct
    function getReview(uint256 reviewId) external view returns (Review memory review);

    /// @notice Get the total number of reviews across all agents
    /// @return count Total review count
    function totalReviews() external view returns (uint256 count);
}
```

### 2.3 IFaivrValidationRegistry

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IFaivrValidationRegistry
/// @notice ERC-8004 compliant validation registry for agent attestations
interface IFaivrValidationRegistry {

    // ─── Enums ────────────────────────────────────────────

    enum ValidationType {
        MANUAL,         // Human review
        RE_EXECUTION,   // Staker re-runs agent task
        ZKML,           // Zero-knowledge ML proof
        TEE             // Trusted execution environment
    }

    enum ValidationStatus {
        PENDING,
        PASSED,
        FAILED,
        EXPIRED
    }

    // ─── Structs ──────────────────────────────────────────

    struct ValidationRequest {
        uint256 agentId;
        address requester;
        ValidationType vType;
        string evidenceURI;     // URI to task data for validation
        ValidationStatus status;
        uint256 requestedAt;
        uint256 resolvedAt;
    }

    struct Attestation {
        uint256 requestId;
        uint256 agentId;
        address validator;
        bool passed;
        string proofURI;        // URI to proof/evidence
        ValidationType vType;
        uint256 timestamp;
    }

    // ─── Events ───────────────────────────────────────────

    /// @notice Emitted when a validation is requested
    event ValidationRequested(
        uint256 indexed requestId,
        uint256 indexed agentId,
        address indexed requester,
        ValidationType vType,
        string evidenceURI
    );

    /// @notice Emitted when an attestation is submitted
    event AttestationSubmitted(
        uint256 indexed attestationId,
        uint256 indexed requestId,
        uint256 indexed agentId,
        address validator,
        bool passed,
        string proofURI
    );

    /// @notice Emitted when a validator is added/removed
    event ValidatorUpdated(address indexed validator, bool active);

    // ─── Core Functions ───────────────────────────────────

    /// @notice Request validation for an agent
    /// @param agentId The agent to validate
    /// @param vType The type of validation requested
    /// @param evidenceURI URI to task data/evidence
    /// @return requestId The ID of the validation request
    function requestValidation(
        uint256 agentId,
        ValidationType vType,
        string calldata evidenceURI
    ) external returns (uint256 requestId);

    /// @notice Submit an attestation for a validation request
    /// @param requestId The validation request ID
    /// @param passed Whether the agent passed validation
    /// @param proofURI URI to the proof/evidence of validation
    /// @return attestationId The ID of the attestation
    function submitAttestation(
        uint256 requestId,
        bool passed,
        string calldata proofURI
    ) external returns (uint256 attestationId);

    /// @notice Add a validator to the whitelist
    /// @param validator Address of the validator
    function addValidator(address validator) external;

    /// @notice Remove a validator from the whitelist
    /// @param validator Address of the validator
    function removeValidator(address validator) external;

    // ─── View Functions ───────────────────────────────────

    /// @notice Check if an address is a whitelisted validator
    function isValidator(address validator) external view returns (bool);

    /// @notice Get attestations for an agent
    function getAttestations(
        uint256 agentId,
        uint256 offset,
        uint256 limit
    ) external view returns (Attestation[] memory);

    /// @notice Get a validation request by ID
    function getRequest(uint256 requestId) external view returns (ValidationRequest memory);

    /// @notice Get validation count by type for an agent
    function getValidationCount(
        uint256 agentId,
        ValidationType vType
    ) external view returns (uint256 passed, uint256 failed);
}
```

### 2.4 IFaivrFeeModule

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IFaivrFeeModule
/// @notice Non-custodial escrow with programmable fee splits
interface IFaivrFeeModule {

    // ─── Enums ────────────────────────────────────────────

    enum TaskStatus {
        FUNDED,
        SETTLED,
        RECLAIMED,
        DISPUTED
    }

    // ─── Structs ──────────────────────────────────────────

    struct Task {
        uint256 agentId;
        address client;
        address token;          // ERC-20 address or address(0) for ETH
        uint256 amount;
        TaskStatus status;
        uint256 fundedAt;
        uint256 settledAt;
        uint256 deadline;       // Timestamp after which client can reclaim
    }

    // ─── Events ───────────────────────────────────────────

    /// @notice Emitted when a task is funded
    event TaskFunded(
        uint256 indexed taskId,
        uint256 indexed agentId,
        address indexed client,
        address token,
        uint256 amount,
        uint256 deadline
    );

    /// @notice Emitted when a task is settled (agent paid)
    event TaskSettled(
        uint256 indexed taskId,
        uint256 indexed agentId,
        address agent,
        uint256 agentPayout,
        uint256 protocolFee,
        uint256 devFee
    );

    /// @notice Emitted when a task is reclaimed by client
    event TaskReclaimed(
        uint256 indexed taskId,
        address indexed client,
        uint256 amount
    );

    /// @notice Emitted when fee percentage is updated
    event FeeUpdated(uint256 oldFee, uint256 newFee, uint256 effectiveAt);

    // ─── Core Functions ───────────────────────────────────

    /// @notice Fund a task (deposit into escrow)
    /// @param agentId The agent's token ID
    /// @param token ERC-20 token address (address(0) for ETH)
    /// @param amount Amount to deposit
    /// @param deadline Seconds until client can reclaim
    /// @return taskId The ID of the funded task
    function fundTask(
        uint256 agentId,
        address token,
        uint256 amount,
        uint256 deadline
    ) external payable returns (uint256 taskId);

    /// @notice Settle a task — releases funds to agent, deducts fees
    /// @param taskId The task to settle
    /// @dev Can be called by client (confirm) or agent (after validation)
    function settleTask(uint256 taskId) external;

    /// @notice Reclaim funds from an expired task
    /// @param taskId The task to reclaim
    /// @dev Only callable by client after deadline
    function reclaimTask(uint256 taskId) external;

    // ─── Admin Functions ──────────────────────────────────

    /// @notice Set the protocol fee percentage (basis points, max 1000 = 10%)
    /// @param feeBps New fee in basis points (e.g., 250 = 2.5%)
    function setFeePercentage(uint256 feeBps) external;

    /// @notice Update the protocol wallet (Old School GmbH)
    function setProtocolWallet(address wallet) external;

    /// @notice Update the dev fund wallet
    function setDevWallet(address wallet) external;

    // ─── View Functions ───────────────────────────────────

    /// @notice Get task details
    function getTask(uint256 taskId) external view returns (Task memory);

    /// @notice Get current fee percentage in basis points
    function feePercentage() external view returns (uint256);

    /// @notice Get protocol wallet address
    function protocolWallet() external view returns (address);

    /// @notice Get dev wallet address
    function devWallet() external view returns (address);

    /// @notice Total fees collected (per token)
    function totalFeesAccrued(address token) external view returns (uint256);
}
```

### 2.5 IFaivrRouter

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IFaivrRouter
/// @notice Orchestrator for common multi-contract flows
interface IFaivrRouter {

    /// @notice Register an agent and fund their first task in one tx
    /// @param agentURI Agent metadata URI
    /// @param token Payment token
    /// @param amount Task funding amount
    /// @param deadline Task deadline
    /// @return agentId The minted agent ID
    /// @return taskId The funded task ID
    function registerAndFund(
        string calldata agentURI,
        address token,
        uint256 amount,
        uint256 deadline
    ) external payable returns (uint256 agentId, uint256 taskId);

    /// @notice Settle a task and post a review in one tx
    /// @param taskId The task to settle
    /// @param agentId The agent to review
    /// @param rating Review rating (1-5)
    /// @param commentURI Review comment URI
    /// @param signature EIP-712 review signature
    /// @return reviewId The posted review ID
    function settleAndReview(
        uint256 taskId,
        uint256 agentId,
        uint8 rating,
        string calldata commentURI,
        bytes calldata signature
    ) external returns (uint256 reviewId);

    /// @notice Get all contract addresses
    function getContracts() external view returns (
        address identityRegistry,
        address reputationRegistry,
        address validationRegistry,
        address feeModule
    );
}
```

---

## 3. Key Data Structures

### 3.1 Storage Mappings

```solidity
// ── Identity Registry ──
mapping(uint256 agentId => bool active) private _agentActive;
mapping(uint256 agentId => uint256 timestamp) private _registeredAt;
uint256 private _nextAgentId;  // auto-increment counter

// ── Reputation Registry ──
mapping(uint256 agentId => AgentScore) private _scores;
mapping(uint256 agentId => uint256[]) private _agentReviewIds;
mapping(uint256 reviewId => Review) private _reviews;
mapping(address reviewer => mapping(uint256 agentId => bool)) private _hasReviewed;
    // Optional: per-task review tracking
uint256 private _nextReviewId;

// ── Validation Registry ──
mapping(uint256 requestId => ValidationRequest) private _requests;
mapping(uint256 agentId => uint256[]) private _agentAttestationIds;
mapping(uint256 attestationId => Attestation) private _attestations;
mapping(address => bool) private _validators;
uint256 private _nextRequestId;
uint256 private _nextAttestationId;

// ── Fee Module ──
mapping(uint256 taskId => Task) private _tasks;
mapping(address token => uint256) private _totalFees;
uint256 private _feeBps;        // basis points (250 = 2.5%)
address private _protocolWallet; // Old School GmbH (90%)
address private _devWallet;      // Dev fund (10%)
uint256 private _nextTaskId;
```

### 3.2 EIP-712 Domain & Types (Reputation)

```solidity
// Domain separator
bytes32 constant DOMAIN_TYPEHASH = keccak256(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
);

// Review type
bytes32 constant REVIEW_TYPEHASH = keccak256(
    "Review(uint256 agentId,uint8 rating,string commentURI,bytes32 taskReference,uint256 nonce)"
);
```

---

## 4. Access Control Model

```
ROLES:
├── DEFAULT_ADMIN_ROLE     → Old School GmbH multisig
│   ├── Can grant/revoke all roles
│   ├── Can upgrade contracts (UUPS)
│   ├── Can adjust fees (with timelock)
│   └── Can pause/unpause
│
├── VALIDATOR_MANAGER_ROLE → Admin (initially = DEFAULT_ADMIN)
│   ├── Can add/remove validators
│   └── Can update validator policies
│
├── VALIDATOR_ROLE         → Whitelisted validator addresses
│   └── Can submit attestations
│
├── FEE_MANAGER_ROLE       → Admin (initially = DEFAULT_ADMIN)
│   ├── Can update fee percentage
│   └── Can update wallet addresses
│
└── PAUSER_ROLE            → Admin + emergency contacts
    └── Can pause FeeModule in emergencies
```

**Principle of least privilege:** Each role has minimal permissions. Admin roles can be separated across different addresses for operational security.

---

## 5. Upgrade Strategy (UUPS)

### Pattern
All core contracts use OpenZeppelin's `UUPSUpgradeable`:

```solidity
function _authorizeUpgrade(address newImplementation) 
    internal 
    override 
    onlyRole(DEFAULT_ADMIN_ROLE) 
{}
```

### Deployment
Each contract is deployed behind an `ERC1967Proxy`:
```
ERC1967Proxy → Implementation V1
           ↓ (upgrade)
ERC1967Proxy → Implementation V2
```

### Safety
- **Timelock**: Upgrades go through a 48-hour timelock (OpenZeppelin TimelockController)
- **Storage gaps**: Each contract includes `uint256[50] private __gap;` for future storage slots
- **Initializer**: `initialize()` replaces constructor, called once via proxy

### Upgrade Sequence
1. Deploy new implementation
2. Submit upgrade proposal to timelock
3. Wait 48 hours
4. Execute upgrade
5. Verify storage compatibility

---

## 6. Gas Optimization Notes (L2)

### L2-Specific Optimizations
- **Calldata is the bottleneck on L2** (not execution). Minimize function parameter sizes.
- Use `bytes32` for task references instead of `string`
- Pack structs to minimize storage slots:
  ```solidity
  // Pack rating (uint8) + status (uint8) + timestamp (uint48) into one slot
  struct PackedReview {
      address reviewer;       // slot 0 (20 bytes)
      uint8 rating;           // slot 0 (1 byte)  — packed
      uint48 timestamp;       // slot 0 (6 bytes) — packed
      uint256 agentId;        // slot 1
      bytes32 commentHash;    // slot 2
      bytes32 taskReference;  // slot 3
  }
  ```
- Use events for data that doesn't need on-chain reads (indexer picks them up)
- Batch operations where possible (Router contract)

### General Optimizations
- Use `custom errors` instead of `require` strings
- Use `immutable` for addresses set at deployment
- Minimize SSTORE operations (most expensive opcode)
- Use `unchecked` for safe arithmetic (counter increments)

### Estimated Gas Costs (Base L2)
| Operation | Gas (est.) | USD (est.) |
|-----------|-----------|------------|
| Register agent (mint NFT) | ~150k | ~$0.03 |
| Post review | ~80k | ~$0.02 |
| Fund task | ~100k | ~$0.02 |
| Settle task | ~120k | ~$0.03 |
| Submit attestation | ~90k | ~$0.02 |

---

## 7. Deployment Sequence

### Step 1: Deploy Implementations
```bash
forge script script/Deploy.s.sol --rpc-url base --broadcast
```

Order:
1. `FaivrIdentityRegistry` (implementation)
2. `FaivrReputationRegistry` (implementation)
3. `FaivrValidationRegistry` (implementation)
4. `FaivrFeeModule` (implementation)
5. `FaivrRouter` (implementation)

### Step 2: Deploy Proxies
For each contract:
1. Deploy `ERC1967Proxy` pointing to implementation
2. Call `initialize()` on the proxy

### Step 3: Configure
1. Set cross-contract references (Router knows all addresses)
2. Set fee percentage (250 bps = 2.5%)
3. Set protocol wallet (Old School GmbH Gnosis Safe)
4. Set dev wallet (Dev fund Gnosis Safe)
5. Add initial validators to whitelist
6. Transfer DEFAULT_ADMIN_ROLE to TimelockController

### Step 4: Verify
1. Verify all contracts on Basescan
2. Run integration tests against live deployment
3. Register a test agent
4. Fund + settle a test task

---

## 8. Integration Points

### 8.1 ERC-8004 Compatibility
The `FaivrIdentityRegistry` is a **direct implementation** of ERC-8004's Identity Registry:
- Mints ERC-721 tokens with `tokenURI` (= `agentURI`) pointing to the registration file
- Registration file follows the ERC-8004 JSON schema (type, name, description, image, services, etc.)
- `agentRegistry` identifier: `eip155:{chainId}:{FaivrIdentityRegistry address}`

### 8.2 x402 Integration
- Agent registration files include `"x402Support": true/false`
- Agent endpoints can require x402 payments (HTTP 402 → pay → get result)
- x402 payment outcomes feed into the Reputation Registry as trust signals
- FeeModule supports USDC on Base — native to x402/Coinbase ecosystem

### 8.3 ERC-4337 (Account Abstraction)
- Agents can be smart contract accounts (not just EOAs)
- FeeModule accepts calls from ERC-4337 `EntryPoint` via UserOperations
- Enables gas sponsorship (paymasters can pay agent gas fees)
- Coinbase Smart Wallet integration for seamless client UX

### 8.4 ERC-8035 (MultiTrust) — Phase 2
- Aggregate trust signals from Reputation + Validation registries
- Expose a `getTrustScore(agentId)` function combining:
  - Average review rating
  - Validation attestation count + tier
  - Task completion rate
  - x402 payment success rate

### 8.5 ERC-5192 (Soulbound) — Phase 2
- Issue non-transferable badge tokens for validated agents
- Badge types: "Manually Verified", "Re-Execution Verified", "zkML Verified", "TEE Attested"
- Badges bound to the agent's Identity NFT (ERC-5114 style)

### 8.6 ERC-7710 (Delegation) — Phase 2
- Users can delegate specific DeFi actions to agents
- Scoped permissions: "can rebalance portfolio, max 1000 USDC per tx"
- Delegation revocable at any time

---

## Appendix: Foundry Project Structure

```
contracts/
├── foundry.toml
├── src/
│   ├── interfaces/
│   │   ├── IFaivrIdentityRegistry.sol
│   │   ├── IFaivrReputationRegistry.sol
│   │   ├── IFaivrValidationRegistry.sol
│   │   ├── IFaivrFeeModule.sol
│   │   └── IFaivrRouter.sol
│   ├── FaivrIdentityRegistry.sol
│   ├── FaivrReputationRegistry.sol
│   ├── FaivrValidationRegistry.sol
│   ├── FaivrFeeModule.sol
│   └── FaivrRouter.sol
├── test/
│   ├── FaivrIdentityRegistry.t.sol
│   ├── FaivrReputationRegistry.t.sol
│   ├── FaivrValidationRegistry.t.sol
│   ├── FaivrFeeModule.t.sol
│   ├── FaivrRouter.t.sol
│   └── Integration.t.sol
├── script/
│   ├── Deploy.s.sol
│   └── Configure.s.sol
└── lib/
    └── (OpenZeppelin via forge install)
```

---

*Document maintained by FAIVR Team. Last updated: 2026-02-10*
