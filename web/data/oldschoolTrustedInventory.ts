import { stringifyAgentRegistrationMetadata } from "@/lib/agentMetadata";

export type TrustedOldSchoolAgentPricing = {
  amount?: string;
  billingPeriod?: string;
  mode: string;
  token: string;
};

export type TrustedOldSchoolAgent = {
  pricing?: TrustedOldSchoolAgentPricing;
  name: string;
  description: string;
  targetBuyer: string;
  deliverable: string;
  category: string;
  mcpEndpoint: string;
  a2aEndpoint: string;
  domain: string;
};

export const OLD_SCHOOL_OWNER_ADDRESS = "0x0eA24cf5b9A6d1EE6bc985a63df59b0E5f308227" as const;

export const OLD_SCHOOL_DEFAULT_PRICING: TrustedOldSchoolAgentPricing = {
  mode: "Fixed price",
  amount: "100",
  token: "USDC",
  billingPeriod: "month",
};

export const OLD_SCHOOL_PRICING = OLD_SCHOOL_DEFAULT_PRICING;

export const OLD_SCHOOL_TRUSTED_AGENTS: TrustedOldSchoolAgent[] = [
  {
    name: "Ivy",
    description:
      "Cross-product marketing and communications agent for positioning, launch strategy, messaging, content production, channel execution planning, traffic monitoring, and post-launch iteration.",
    targetBuyer: "Old School founders and operators who need marketing and communications execution support.",
    deliverable: "Positioning brief, launch narrative, content plan, channel execution support, and growth monitoring.",
    category: "Marketing",
    mcpEndpoint: "",
    a2aEndpoint: "openai-marketing",
    domain: "",
  },
  {
    name: "Clara",
    description:
      "KANN product and GTM collaboration agent for positioning, KPI design, launch sequencing, channel planning, and bottleneck resolution.",
    targetBuyer: "KANN operators and product stakeholders who need product and go-to-market execution support.",
    deliverable: "Product brief, KPI framing, launch sequence, channel plan, and bottleneck-resolution support.",
    category: "Product",
    mcpEndpoint: "",
    a2aEndpoint: "openai-kann",
    domain: "https://kann.tech",
  },
  {
    name: "Nora",
    description:
      "SCR product and GTM collaboration agent for positioning, KPI design, launch sequencing, channel planning, and bottleneck resolution.",
    targetBuyer: "SCR and GDER operators who need product and go-to-market execution support.",
    deliverable: "Product brief, KPI framing, launch sequence, channel plan, and bottleneck-resolution support.",
    category: "Product",
    mcpEndpoint: "",
    a2aEndpoint: "openai-scr",
    domain: "https://gder.net",
  },
  {
    name: "Lyra",
    description:
      "FAIVR product and GTM collaboration agent for positioning, KPI design, launch sequencing, channel planning, and bottleneck resolution.",
    targetBuyer: "FAIVR operators and product stakeholders who need product and go-to-market execution support.",
    deliverable: "Product brief, KPI framing, launch sequence, channel plan, and bottleneck-resolution support.",
    category: "Product",
    mcpEndpoint: "",
    a2aEndpoint: "openai-faivr",
    domain: "https://faivr.ai",
  },
  {
    name: "Mara",
    description:
      "Cross-functional go-to-market lead that turns product truth and customer evidence into an executable route to market, coordinating product, marketing, commercial, channel, customer-success, analytics, and implementation specialists through launch and iteration.",
    targetBuyer:
      "Founders and accountable Product Owners who need one evidence-led GTM operating spine across positioning, commercial motion, distribution, launch readiness, and measurement.",
    deliverable:
      "Product-truth contract, market evidence register, ICP and positioning, buyer journey, channel and commercial motion, GTM execution board, launch-readiness gates, KPI contract, and post-launch iteration decisions.",
    category: "Marketing",
    mcpEndpoint: "",
    a2aEndpoint: "openai-gtm",
    domain: "",
    pricing: {
      mode: "Request quote",
      token: "USDC",
      billingPeriod: "engagement",
    },
  },
];

export function buildOldSchoolAgentUri(agent: TrustedOldSchoolAgent): string {
  const pricing = agent.pricing || OLD_SCHOOL_DEFAULT_PRICING;

  return stringifyAgentRegistrationMetadata({
    name: agent.name,
    description: agent.description,
    category: agent.category,
    targetBuyer: agent.targetBuyer,
    deliveryDescription: agent.deliverable,
    mcpEndpoint: agent.mcpEndpoint || undefined,
    a2aEndpoint: agent.a2aEndpoint || undefined,
    domain: agent.domain || undefined,
    ownerAddress: OLD_SCHOOL_OWNER_ADDRESS,
    pricing,
  });
}
