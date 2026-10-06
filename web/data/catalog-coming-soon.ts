export type ComingSoonFunction = { slug: string; name: string; workers: string[]; summary: string };
export const comingSoonFunctions: ComingSoonFunction[] = [
  { slug: "design-review", name: "Design review", workers: ["Ivo"], summary: "Reviews your web pages and product screens and writes a design brief with screenshots. (Becomes available when the CEO publishes Ivo's new version.)" },
  { slug: "product-ownership", name: "Product ownership", workers: ["Product Owner"], summary: "Owns one product: decisions, priorities, routing work to other workers and checking their results. One install per product." },
  { slug: "website-care", name: "Website care", workers: ["Website Owner"], summary: "Keeps one website up to date through pull requests that a person approves. One install per website." },
  { slug: "software-delivery", name: "Software delivery: Bob", workers: ["Bob - Issue Writer", "Bob - Instructions Keeper", "Bob - QA Reviewer", "Bob - Security Reviewer", "Bob - CI Fixer", "Bob - Merge Gate"], summary: "Turns requests into clear issues, then checks the result: tests, security, failing builds and merge readiness. A person always merges." },
  { slug: "marketing-planning", name: "Marketing planning", workers: ["Ivy"], summary: "Audience, positioning, channels, campaigns and a content calendar." },
  { slug: "strategy-and-challenge", name: "Strategy and challenge", workers: ["Strategy", "Challenger"], summary: "One writes the strategy and the recommendations, the other attacks it. The one who writes never reviews." },
  { slug: "pricing-and-business-models", name: "Pricing and business models", workers: ["Cora"], summary: "Pricing scenarios and business-model options, with every number reproducible." },
  { slug: "visibility-in-ai-search", name: "Visibility in AI search", workers: ["Gideon"], summary: "Checks how AI search engines see your website and what to change." },
  { slug: "linkedin-posting", name: "LinkedIn posting", workers: ["Lena"], summary: "Publishes the LinkedIn posts from your marketing plan, with your approval or automatically, as you choose." },
];
