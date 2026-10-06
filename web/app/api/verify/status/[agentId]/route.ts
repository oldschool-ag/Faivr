import { NextRequest, NextResponse } from "next/server";
import { isHiddenAgentId } from "@/lib/hiddenAgents";

// In production: read from the smart contract
// For now: return a placeholder response

export async function GET(_req: NextRequest, props: { params: Promise<{ agentId: string }> }) {
  const params = await props.params;
  const { agentId } = params;

  if (!agentId) {
    return NextResponse.json({ error: "Missing agentId" }, { status: 400 });
  }

  // F1: a hidden registry entry does not exist for the site's API either
  if (isHiddenAgentId(Number(agentId))) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // In production, this would call:
  // const isVerified = await verificationContract.read.isVerified([BigInt(agentId)]);
  // const verification = await verificationContract.read.getVerification([BigInt(agentId)]);

  return NextResponse.json({
    agentId,
    verified: false,
    domain: null,
    method: null,
    verifiedAt: null,
    expiresAt: null,
    message: "Connect to on-chain contract for live status. This is a placeholder.",
  });
}
