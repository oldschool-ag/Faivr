import { describe, expect, it } from "vitest";
import { CONTRACTS } from "@/lib/contracts";
import { parseAgentMetadata } from "@/lib/agentMetadata";

/**
 * TEMPORARY (F1): one read of the live identity registry on Base from CI, printing every
 * agent id with its name, so the on-chain id of the ClaraHacks listing can be read off the
 * CI log. Read-only eth_call requests; no transaction, no key. Removed before the PR is final.
 */

const RPC = "https://mainnet.base.org";
const AGENT_COUNT = "0xb7dc1284"; // keccak("agentCount()")[:4]
const TOKEN_URI = "0xc87b56dd"; // keccak("tokenURI(uint256)")[:4]

async function call(data: string): Promise<string> {
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: CONTRACTS.identity, data }, "latest"] }) });
  const body = (await response.json()) as { result?: string; error?: unknown };
  if (typeof body.result !== "string") throw new Error(`eth_call failed: ${JSON.stringify(body.error ?? body)}`);
  return body.result;
}

function decodeString(hex: string): string {
  const bytes = Buffer.from(hex.slice(2), "hex");
  const offset = Number(BigInt("0x" + bytes.subarray(0, 32).toString("hex")));
  const length = Number(BigInt("0x" + bytes.subarray(offset, offset + 32).toString("hex")));
  return bytes.subarray(offset + 32, offset + 32 + length).toString("utf8");
}

describe("registry snapshot (temporary)", () => {
  it("prints every registry entry", async () => {
    const count = Number(BigInt(await call(AGENT_COUNT)));
    const lines: string[] = [`agentCount=${count}`];
    for (let id = 1; id <= count; id += 1) {
      const uri = decodeString(await call(TOKEN_URI + id.toString(16).padStart(64, "0")));
      const parsed = parseAgentMetadata(uri);
      lines.push(`REGISTRY id=${id} name=${JSON.stringify(parsed?.name ?? uri.slice(0, 80))} description=${JSON.stringify((parsed?.description ?? "").slice(0, 100))}`);
    }
    console.log(lines.join("\n"));
    expect(count).toBeGreaterThan(0);
  }, 120_000);
});
