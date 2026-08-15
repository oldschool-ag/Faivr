"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, ShieldCheck, Wallet } from "lucide-react";
import { base } from "wagmi/chains";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  buildOldSchoolAgentUri,
  OLD_SCHOOL_OWNER_ADDRESS,
  OLD_SCHOOL_DEFAULT_PRICING,
  OLD_SCHOOL_TRUSTED_AGENTS,
} from "@/data/oldschoolTrustedInventory";
import { CHAIN_ID, CONTRACTS, IDENTITY_ABI } from "@/lib/contracts";

const REGISTERED_TOPIC = "0x17d0c8d1e73832c5e10eee72c3cf7f4e3591d29590a498a370a85e377f71790e";

type AgentStatus = "idle" | "awaiting_signature" | "confirming" | "confirmed" | "failed";

type AgentProgress = {
  agentId?: number;
  error?: string;
  status: AgentStatus;
  txHash?: string;
};

function formatError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Transaction failed or was rejected.";
}

function parseRegisteredAgentId(receipt: { logs: Array<{ topics: readonly string[] }> }): number | undefined {
  for (const log of receipt.logs) {
    if (log.topics[0] !== REGISTERED_TOPIC) continue;
    const rawId = log.topics[1];
    if (!rawId) continue;
    const parsed = parseInt(rawId, 16);
    if (parsed > 0) return parsed;
  }

  return undefined;
}

