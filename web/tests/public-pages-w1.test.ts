import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { comingSoonFunctions } from "@/data/catalog-coming-soon";

const catalog=vi.hoisted(()=>({functions:[] as unknown[]}));
vi.mock("@/lib/publicCatalog",()=>({
  getPublicCatalog:async()=>catalog.functions,
  getPublicCatalogState:async()=>({functions:catalog.functions,unavailable:false}),
}));
vi.mock("@/components/layout/SiteShell",()=>({SiteShell:({children}:{children:ReactNode})=>children}));

import FunctionPage from "@/app/catalog/[function]/page";
import AgentPage from "@/app/agents/[agent]/page";
import CatalogPage from "@/app/catalog/page";
import DocsPage from "@/app/docs/page";
import ImprintPage from "@/app/imprint/page";
import PrivacyPage from "@/app/privacy/page";
import HomePage from "@/app/page";
import HowItWorksPage from "@/app/how-it-works/page";
import TrustPage from "@/app/trust/page";
import TermsPage from "@/app/terms/page";
import RiskDisclosurePage from "@/app/risk-disclosure/page";
import sitemap from "@/app/sitemap";
import { Footer } from "@/components/layout/Footer";

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
    for(const agent of item.agents){
      it(`${agent} has no fabricated package facts`,async()=>{
        const html=renderToStaticMarkup(await AgentPage({params:Promise.resolve({agent:slugify(agent)})}));
        assertPlanned(html);
        expect(html).toContain("mailto:info@oldschool.ag");
        expect(html).toContain("Tell me when it is ready");
      });
    }
  }
  it("unknown slugs return not found",async()=>{
    await expect(FunctionPage({params:Promise.resolve({function:"not-a-function"})})).rejects.toThrow();
    await expect(AgentPage({params:Promise.resolve({agent:"not-an-agent"})})).rejects.toThrow();
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
  it("links to user docs and support",()=>{
    const html=renderToStaticMarkup(DocsPage());
    for(const href of ["https://docs.truchsess.com","/how-it-works","/trust","https://github.com/oldschool-ag/Faivr","mailto:support@truchsess.com"])expect(html).toContain(`href="${href}"`);
    expect(html).toContain("How to set up the box, add people, install agents and use them.");
    expect(html).toContain("Publishing on FAIVR: coming later");
    expect(html).not.toMatch(forbidden);
    const howItWorks=renderToStaticMarkup(HowItWorksPage());
    expect(howItWorks).toContain('href="https://www.truchsess.com"');
    expect(howItWorks).toContain("Already have a Truchsess?");
    const footer=renderToStaticMarkup(Footer());
    expect(footer).toContain('href="https://docs.truchsess.com"');
    expect(footer).toContain('href="mailto:support@truchsess.com"');
  });
});

describe("F2 slot permission presentation",()=>{
  it("shows the install question without exposing the raw placeholder",async()=>{
    catalog.functions=[{slug:"fixture",name:"Fixture",description:"",workers:[{id:"faivr.agent.fixture",slug:"fixture-agent",name:"Fixture agent",role:"",version:"1.0.0",publisherName:"Old School GmbH",publisherKeyId:"key",digest:"sha256:test",permissions:["repo.read:{code-repository}"],slots:[{id:"code-repository",question:"Which repository holds the product's code and documents?",kind:"repository",required:false}]}]}];
    const html=renderToStaticMarkup(await AgentPage({params:Promise.resolve({agent:"fixture-agent"})}));
    expect(html).toContain("Read one repository you choose at install: Which repository holds the product&#x27;s code and documents? (optional)");
    expect(html).not.toContain("{code-repository}");
    catalog.functions=[];
  });
});

describe("W2 public catalog presentation",()=>{
  it("maps every verified published package to its planned function",()=>{
    const ids=comingSoonFunctions.flatMap((item)=>item.becomes);
    expect(ids).toEqual(expect.arrayContaining(["faivr.agent.ai-visibility","faivr.agent.build-ci-fixer","faivr.agent.build-instructions-keeper","faivr.agent.build-issue-writer","faivr.agent.build-merge-gate","faivr.agent.build-qa-reviewer","faivr.agent.build-security-reviewer","faivr.agent.challenger","faivr.agent.ivo-design","faivr.agent.ivo-design-v2","faivr.agent.marketing-planner","faivr.agent.pricing-models","faivr.agent.product-owner","faivr.agent.website-owner"]));
    expect(ids).toHaveLength(14);
  });

  it("shows the published Gideon function as available and removes its coming-soon card",async()=>{
    catalog.functions=[{slug:"published-ai-search",name:"Published bundle name",description:"Published bundle description",monthlyPriceCents:7900,currency:"chf",workers:[{id:"faivr.agent.ai-visibility",slug:"ai-visibility",name:"Gideon",role:"",version:"1.0.0",publisherName:"Old School GmbH",publisherKeyId:"key",digest:"sha256:test",permissions:[],slots:[]}]}];
    const html=renderToStaticMarkup(await CatalogPage());
    expect(html).toContain("CHF 79.00");
    expect(html).toContain("Early access: talk to us to get a Truchsess");
    expect(html).toContain('href="/agents/ai-visibility"');
    expect(html).not.toMatch(/COMING SOON[\s\S]*Visibility in AI search/);
    const home=renderToStaticMarkup(await HomePage());
    expect(home).toContain("Visibility in AI search");
    expect(home).toContain("Early access: talk to us to get a Truchsess.");
    const legacyGideon=renderToStaticMarkup(await AgentPage({params:Promise.resolve({agent:"gideon"})}));
    expect(legacyGideon).toContain("Gideon");
    expect(legacyGideon).not.toMatch(/COMING SOON/);
    const entries=await sitemap();
    expect(entries.map((entry)=>entry.url)).toContain("https://faivr.ai/catalog/visibility-in-ai-search");
    expect(entries.map((entry)=>entry.url)).not.toContain("https://faivr.ai/catalog/published-ai-search");
    catalog.functions=[];
  });

  it("redirects retired public legal routes to trust",()=>{
    expect(()=>TermsPage()).toThrow();
    expect(()=>RiskDisclosurePage()).toThrow();
  });

  it("uses agent language on public pages",async()=>{
    catalog.functions=[];
    const pages=[
      renderToStaticMarkup(await HomePage()),
      renderToStaticMarkup(await CatalogPage()),
      renderToStaticMarkup(HowItWorksPage()),
      renderToStaticMarkup(await TrustPage()),
      renderToStaticMarkup(DocsPage()),
    ];
    for(const html of pages)expect(html).not.toMatch(/\bworkers?\b/i);
    catalog.functions=[{slug:"fixture",name:"Fixture",description:"",monthlyPriceCents:0,currency:"chf",workers:[{id:"faivr.agent.fixture",slug:"fixture-agent",name:"Fixture agent",role:"",version:"1.0.0",publisherName:"Old School GmbH",publisherKeyId:"key",digest:"sha256:test",permissions:[],slots:[]}]}];
    const agentHtml=renderToStaticMarkup(await AgentPage({params:Promise.resolve({agent:"fixture-agent"})}));
    expect(agentHtml).toContain("sees other agents");
    expect(agentHtml).not.toMatch(/\bworkers?\b/i);
    catalog.functions=[];
  });
});
