import type { Address } from "viem";
import { CONTRACTS } from "@/lib/contracts";
import { BASESCAN_NFT_ROOT, BASESCAN_ROOT, BASESCAN_TX_ROOT } from "@/lib/site";

export function addressUrl(address: Address): string {
  return `${BASESCAN_ROOT}/${address}`;
}

export function txUrl(hash: string): string {
  return `${BASESCAN_TX_ROOT}/${hash}`;
}

export function agentNftUrl(agentId: number | bigint): string {
  return `${BASESCAN_NFT_ROOT}/${CONTRACTS.identity}/${agentId.toString()}`;
}
