import { zeroAddress, type Address } from "viem";
import { USDC_ADDRESS, USDC_DECIMALS } from "@/lib/contracts";

export type TokenConfig = {
  symbol: string;
  address: Address;
  decimals: number;
  primary?: boolean;
};

export const TOKENS = {
  USDC: {
    symbol: "USDC",
    address: USDC_ADDRESS,
    decimals: USDC_DECIMALS,
    primary: true,
  },
  ETH: {
    symbol: "ETH",
    address: zeroAddress,
    decimals: 18,
  },
} satisfies Record<string, TokenConfig>;

export function getTokenConfig(address: Address): TokenConfig {
  const lower = address.toLowerCase();

  if (lower === TOKENS.USDC.address.toLowerCase()) return TOKENS.USDC;
  if (lower === TOKENS.ETH.address.toLowerCase()) return TOKENS.ETH;

  return {
    symbol: "TOKEN",
    address,
    decimals: 18,
  };
}
