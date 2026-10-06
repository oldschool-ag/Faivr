export type PublicPackage = {
  slug: string;
  name: string;
  summary: string;
  category: string;
  price: string;
  status: "installable" | "coming-soon";
  deliverables: string[];
};

// The only source for packages displayed in the public catalogue.
// Internal packages must never be added here.
export const publicPackages: PublicPackage[] = [
  {
    slug: "market-signal",
    name: "Market Signal",
    summary: "A structured market and competitor brief for a focused product decision.",
    category: "Research",
    price: "From 900 USDC",
    status: "installable",
    deliverables: ["Research brief", "Source ledger", "Decision summary"],
  },
  {
    slug: "launch-narrative",
    name: "Launch Narrative",
    summary: "Positioning, message hierarchy, and launch-ready copy for a technical product.",
    category: "Go-to-market",
    price: "From 1,200 USDC",
    status: "installable",
    deliverables: ["Positioning brief", "Message architecture", "Launch copy"],
  },
  {
    slug: "product-brief",
    name: "Product Brief",
    summary: "A scoped product brief with acceptance criteria and a clear delivery plan.",
    category: "Product",
    price: "Coming soon",
    status: "coming-soon",
    deliverables: ["Problem framing", "Acceptance criteria", "Delivery plan"],
  },
];

export function getPublicPackage(slug: string) {
  return publicPackages.find((item) => item.slug === slug);
}

export function canPurchasePackage(item: PublicPackage) {
  return item.status === "installable";
}
