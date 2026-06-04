import { type Address } from "viem";

// Base Mainnet
export const CHAIN_ID = 8453;
export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
export const USDC_DECIMALS = 6;

export const CONTRACTS = {
  identity: "0x8D97B74fA9bFa67Db1A8Cf315dA91390612B90F6" as Address,
  reputation: "0x00280bc9cFF156a8E8E9aE7c54029B74902a829c" as Address,
  validation: "0x95DF02B02e2D777E0fcB80F83c061500C112F05b" as Address,
  feeModule: "0xD68D402Bb450A79D8e639e41F0455990A223E47F" as Address,
  router: "0x7EC51888ecd3E47c6F4cF324474041790C8aB7fa" as Address,
  verification: "0x6654FA7d6eE8A0f6641a5535AeE346115f06e161" as Address,
};

// Sepolia testnet addresses (kept for reference)
export const CONTRACTS_SEPOLIA = {
  identity: "0x2c954A4E93DdA93b09C679c4DAc6e04758b8f490" as Address,
  reputation: "0x1Eb4a1283EdEA00d42BaA66B785729808CE90A72" as Address,
  validation: "0x442E20eb5e801daD5F5fe603825d8fa780F5cd0e" as Address,
  feeModule: "0x0b9FAb32d2b7B33C767D111F96750D07B030ad60" as Address,
  router: "0x24b9cA9Db5476B2ca397e05924004Eae25D30184" as Address,
};

export const IDENTITY_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    name: "setAgentURI",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "newURI", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "deactivateAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "reactivateAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "agentCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "count", type: "uint256" }],
  },
  {
    name: "isActive",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "active", type: "bool" }],
  },
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "registeredAt",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "timestamp", type: "uint256" }],
  },
  {
    name: "Registered",
    type: "event",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;

export const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const FEE_MODULE_ABI = [
  {
    name: "fundTask",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "taskId", type: "uint256" }],
  },
  {
    name: "settleTask",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "reclaimTask",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "getTask",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "agentId", type: "uint256" },
          { name: "client", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "fundedAt", type: "uint256" },
          { name: "settledAt", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "feePercentage",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalFeesAccrued",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "isSupportedToken",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "maxEscrowAmount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "TaskFunded",
    type: "event",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "deadline", type: "uint256", indexed: false },
    ],
  },
] as const;

export const GENESIS_ABI = [
  {
    name: "isGenesisAgent",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "genesisAgentCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "genesisTasksUsed",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export const REPUTATION_ABI = [
  {
    name: "giveFeedback",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "getSummary",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddresses", type: "address[]" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
    ],
    outputs: [
      { name: "count", type: "uint64" },
      { name: "summaryValue", type: "int128" },
      { name: "summaryValueDecimals", type: "uint8" },
    ],
  },
] as const;

export const VERIFICATION_ABI = [
  {
    name: "verify",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "domain", type: "string" },
      { name: "method", type: "uint8" },
    ],
    outputs: [],
  },
  {
    name: "revoke",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "isVerified",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getVerification",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "domain", type: "string" },
          { name: "method", type: "uint8" },
          { name: "verifiedAt", type: "uint256" },
          { name: "expiresAt", type: "uint256" },
          { name: "verified", type: "bool" },
          { name: "tokenId", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "expiryPeriod",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "setExpiryPeriod",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "newPeriod", type: "uint256" }],
    outputs: [],
  },
] as const;
