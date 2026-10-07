import Link from "next/link";
import Image from "next/image";
const links = [["Catalog","/catalog"],["Trust","/trust"],["Docs","/docs"],["GitHub","https://github.com/oldschool-ag/Faivr"],["Imprint","/imprint"],["Privacy","/privacy"]] as const;

export function Footer() {
  return <footer className="mt-auto bg-[var(--ink)] text-[var(--dark-text)]">
    <div className="mx-auto grid max-w-[1220px] gap-8 px-4 py-12 sm:px-8 lg:grid-cols-2">
      <div><Image src="/brand/faivr-logo.svg" alt="FAIVR" width={112} height={40} className="h-10 w-auto" /><p className="mt-3 max-w-md text-sm leading-6 text-[#C3C5DA]">The store for Truchsess. A product of Old School GmbH, Canton Zug, Switzerland.</p></div>
      <nav aria-label="Footer navigation" className="flex flex-wrap content-start items-start gap-x-5 gap-y-2 text-sm">
        {links.map(([label,href]) => <Link key={href} href={href} className="inline-flex min-h-11 min-w-11 items-center px-1">{label}</Link>)}
      </nav>
    </div>
  </footer>;
}
