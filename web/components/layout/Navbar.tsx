"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { NetworkBadge } from "@/components/wallet/NetworkBadge";
import { ProductLockup } from "@/components/layout/ProductLockup";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Marketplace", href: "/marketplace" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Onboard Agent", href: "/onboard-agent" },
  { label: "Audit", href: "/audit" },
  { label: "Docs", href: "/docs" },
  { label: "About", href: "/about" },
] as const;

export function Navbar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <nav
      className="sticky top-0 z-50 border-b-2 border-[var(--brand-ink)] bg-[var(--brand-paper)]"
      aria-label="Main navigation"
    >
      <div className="border-b-2 border-[var(--brand-ink)] bg-[var(--brand-ink)] px-6 py-2 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--brand-paper)]">
        Escrowed in USDC on Base · Released on delivery
      </div>
      <div className="mx-auto flex min-h-[72px] max-w-7xl items-center justify-between px-6">
        <Link
          href="/"
          className="relative z-10 flex items-center py-3 pr-4 -my-3 -mr-2"
          aria-label="FAIVR home"
        >
          <ProductLockup product="FAIVR" accentClass="bg-[var(--faivr-accent)]" compact />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.label}
                href={link.href}
                className={cn(
                  "border border-transparent px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] transition-colors",
                  active
                    ? "border-[var(--brand-ink)] bg-[var(--brand-ink)] text-[var(--brand-paper)]"
                    : "text-[var(--brand-ink)] hover:border-[var(--brand-ink)]"
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <NetworkBadge />
          <ConnectButton />
          <button
            className="ml-1 flex h-10 w-10 items-center justify-center border-2 border-[var(--brand-ink)] text-[var(--brand-ink)] md:hidden"
            onClick={() => setOpen(!open)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <div
        className={cn(
          "overflow-hidden border-t-2 border-[var(--brand-ink)] md:hidden transition-all duration-200",
          open ? "max-h-96" : "max-h-0"
        )}
      >
        <div className="space-y-1 px-6 py-3">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.label}
                href={link.href}
                className={cn(
                    "block border border-transparent px-4 py-3 text-sm font-bold transition-colors",
                  active
                    ? "border-[var(--brand-ink)] bg-[var(--brand-ink)] text-[var(--brand-paper)]"
                    : "text-[var(--brand-ink)] hover:border-[var(--brand-ink)]"
                )}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
