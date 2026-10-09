import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/layout/SiteShell";

export const metadata: Metadata = {
  title: "Docs | FAIVR",
  description: "How the Truchsess store works, its trust rules, and its open-source code.",
  openGraph: { title: "Docs | FAIVR", description: "The FAIVR store documentation." },
};

export default function DocsPage() {
  const linkStyle = "flex min-h-11 items-center rounded-3xl border border-[var(--line)] bg-white p-6 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]";
  return (
    <SiteShell>
      <div className="mx-auto max-w-[1220px] px-4 py-14 sm:px-8">
        <h1 className="text-5xl font-extrabold">Docs</h1>
        <nav aria-label="Documentation" className="mt-8 grid gap-4 md:grid-cols-2">
          <a className={linkStyle} href="https://docs.truchsess.com"><span>User documentation for Truchsess</span><span className="ml-2 text-sm font-normal text-[var(--body)]">How to set up the box, add people, install agents and use them.</span></a>
          <Link className={linkStyle} href="/how-it-works">How it works</Link>
          <Link className={linkStyle} href="/trust">Trust</Link>
          <a className={linkStyle} href="https://github.com/oldschool-ag/Faivr">Store code on GitHub</a>
        </nav>
        <p className="mt-6 text-[var(--body)]">Support: <a className="inline-flex min-h-11 items-center font-bold underline" href="mailto:support@truchsess.com">support@truchsess.com</a></p>
        <p className="mt-10 text-[var(--body)]">Publishing on FAIVR: coming later</p>
      </div>
    </SiteShell>
  );
}
