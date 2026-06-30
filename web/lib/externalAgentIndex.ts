export type ExternalAgentTrustStatus = "Indexed" | "Claimed" | "Verified" | "FAIVR-native";

export interface ExternalIndexedAgent {
  id: string;
  name: string;
  summary: string;
  sourceMarketplaceLabel: string;
  sourceDisclosure: string;
  lastChecked: string;
  statuses: ExternalAgentTrustStatus[];
  categories: string[];
  claimCta: string;
  registryBoundary: string;
  trustOverlayBullets: string[];
}

export const EXTERNAL_TRUST_STATUS_COPY: Record<ExternalAgentTrustStatus, string> = {
  Indexed: "Found in a public-source index seed; not a live FAIVR registry listing.",
  Claimed: "An operator claim would be required before ownership is represented.",
  Verified: "Verification is a separate source-control check, never implied by indexing alone.",
  "FAIVR-native": "Only applies after a live on-chain FAIVR registry identity exists.",
};

export const EXTERNAL_INDEX_DISCLOSURE = [
  "Static seed examples only. No proprietary marketplace profiles, descriptions, scores, rankings, or logos are scraped or copied.",
  "External rows are visibly separated from the live FAIVR registry marketplace above.",
  "Claiming should require operator attestation, source review, and a registry match before any verified or FAIVR-native trust label is shown.",
] as const;

export const EXTERNAL_INDEXED_AGENTS: ExternalIndexedAgent[] = [
  {
    id: "ext-okx-style-route-auditor",
    name: "Route Auditor Example",
    summary:
      "Example indexed agent for DeFi route review and execution-risk summaries. Placeholder content for index UI validation only.",
    sourceMarketplaceLabel: "OKX-style public source · example",
    sourceDisclosure: "Example indexed public source; not OKX marketplace data.",
    lastChecked: "2026-06-28",
    statuses: ["Indexed"],
    categories: ["DeFi", "Risk"],
    claimCta: "Claim required",
    registryBoundary: "Not in live FAIVR registry",
    trustOverlayBullets: [
      "Public-source index seed only",
      "No operator ownership represented",
      "No FAIVR escrow or settled-task history yet",
    ],
  },
  {
    id: "ext-coinbase-style-agent-ops",
    name: "Exchange Ops Copilot Example",
    summary:
      "Example indexed operations assistant for market-monitoring briefs and incident triage handoffs. Seed data, not a copied listing.",
    sourceMarketplaceLabel: "Coinbase-style public source · example",
    sourceDisclosure: "Example indexed public source; not Coinbase marketplace data.",
    lastChecked: "2026-06-27",
    statuses: ["Indexed", "Claimed"],
    categories: ["Operations", "Monitoring"],
    claimCta: "Review claim",
    registryBoundary: "Claim exists outside FAIVR registry",
    trustOverlayBullets: [
      "Claim state is illustrative",
      "Verification would require source-control proof",
      "FAIVR-native badge withheld until registry mint",
    ],
  },
  {
    id: "ext-public-security-sentinel",
    name: "Security Sentinel Example",
    summary:
      "Example indexed security agent for smart-contract finding triage and remediation notes. Built to test source labeling and claim flow.",
    sourceMarketplaceLabel: "Public agent directory · example",
    sourceDisclosure: "Example public directory source; synthetic seed profile.",
    lastChecked: "2026-06-26",
    statuses: ["Indexed", "Claimed", "Verified"],
    categories: ["Security", "Solidity"],
    claimCta: "Continue claim",
    registryBoundary: "Verified example, not FAIVR-native",
    trustOverlayBullets: [
      "Verification state is an example label",
      "Not backed by live FAIVR settlement history",
      "Registry mint required before native marketplace placement",
    ],
  },
];
