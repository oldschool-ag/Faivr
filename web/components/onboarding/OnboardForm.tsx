"use client";

import { useState } from "react";
import { CheckCircle, Loader2, Plus, Wallet, Zap } from "lucide-react";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CONTRACTS, IDENTITY_ABI } from "@/lib/contracts";
import { stringifyAgentRegistrationMetadata } from "@/lib/agentMetadata";
import { TOKENS } from "@/lib/tokens";

const CATEGORIES = ["DeFi", "Security", "Data", "Trading", "Marketing", "Other"];
const REGISTERED_EVENT_TOPIC = "0x17d0c8d1e73832c5e10eee72c3cf7f4e3591d29590a498a370a85e377f71790e";

function extractRegisteredAgentId(receipt?: { logs: readonly { topics: readonly string[] }[] }): number | null {
  const registrationLog = receipt?.logs.find((log) => log.topics[0] === REGISTERED_EVENT_TOPIC);
  const id = Number.parseInt(registrationLog?.topics[1] ?? "0", 16);
  return id > 0 ? id : null;
}
const PRICING_MODES = ["Fixed price", "Request quote"] as const;

export function OnboardForm() {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("DeFi");
  const [description, setDescription] = useState("");
  const [targetBuyer, setTargetBuyer] = useState("");
  const [deliveryDescription, setDeliveryDescription] = useState("");
  const [pricingMode, setPricingMode] = useState<(typeof PRICING_MODES)[number]>("Fixed price");
  const [fixedPriceAmount, setFixedPriceAmount] = useState("100");
  const [billingPeriod, setBillingPeriod] = useState("month");
  const [mcpEndpoint, setMcpEndpoint] = useState("");
  const [a2aEndpoint, setA2aEndpoint] = useState("");
  const [domain, setDomain] = useState("");
  const { isConnected } = useAccount();
  const { writeContract, data: txHash, isPending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash: txHash });
  const isFixedPrice = pricingMode === "Fixed price";

  const isValid =
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    deliveryDescription.trim().length > 0 &&
    billingPeriod.trim().length > 0 &&
    (!isFixedPrice || fixedPriceAmount.trim().length > 0);
  const minting = isPending || isConfirming;
  const agentId = isSuccess ? extractRegisteredAgentId(receipt) : null;

  const handleMint = () => {
    if (!isValid || !isConnected) return;

    const agentURI = stringifyAgentRegistrationMetadata({
      name: name.trim(),
      description: description.trim(),
      category,
      targetBuyer: targetBuyer.trim() || undefined,
      deliveryDescription: deliveryDescription.trim(),
      mcpEndpoint: mcpEndpoint.trim() || undefined,
      a2aEndpoint: a2aEndpoint.trim() || undefined,
      domain: domain.trim() || undefined,
      pricing: {
        mode: pricingMode,
        token: TOKENS.USDC.symbol,
        amount: isFixedPrice ? fixedPriceAmount.trim() || undefined : undefined,
        billingPeriod: billingPeriod.trim(),
      },
    });

    writeContract({
      address: CONTRACTS.identity,
      abi: IDENTITY_ABI,
      functionName: "register",
      args: [agentURI],
    });
  };

  if (isSuccess) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card padding="lg" className="space-y-4 text-center">
          <div className="flex justify-center">
            <CheckCircle className="h-16 w-16 text-emerald-500" />
          </div>
          <h2 className="text-2xl font-bold text-slate-950">Agent registered</h2>
          <p className="text-slate-600">
            Your agent <span className="font-semibold text-slate-950">{name}</span> is now minted on Base.
            {agentId && (
              <span className="mt-1 block font-mono font-semibold text-emerald-700">Agent ID: #{agentId}</span>
            )}
          </p>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left text-sm text-slate-600">
            <p className="font-semibold text-slate-950">Recommended next steps</p>
            <ul className="mt-2 space-y-1">
              <li>• Verify the domain or operator surface behind the agent</li>
              <li>• Keep payment expectations aligned to USDC on Base</li>
              <li>• Only publish endpoints that are ready for public use</li>
            </ul>
          </div>
          <div className="flex flex-col justify-center gap-3 pt-2 sm:flex-row">
            <Button
              variant="secondary"
              onClick={() => window.open(`https://basescan.org/tx/${txHash}`, "_blank")}
            >
              View on Basescan
            </Button>
            <Button
              onClick={() => {
                reset();
                setName("");
                setDescription("");
                setTargetBuyer("");
                setDeliveryDescription("");
                setPricingMode("Fixed price");
                setFixedPriceAmount("100");
                setBillingPeriod("month");
                setMcpEndpoint("");
                setA2aEndpoint("");
                setDomain("");
              }}
            >
              Register another
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      {!isConnected && (
        <div className="mb-6 flex items-center gap-3 rounded-[24px] border border-amber-200 bg-amber-50 p-4">
          <Wallet className="h-5 w-5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">Connect your wallet to mint an identity NFT for your agent.</p>
        </div>
      )}

      <Card padding="lg" className="space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">About your agent</p>
          <p className="mt-1 text-sm text-slate-500">Start with the service itself, not the endpoint wiring.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="agent-name" className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              Agent name
            </label>
            <input
              id="agent-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. YieldGuard"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-sky-300 focus:bg-white focus:outline-none"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="agent-category" className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              Category
            </label>
            <select
              id="agent-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 transition-colors focus:border-sky-300 focus:bg-white focus:outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="agent-description" className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            Service description
          </label>
          <textarea
            id="agent-description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does your agent do, and who is it for?"
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-sky-300 focus:bg-white focus:outline-none"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="target-buyer" className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            Target buyer
          </label>
          <input
            id="target-buyer"
            type="text"
            value={targetBuyer}
            onChange={(e) => setTargetBuyer(e.target.value)}
            placeholder="Who is this for?"
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-sky-300 focus:bg-white focus:outline-none"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="delivery-description" className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            What the buyer receives
          </label>
          <textarea
            id="delivery-description"
            rows={3}
            value={deliveryDescription}
            onChange={(e) => setDeliveryDescription(e.target.value)}
            placeholder="Describe deliverables, response expectations, and how work is handed back."
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-sky-300 focus:bg-white focus:outline-none"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="pricing-mode" className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              Pricing mode
            </label>
            <select
              id="pricing-mode"
              value={pricingMode}
              onChange={(e) => setPricingMode(e.target.value as (typeof PRICING_MODES)[number])}
              className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 transition-colors focus:border-sky-300 focus:bg-white focus:outline-none"
            >
              {PRICING_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </div>
          {isFixedPrice ? (
            <div className="space-y-2">
              <label htmlFor="fixed-price-amount" className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                Price
              </label>
              <div className="flex items-center rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <input
                  id="fixed-price-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={fixedPriceAmount}
                  onChange={(e) => setFixedPriceAmount(e.target.value)}
                  className="w-full bg-transparent text-sm font-medium text-emerald-800 outline-none"
                />
                <span className="text-sm font-semibold text-emerald-700">USDC</span>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Buyers will request a scoped quote before work starts.
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Primary payment rail</label>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
              {TOKENS.USDC.symbol} on Base
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="billing-period" className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              {isFixedPrice ? "Billing period" : "Quote basis"}
            </label>
            <input
              id="billing-period"
              type="text"
              value={billingPeriod}
              onChange={(e) => setBillingPeriod(e.target.value)}
              placeholder={isFixedPrice ? "month" : "matter"}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-sky-300 focus:bg-white focus:outline-none"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="agent-domain" className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              Domain
            </label>
            <input
              id="agent-domain"
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="agent.oldschool.so"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-sky-300 focus:bg-white focus:outline-none"
            />
          </div>
        </div>

        <div className="border-t border-slate-200 pt-6">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Technical access</p>
            <p className="mt-1 text-sm text-slate-500">Optional. Add these only if the service already supports programmatic access.</p>
          </div>

          <div className="space-y-3 rounded-[24px] border border-emerald-200 bg-emerald-50 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                <span className="text-sm font-semibold text-slate-950">MCP endpoint</span>
              </div>
              <span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight text-emerald-700">
                Optional
              </span>
            </div>
            <input
              type="url"
              value={mcpEndpoint}
              onChange={(e) => setMcpEndpoint(e.target.value)}
              placeholder="https://mcp.your-agent.com/v1"
              aria-label="MCP endpoint URL"
              className="w-full rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-emerald-300 focus:outline-none"
            />
          </div>

          <div className="mt-4 space-y-2">
            <label htmlFor="a2a-endpoint" className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              A2A endpoint <span className="normal-case text-slate-400">(optional)</span>
            </label>
            <input
              id="a2a-endpoint"
              type="text"
              value={a2aEndpoint}
              onChange={(e) => setA2aEndpoint(e.target.value)}
              placeholder="openai-your-agent or https://a2a.your-agent.com/v1"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-sky-300 focus:bg-white focus:outline-none"
            />
            <p className="text-xs leading-5 text-slate-500">
              Use an OpenClaw agent id for operator-routed installs, or an HTTPS endpoint for a public A2A surface.
            </p>
          </div>
        </div>

        {writeError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">
              {writeError.message.includes("User rejected") ? "Transaction rejected." : "Transaction failed. Please try again."}
            </p>
          </div>
        )}

        {isConfirming && (
          <div className="flex items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 p-3">
            <Loader2 className="h-4 w-4 animate-spin text-sky-600" />
            <p className="text-sm text-sky-700">Confirming transaction…</p>
          </div>
        )}

        <Button
          size="lg"
          className="group w-full rounded-2xl py-4 text-base font-semibold"
          disabled={!isValid || !isConnected}
          loading={minting}
          onClick={handleMint}
          aria-label="Mint Identity NFT"
        >
          <Plus className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" aria-hidden="true" />
          {!isConnected ? "Connect wallet to mint" : "Mint identity NFT"}
        </Button>
      </Card>
    </div>
  );
}
