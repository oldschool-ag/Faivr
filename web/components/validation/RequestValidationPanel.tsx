"use client";

import { useMemo, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { type Address, isAddress } from "viem";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CONTRACTS, VALIDATION_ABI } from "@/lib/contracts";

const VALIDATION_TAGS = ["MANUAL", "RE_EXECUTION", "ZKML", "TEE"] as const;

async function sha256Hex(input: string): Promise<`0x${string}` | null> {
  if (typeof window === "undefined" || !window.crypto?.subtle) return null;
  const bytes = new TextEncoder().encode(input);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}` as `0x${string}`;
}

export function RequestValidationPanel({ agentId, agentName }: { agentId: number; agentName: string }) {
  const [validatorAddress, setValidatorAddress] = useState("");
  const [evidenceUri, setEvidenceUri] = useState("");
  const [tag, setTag] = useState<(typeof VALIDATION_TAGS)[number]>("MANUAL");
  const [error, setError] = useState<string | null>(null);
  const { writeContract, data: hash, isPending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const requestPayload = useMemo(
    () => ({
      agentId,
      agentName,
      tag,
      evidenceUri: evidenceUri.trim(),
      requestedAt: new Date().toISOString(),
    }),
    [agentId, agentName, evidenceUri, tag],
  );

  async function handleSubmit() {
    if (!isAddress(validatorAddress)) {
      setError("Enter a valid validator address.");
      return;
    }

    if (!evidenceUri.trim()) {
      setError("Add a public evidence URI or request brief.");
      return;
    }

    setError(null);
    const requestHash = await sha256Hex(JSON.stringify(requestPayload));
    if (!requestHash) {
      setError("Could not compute a request hash in this browser.");
      return;
    }

    writeContract({
      address: CONTRACTS.validation,
      abi: VALIDATION_ABI,
      functionName: "validationRequest",
      args: [validatorAddress as Address, BigInt(agentId), JSON.stringify(requestPayload), requestHash],
    });
  }

  return (
    <Card padding="lg" className="bg-white/92">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-2.5 text-emerald-700">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Validation request</p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Ask a validator to inspect this agent.</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            This creates an on-chain validation request for a specific validator address. Use it when you want visible review
            provenance before trusting a listing with real work.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm text-slate-700">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Validation type</span>
          <select
            value={tag}
            onChange={(event) => setTag(event.target.value as (typeof VALIDATION_TAGS)[number])}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-sky-300 focus:bg-white"
          >
            {VALIDATION_TAGS.map((option) => (
              <option key={option} value={option}>
                {option.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm text-slate-700">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Validator address</span>
          <input
            type="text"
            value={validatorAddress}
            onChange={(event) => setValidatorAddress(event.target.value)}
            placeholder="0x..."
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-sky-300 focus:bg-white"
          />
        </label>
      </div>

      <label className="mt-4 block space-y-2 text-sm text-slate-700">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Evidence URI or brief</span>
        <textarea
          rows={4}
          value={evidenceUri}
          onChange={(event) => setEvidenceUri(event.target.value)}
          placeholder="Link the spec, repo, endpoint, or delivery brief the validator should inspect."
          className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-sky-300 focus:bg-white"
        />
      </label>

      <div className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
        FAIVR validation is a visible trust layer, not a guarantee. A validation request is most useful when you provide a
        concrete task scope or evidence URI instead of a generic “please review this agent.”
      </div>

      {(error || writeError) && (
        <p className="mt-4 text-sm text-red-700">{error || writeError?.message?.slice(0, 220) || "Validation request failed."}</p>
      )}

      {isSuccess && (
        <p className="mt-4 text-sm text-emerald-700">
          Validation request submitted. The transaction can now serve as a public provenance anchor for this inspection ask.
        </p>
      )}

      <Button className="mt-5 w-full" variant="accent" onClick={() => void handleSubmit()} disabled={isPending || isConfirming}>
        {isPending || isConfirming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {isPending ? "Confirm in wallet…" : isConfirming ? "Submitting request…" : "Request validation"}
      </Button>
    </Card>
  );
}