export function OldSchoolRegistrationFlow() {
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const { address, chain, isConnected } = useAccount();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [progress, setProgress] = useState<AgentProgress[]>(
    OLD_SCHOOL_TRUSTED_AGENTS.map(() => ({ status: "idle" as AgentStatus }))
  );
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const connectedOwnerMatches = address?.toLowerCase() === OLD_SCHOOL_OWNER_ADDRESS.toLowerCase();
  const onBase = chain?.id === base.id;

  const completedCount = useMemo(
    () => progress.filter((item) => item.status === "confirmed").length,
    [progress]
  );

  const canRegister = isConnected && connectedOwnerMatches && onBase && !isRunning && Boolean(publicClient);

  const setAgentProgress = (index: number, patch: Partial<AgentProgress>) => {
    setProgress((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    );
  };

  const handleRegisterAll = async () => {
    if (!canRegister || !publicClient) return;

    setBatchError(null);
    setIsRunning(true);

    for (let index = 0; index < OLD_SCHOOL_TRUSTED_AGENTS.length; index++) {
      const agent = OLD_SCHOOL_TRUSTED_AGENTS[index];
      setActiveIndex(index);
      setAgentProgress(index, { status: "awaiting_signature", error: undefined, txHash: undefined, agentId: undefined });

      try {
        const txHash = await writeContractAsync({
          address: CONTRACTS.identity,
          abi: IDENTITY_ABI,
          functionName: "register",
          args: [buildOldSchoolAgentUri(agent)],
          chainId: CHAIN_ID,
        });

        setAgentProgress(index, { status: "confirming", txHash });

        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        const agentId = parseRegisteredAgentId(receipt);

        setAgentProgress(index, { status: "confirmed", txHash, agentId });
      } catch (error) {
        const message = formatError(error);
        setAgentProgress(index, { status: "failed", error: message });
        setBatchError(`Stopped on ${agent.name}: ${message}`);
        setActiveIndex(null);
        setIsRunning(false);
        return;
      }
    }

    setActiveIndex(null);
    setIsRunning(false);
  };

  return (
    <div className="space-y-6">
      <Card padding="lg" className="border-sky-100 bg-sky-50/80">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">Trusted Old School batch</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950">
              Register the trusted four directly from the owner wallet.
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              This flow uses the connected browser wallet to call `Identity.register(agentURI)` once per trusted agent.
              No registrar role is needed. Each transaction will ask for signature and mint the identity NFT directly to
              <span className="ml-1 font-mono text-slate-900">{OLD_SCHOOL_OWNER_ADDRESS}</span>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ConnectButton />
            <Button
              variant="secondary"
              onClick={() => window.open("https://basescan.org/address/" + CONTRACTS.identity, "_blank")}
            >
              Registry
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card padding="lg" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Registration queue</p>
              <p className="mt-2 text-sm text-slate-600">
                {completedCount} of {OLD_SCHOOL_TRUSTED_AGENTS.length} trusted agents registered in this session.
              </p>
            </div>
            <Button onClick={handleRegisterAll} disabled={!canRegister} loading={isRunning}>
              {isRunning ? "Processing…" : "Register trusted agents"}
            </Button>
          </div>

          <div className="space-y-3">
            {OLD_SCHOOL_TRUSTED_AGENTS.map((agent, index) => {
              const item = progress[index];
              const isActive = activeIndex === index;
              const pricing = agent.pricing || OLD_SCHOOL_DEFAULT_PRICING;
              const pricingLabel =
                pricing.mode.toLowerCase().includes("fixed") && pricing.amount
                  ? `${pricing.amount} ${pricing.token} / ${pricing.billingPeriod || "period"}`
                  : `${pricing.mode}${pricing.billingPeriod ? ` · ${pricing.billingPeriod}` : ""}`;

              return (
                <div
                  key={agent.name}
                  className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-base font-semibold text-slate-950">{agent.name}</p>
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                          trusted
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{agent.description}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1">{agent.category}</span>
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1">{pricingLabel}</span>
                        {agent.a2aEndpoint && (
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                            {agent.a2aEndpoint}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0">
                      <span
                        className={
                          item.status === "confirmed"
                            ? "rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700"
                            : item.status === "failed"
                              ? "rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700"
                              : item.status === "confirming"
                                ? "rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700"
                                : item.status === "awaiting_signature"
                                  ? "rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700"
                                  : "rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
                        }
                      >
                        {item.status === "idle" ? "Not started" : item.status.replace("_", " ")}
                      </span>
                    </div>
                  </div>

                  {(isActive || item.status === "confirmed" || item.status === "failed") && (
                    <div className="mt-4 rounded-[20px] border border-white bg-white px-4 py-3 text-sm text-slate-600">
                      {item.status === "awaiting_signature" && (
                        <div className="flex items-center gap-2 text-sky-700">
                          <Wallet className="h-4 w-4" />
                          Confirm the transaction in your wallet for {agent.name}.
                        </div>
                      )}
                      {item.status === "confirming" && (
                        <div className="flex items-center gap-2 text-amber-700">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Waiting for Base confirmation.
                        </div>
                      )}
                      {item.status === "confirmed" && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-emerald-700">
                            <CheckCircle2 className="h-4 w-4" />
                            Registered successfully{item.agentId ? ` as agent #${item.agentId}` : "."}
                          </div>
                          {item.txHash && (
                            <button
                              className="inline-flex items-center gap-2 text-sm font-medium text-sky-700 hover:text-sky-900"
                              onClick={() => window.open(`https://basescan.org/tx/${item.txHash}`, "_blank")}
                            >
                              View transaction
                              <ExternalLink className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      )}
                      {item.status === "failed" && (
                        <div className="flex items-start gap-2 text-rose-700">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{item.error || "Registration failed."}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4">
          <Card padding="lg">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Wallet checks</p>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="font-semibold text-slate-950">Expected owner</p>
                <p className="mt-1 font-mono text-xs text-slate-600">{OLD_SCHOOL_OWNER_ADDRESS}</p>
              </div>

              <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="font-semibold text-slate-950">Connected wallet</p>
                <p className="mt-1 font-mono text-xs text-slate-600">{address || "Not connected"}</p>
              </div>

              {!isConnected && (
                <div className="rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-4 text-amber-800">
                  Connect the owner wallet before starting the batch.
                </div>
              )}

              {isConnected && !connectedOwnerMatches && (
                <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-4 text-rose-800">
                  The connected wallet does not match the intended owner address. Switch to
                  <span className="ml-1 font-mono">{OLD_SCHOOL_OWNER_ADDRESS}</span>.
                </div>
              )}

              {isConnected && connectedOwnerMatches && !onBase && (
                <div className="rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-4 text-amber-800">
                  <p>Switch the wallet network to Base mainnet before registering.</p>
                  <Button
                    className="mt-3"
                    variant="secondary"
                    onClick={() => switchChain({ chainId: CHAIN_ID })}
                    disabled={isSwitching}
                  >
                    {isSwitching ? "Switching…" : "Switch to Base"}
                  </Button>
                </div>
              )}

              {isConnected && connectedOwnerMatches && onBase && (
                <div className="rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-4 text-emerald-800">
                  Wallet and network checks passed. The browser flow can mint directly from the owner wallet.
                </div>
              )}
            </div>
          </Card>

          <Card padding="lg" className="bg-slate-950 text-white">
            <div className="flex items-center gap-2 text-indigo-200">
              <ShieldCheck className="h-4 w-4" />
              Least-privilege path
            </div>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              This route avoids `REGISTRAR_ROLE` entirely. It simply uses the owner wallet to register each trusted
              agent with the identity registry, one transaction at a time.
            </p>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              If a signature is rejected or a transaction fails, the flow stops immediately so you do not mint the rest
              accidentally.
            </p>
            {batchError && (
              <div className="mt-4 rounded-[20px] border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {batchError}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
