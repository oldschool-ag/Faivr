export type ComingSoonFunction = {
  slug: string;
  name: string;
  agents: string[];
  summary: string;
  becomes: string[];
};

export const comingSoonFunctions: ComingSoonFunction[] = [
  {
    slug: "design-review",
    name: "Design review",
    agents: ["Ivo"],
    summary: "Reviews your web pages and product screens and writes a design brief with screenshots.",
    becomes: ["faivr.agent.ivo-design", "faivr.agent.ivo-design-v2"],
  },
  {
    slug: "product-ownership",
    name: "Product ownership",
    agents: ["Product Owner"],
    summary: "Owns one product: decisions, priorities, routing work to other agents and checking their results. One install per product.",
    becomes: ["faivr.agent.product-owner"],
  },
  {
    slug: "website-care",
    name: "Website care",
    agents: ["Website Owner"],
    summary: "Keeps one website up to date through pull requests that a person approves. One install per website.",
    becomes: ["faivr.agent.website-owner"],
  },
  {
    slug: "software-delivery",
    name: "Software delivery: Bob",
    agents: ["Bob - Issue Writer", "Bob - Instructions Keeper", "Bob - QA Reviewer", "Bob - Security Reviewer", "Bob - CI Fixer", "Bob - Merge Gate"],
    summary: "Turns requests into clear issues for the coding tool you already use, then checks the result: tests, security, failing builds and merge readiness. A person always merges.",
    becomes: ["faivr.agent.build-instructions-keeper", "faivr.agent.build-merge-gate", "faivr.agent.build-issue-writer", "faivr.agent.build-security-reviewer", "faivr.agent.build-qa-reviewer", "faivr.agent.build-ci-fixer"],
  },
  {
    slug: "marketing-planning",
    name: "Marketing planning",
    agents: ["Ivy"],
    summary: "Audience, positioning, channels, campaigns and a content calendar.",
    becomes: ["faivr.agent.marketing-planner"],
  },
  {
    slug: "strategy-and-challenge",
    name: "Strategy and challenge",
    agents: ["Challenger"],
    summary: "Includes Challenger. Package details will be published when this function is available.",
    becomes: ["faivr.agent.challenger"],
  },
  {
    slug: "pricing-and-business-models",
    name: "Pricing and business models",
    agents: ["Cora"],
    summary: "Pricing scenarios and business-model options, with every number reproducible.",
    becomes: ["faivr.agent.pricing-models"],
  },
  {
    slug: "visibility-in-ai-search",
    name: "Visibility in AI search",
    agents: ["Gideon"],
    summary: "Checks how AI search engines see your website and what to change.",
    becomes: ["faivr.agent.ai-visibility"],
  },
  {
    slug: "linkedin-posting",
    name: "LinkedIn posting",
    agents: ["Lena"],
    summary: "Publishes the LinkedIn posts from your marketing plan, with your approval or automatically, as you choose.",
    becomes: [],
  },
];

export function comingSoonFunctionForPackageIds(packageIds: readonly string[]): ComingSoonFunction | undefined {
  return comingSoonFunctions.find((item) => item.becomes.some((id) => packageIds.includes(id)));
}
