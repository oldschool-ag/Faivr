import { OperatorQuoteQueue } from "@/components/escrow/OperatorQuoteQueue";
import { SiteShell } from "@/components/layout/SiteShell";

export default function OperatorQuoteRequestsPage() {
  return (
    <SiteShell>
      <div className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Internal operator surface</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-5xl">
            Recover quote requests and answer them cleanly.
          </h1>
          <p className="mt-4 text-lg leading-8 text-slate-600">
            Buyers can already submit structured quote requests from the marketplace. This page finishes the other half:
            queue review, status progression, and sending the quote response back into the buyer-visible request record.
          </p>
        </div>

        <div className="pt-10">
          <OperatorQuoteQueue />
        </div>
      </div>
    </SiteShell>
  );
}
