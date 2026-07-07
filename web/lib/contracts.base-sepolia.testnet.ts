import { type Address } from "viem";

// Testnet-only reference data. Do not import this file from production runtime code.
export const BASE_SEPOLIA_CHAIN_ID = 84532;

export const BASE_SEPOLIA_CONTRACTS = {
  identity: "0x2c954A4E93DdA93b09C679c4DAc6e04758b8f490" as Address,
  reputation: "0x1Eb4a1283EdEA00d42BaA66B785729808CE90A72" as Address,
  validation: "0x442E20eb5e801daD5F5fe603825d8fa780F5cd0e" as Address,
  feeModule: "0x0b9FAb32d2b7B33C767D111F96750D07B030ad60" as Address,
  router: "0x24b9cA9Db5476B2ca397e05924004Eae25D30184" as Address,
};
