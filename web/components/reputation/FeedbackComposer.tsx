"use client";

import { useState } from "react";
import { Loader2, Star } from "lucide-react";
import { type Hash, zeroHash } from "viem";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CONTRACTS, REPUTATION_ABI } from "@/lib/contracts";

const FEEDBACK_TAGS = ["quality", "speed", "trust", "communication"] as const;

async function feedbackHash(value: string): Promise<Hash> {
  if (typeof window === "undefined" || !window.crypto?.subtle) return zeroHash;
  const bytes = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}` as Hash;
}

export function FeedbackComposer({ agentId, agentName }: { agentId: number; agentName: string }) {
  const [rating, setRating] = useState(4);
  const [tag1, setTag1] = useState<(typeof FEEDBACK_TAGS)[number]>("quality");
  const [tag2, setTag2] = useState<(typeof FEEDBACK_TAGS)[number]>("trust");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { writeContract, data: hash, isPending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  async function submitFeedback() {
    if (comment.trim().length < 16) {
      setError("Write a specific review, not just a score.");
      return;
    }

    setError(null);
    const payload = JSON.stringify({
      version: 1,
      agentId,
      agentName,
      rating,
      tag1,
      tag2,
      comment: comment.trim(),
      createdAt: new Date().toISOString(),
    });
    const hashValue = await feedbackHash(payload);

    writeContract({
      address: CONTRACTS.reputation,
      abi: REPUTATION_ABI,
      functionName: "giveFeedback",
      args: [BigInt(agentId), BigInt(rating * 10), 1, tag1, tag2, "faivr.ai", payload, hashValue],
    });
  }

  return (
    <Card padding="lg" className="bg-white/92">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--faivr-accent)]">Settled-task feedback</p>
      <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Anchor a review to real delivery.</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Reputation is strongest when it resolves back to completed work. This records structured feedback for {agentName}
        on-chain rather than leaving a detached testimonial.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setRating(value)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm ${
              rating === value
                ? "border-amber-300 bg-amber-50 text-amber-800"
                : "border-slate-200 bg-slate-50 text-slate-500"
            }`}
          >
            <Star className={`h-4 w-4 ${rating >= value ? "fill-current" : ""}`} />
            {value}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm text-slate-700">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Primary tag</span>
          <select
            value={tag1}
            onChange={(event) => setTag1(event.target.value as (typeof FEEDBACK_TAGS)[number])}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-sky-300 focus:bg-white"
          >
            {FEEDBACK_TAGS.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm text-slate-700">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Secondary tag</span>
          <select
            value={tag2}
            onChange={(event) => setTag2(event.target.value as (typeof FEEDBACK_TAGS)[number])}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-sky-300 focus:bg-white"
          >
            {FEEDBACK_TAGS.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-4 block space-y-2 text-sm text-slate-700">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Outcome note</span>
        <textarea
          rows={4}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="What was delivered, how strong was it, and what should the next buyer know?"
          className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-sky-300 focus:bg-white"
        />
      </label>

      {(error || writeError) && (
        <p className="mt-4 text-sm text-red-700">{error || writeError?.message?.slice(0, 220) || "Feedback failed."}</p>
      )}

      {isSuccess && (
        <p className="mt-4 text-sm text-emerald-700">
          Feedback submitted. This now contributes to FAIVR’s settled-task-backed trust surface.
        </p>
      )}

      <Button className="mt-5 w-full" variant="accent" onClick={() => void submitFeedback()} disabled={isPending || isConfirming}>
        {isPending || isConfirming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {isPending ? "Confirm in wallet…" : isConfirming ? "Recording feedback…" : "Record on-chain feedback"}
      </Button>
    </Card>
  );
}
