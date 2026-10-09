"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const links = [["Home","/"],["Catalog","/catalog"],["How it works","/how-it-works"],["Trust","/trust"],["Docs","/docs"]] as const;

export function Navbar() {
  const pathname = usePathname() ?? "/";
  return <header className="border-b border-[var(--line)] bg-white">
    <div className="mx-auto flex max-w-[1220px] flex-wrap items-center justify-between gap-x-4 gap-y-4 px-4 py-4 sm:px-8">
      <Link href="/" aria-label="FAIVR home" className="flex min-h-11 items-center">
        <Image src="/brand/faivr-logo.svg" alt="FAIVR" width={112} height={40} priority className="h-10 w-auto" />
      </Link>
      <nav aria-label="Main navigation" className="order-3 flex w-full flex-wrap justify-center gap-1 lg:order-none lg:w-auto">
        {links.map(([name,href]) => {
          const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href+"/") || (href === "/catalog" && pathname.startsWith("/agents/"));
          return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-full px-4 py-2 text-sm font-semibold ${active ? "bg-[var(--ink)] text-white" : "hover:bg-[var(--page)]"}`}>{name}</Link>;
        })}
      </nav>
      <a href="https://www.truchsess.com" className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white">Get Truchsess</a>
    </div>
  </header>;
}
