import type { ReactNode } from "react";
import { MarketplaceNav } from "@/components/marketplace/MarketplaceNav";

export function MarketplaceLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-[var(--brand-paper)] text-[var(--brand-ink)]"><MarketplaceNav /><main>{children}</main></div>;
}
