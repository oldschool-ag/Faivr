import Link from "next/link";
import { SiteShell } from "@/components/layout/SiteShell";

export default function NotFound() {
  return <SiteShell><div className="mx-auto max-w-[1220px] px-4 py-20 sm:px-8"><p className="text-sm font-bold tracking-[.14em] text-[var(--accent)]">404</p><h1 className="mt-3 text-5xl font-extrabold">This page is not here.</h1><p className="mt-4 max-w-xl text-[var(--body)]">Browse the FAIVR catalog of governed AI agents instead.</p><Link className="mt-8 inline-flex min-h-11 items-center rounded-full bg-[var(--ink)] px-5 font-bold text-white" href="/catalog">Browse the catalog</Link></div></SiteShell>;
}
