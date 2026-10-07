import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { comingSoonFunctions } from "@/data/catalog-coming-soon";

const catalog=vi.hoisted(()=>({functions:[] as unknown[]}));
vi.mock("@/lib/publicCatalog",()=>({
  getPublicCatalog:async()=>catalog.functions,
  getPublicCatalogState:async()=>({functions:[],unavailable:true}),
}));
vi.mock("@/components/layout/SiteShell",()=>({SiteShell:({children}:{children:ReactNode})=>children}));

import FunctionPage from "@/app/catalog/[function]/page";
import WorkerPage from "@/app/workers/[worker]/page";
import DocsPage from "@/app/docs/page";
import ImprintPage from "@/app/imprint/page";
import PrivacyPage from "@/app/privacy/page";

const slugify=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
const forbidden=/\b(?:USDC|Clara|Shopify|Codex)\b|Connect Wallet|Old School AG|Bob the Builder|escrow/i;
const assertPlanned=(html:string)=>{
  expect(html).toMatch(/coming soon/i);
  expect(html).not.toMatch(/PROOF OF ORIGIN\s*·\s*SIGNED|sha256:[a-f0-9]{64}|Version:\s*\d|\b(?:CHF|USD|USDC)\s*\d|\b\d+\.\d+\.\d+\b/i);
  expect(html).not.toMatch(/<(?:a|button)[^>]*>\s*(?:Subscribe|Buy|Install now)/i);
  expect(html).not.toMatch(forbidden);
};

describe("W1 coming-soon public surfaces",()=>{
  for(const item of comingSoonFunctions){
    it(`${item.slug} has no purchase/proof facts`,async()=>{
      assertPlanned(renderToStaticMarkup(await FunctionPage({params:Promise.resolve({function:item.slug})})));
    });
    for(const worker of item.workers){
      it(`${worker} has no fabricated package facts`,async()=>{
        const html=renderToStaticMarkup(await WorkerPage({params:Promise.resolve({worker:slugify(worker)})}));
        assertPlanned(html);
        expect(html).toContain("mailto:info@oldschool.ag");
        expect(html).toContain("Tell me when it is ready");
      });
    }
  }
  it("unknown slugs return not found",async()=>{
    await expect(FunctionPage({params:Promise.resolve({function:"not-a-function"})})).rejects.toThrow();
    await expect(WorkerPage({params:Promise.resolve({worker:"not-a-worker"})})).rejects.toThrow();
  });
});

describe("W1 supporting pages",()=>{
  it("shows the supplied legal contact details",()=>{
    const html=renderToStaticMarkup(ImprintPage());
    for(const text of ["Old School GmbH","Maegeristrasse 2","6318 Walchwil","Switzerland","UID CHE-485.065.843","info@oldschool.ag"])expect(html).toContain(text);
    expect(html).not.toContain("xxx");
    expect(html).not.toMatch(forbidden);
  });
  it("states the approved privacy notice and links to the trust explanation",()=>{
    const html=renderToStaticMarkup(PrivacyPage());
    expect(html).toContain("Vercel Inc. (USA)");
    expect(html).toContain("sets no cookies and uses no analytics or tracking");
    expect(html).toContain("Maegeristrasse 2, 6318 Walchwil, Switzerland");
    expect(html).not.toContain("DRAFT, TO BE REVIEWED");
    expect(html).toContain('href="/trust"');
    expect(html).not.toMatch(forbidden);
  });
  it("replaces old marketplace documentation with the three specified links",()=>{
    const html=renderToStaticMarkup(DocsPage());
    for(const href of ["/how-it-works","/trust","https://github.com/oldschool-ag/Faivr"])expect(html).toContain(`href="${href}"`);
    expect(html).toContain("Publishing on FAIVR: coming later");
    expect(html).not.toMatch(forbidden);
  });
});

describe("F2 slot permission presentation",()=>{
  it("shows the install question without exposing the raw placeholder",async()=>{
    catalog.functions=[{slug:"fixture",name:"Fixture",description:"",workers:[{id:"faivr.agent.fixture",slug:"fixture-worker",name:"Fixture worker",role:"",version:"1.0.0",publisherName:"Old School GmbH",publisherKeyId:"key",digest:"sha256:test",permissions:["repo.read:{code-repository}"],slots:[{id:"code-repository",question:"Which repository holds the product's code and documents?",kind:"repository",required:false}]}]}];
    const html=renderToStaticMarkup(await WorkerPage({params:Promise.resolve({worker:"fixture-worker"})}));
    expect(html).toContain("Read one repository you choose at install: Which repository holds the product&#x27;s code and documents? (optional)");
    expect(html).not.toContain("{code-repository}");
    catalog.functions=[];
  });
});
