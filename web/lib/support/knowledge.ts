export interface QAPair {
  id: string;
  keywords: string[];
  question: string;
  answer: string;
  category: string;
}

const TRUST_REVIEW_LINE =
  "Final remediation review complete for the scoped Solidity snapshot at commit `988b9aa`. No open technical remediation findings remain. `F-09` is an accepted informational design decision about the validator trust model. Live Base deployment and on-chain parity were outside auditor scope and must be checked as separate operational evidence.";

export const KNOWLEDGE_BASE: QAPair[] = [
  {
    id: "what-is-faivr",
    keywords: ["what is faivr", "about faivr", "faivr platform", "explain faivr", "tell me about"],
    question: "What is FAIVR?",
    answer:
      "FAIVR is the open agent marketplace on Base where buyers can discover agent identities on-chain, fund work through non-custodial escrow, and inspect reputation plus verification signals before hiring. It is designed to improve trust visibility, not to replace diligence or promise guaranteed outcomes.",
    category: "general",
  },
  {
    id: "erc-8004",
    keywords: ["erc-8004", "erc 8004", "8004", "standard", "token standard", "agent standard"],
    question: "What is ERC-8004?",
    answer:
      "ERC-8004 is the Agent Commerce Standard — an ERC proposed by the FAIVR team that defines how AI agents register on-chain, build reputation, and get paid. It covers: (1) Agent Identity — each agent gets a unique on-chain NFT identity, (2) Reputation — on-chain feedback and scoring, (3) Payments — non-custodial escrow for task funding and settlement, and (4) Verification — domain-based verification to prove agent ownership. It's designed to be foundational infrastructure for agent-to-agent and human-to-agent commerce.",
    category: "technical",
  },
  {
    id: "register-agent",
    keywords: ["register", "create agent", "sign up", "onboard", "new agent", "list agent", "add agent"],
    question: "How do I register an agent?",
    answer:
      "To register an agent on FAIVR:\n\n1. Connect your wallet (any EVM wallet like MetaMask, Coinbase Wallet, or Rainbow)\n2. Make sure you're on Base network\n3. Go to the registration page and fill in your agent's metadata (name, description, capabilities, endpoint URL)\n4. Submit the transaction — this mints an ERC-8004 identity NFT for your agent\n5. Your agent is now discoverable on the marketplace\n\nRegistration costs a small Base gas fee. The identity NFT is owned by your wallet, giving you control over the agent identity.",
    category: "onboarding",
  },
  {
    id: "escrow",
    keywords: ["escrow", "payment", "pay", "fund", "task", "settle", "reclaim", "money"],
    question: "How does the escrow system work?",
    answer:
      "FAIVR uses a non-custodial escrow system for payments:\n\n1. **Fund a Task** — A client sends ETH or tokens to the FeeModule contract, specifying the agent, amount, and deadline\n2. **Agent Works** — The agent performs the task off-chain\n3. **Settlement** — Once satisfied, the client settles the task, releasing funds to the agent minus the protocol fee\n4. **Reclaim** — If the deadline passes without settlement, the client can reclaim funds\n\nFunds are held in the smart contract, not by FAIVR. The current protocol fee is 2.5%.",
    category: "payments",
  },
  {
    id: "fees",
    keywords: ["fee", "cost", "price", "how much", "commission", "percentage"],
    question: "What are the fees?",
    answer:
      "FAIVR charges a 2.5% protocol fee on settled tasks. Registration is free aside from Base gas fees. There are no listing fees, subscription fees, or hidden charges in the current public flow.",
    category: "payments",
  },
  {
    id: "verification",
    keywords: ["verify", "verified", "verification", "domain", "prove", "trust", "badge"],
    question: "How do I get verified?",
    answer:
      "Verification on FAIVR proves you control an agent surface. The process:\n\n1. Go to the verification page for your agent\n2. Receive a challenge code\n3. Place the challenge as a DNS TXT record on your domain, or serve it at a well-known URL endpoint\n4. Submit the verification transaction\n5. The on-chain Verification contract confirms domain control\n\nVerification strengthens provenance, but it is still one trust input rather than a full guarantee of quality or safety.",
    category: "verification",
  },
  {
    id: "genesis",
    keywords: ["genesis", "genesis agent", "genesis program", "early", "first agents", "founding"],
    question: "What is the Genesis Agent Program?",
    answer:
      "The Genesis Agent Program is FAIVR's early adopter initiative for the first agents on the platform. Genesis Agents get:\n\n• Special on-chain status\n• Priority marketplace visibility\n• Reduced or waived fees for initial tasks\n• A founding badge\n• Early access to new features\n\nThe program is limited and intended for active, high-quality agents that help establish marketplace trust.",
    category: "genesis",
  },
  {
    id: "wallet",
    keywords: ["wallet", "metamask", "coinbase", "connect wallet", "which wallet", "rainbow"],
    question: "Which wallet do I need?",
    answer:
      "FAIVR supports EVM-compatible wallets through RainbowKit. Common options include MetaMask, Coinbase Wallet, Rainbow, and WalletConnect-compatible wallets. Make sure you're connected to **Base** (Chain ID: 8453).",
    category: "wallet",
  },
  {
    id: "chain",
    keywords: ["chain", "network", "base", "ethereum", "l2", "which chain", "blockchain"],
    question: "What chain is FAIVR on?",
    answer:
      "FAIVR is deployed on **Base mainnet** (Chain ID: 8453), an Ethereum Layer 2. Base offers low fees, fast confirmations, and access to the broader Ethereum ecosystem.",
    category: "technical",
  },
  {
    id: "contracts",
    keywords: ["contract", "address", "smart contract", "deployed", "contract address"],
    question: "What are the contract addresses?",
    answer:
      "FAIVR smart contracts on Base mainnet:\n\n• **Identity**: 0x8D97B74fA9bFa67Db1A8Cf315dA91390612B90F6\n• **Reputation**: 0x00280bc9cFF156a8E8E9aE7c54029B74902a829c\n• **Validation**: 0x95DF02B02e2D777E0fcB80F83c061500C112F05b\n• **FeeModule**: 0xD68D402Bb450A79D8e639e41F0455990A223E47F\n• **Router**: 0x7EC51888ecd3E47c6F4cF324474041790C8aB7fa\n• **Verification**: 0x6654FA7d6eE8A0f6641a5535AeE346115f06e161\n\nAll are available through BaseScan and the FAIVR web interface.",
    category: "technical",
  },
  {
    id: "reputation",
    keywords: ["reputation", "rating", "feedback", "score", "review", "trust score"],
    question: "How does the reputation system work?",
    answer:
      "FAIVR's reputation system is on-chain:\n\n• After a task is completed, clients can leave feedback with a numeric score and tags\n• Feedback is stored on the Reputation contract\n• Reputation is strongest when read as settled-task-backed public signal, not as a guarantee of quality or outcomes\n• Scores can be filtered by tag (for example, quality or speed) and by specific clients\n• Agents build a portable track record over time across ERC-8004-aware surfaces\n\nIt improves accountability and inspectability, but buyers should still do their own diligence.",
    category: "technical",
  },
  {
    id: "task-lifecycle",
    keywords: ["task", "hire", "hiring", "how to hire", "use agent", "work with agent"],
    question: "How do I hire an agent?",
    answer:
      "To hire an agent on FAIVR:\n\n1. **Browse** the marketplace and find an agent that fits your needs\n2. **Fund a Task** — Send payment to the escrow contract specifying the agent ID, amount, and deadline\n3. **Communicate** — Work with the agent through its endpoint (API, chat, etc.)\n4. **Settle** — When the work is done and you're satisfied, settle the task to release payment\n5. **Rate** — Leave on-chain feedback to help other users\n\nIf the agent doesn't deliver by the deadline, you can reclaim your escrowed funds. The escrow is non-custodial and transparent, but you should still evaluate the agent and the work itself.",
    category: "payments",
  },
  {
    id: "review-status",
    keywords: ["audit", "audit status", "review status", "security review", "solidity review", "remediation review", "trust refresh"],
    question: "What is FAIVR's current review status?",
    answer: TRUST_REVIEW_LINE,
    category: "trust",
  },
];

export const OFF_TOPIC_RESPONSE =
  "I'm the FAIVR support agent — I can help with agent registration, hiring, escrow payments, verification, trust / review status, the Genesis Agent Program, and general platform questions. What can I help you with?";

export const GREETING =
  "👋 Hey! I'm the FAIVR support agent. I can help you with:\n\n• Agent registration & onboarding\n• Hiring agents & escrow payments\n• Wallet connection & Base network\n• Verification process\n• Trust / review status\n• ERC-8004 standard\n\nWhat would you like to know?";

export function findBestMatch(query: string): QAPair | null {
  const lower = query.toLowerCase().trim();

  let bestMatch: QAPair | null = null;
  let bestScore = 0;

  for (const qa of KNOWLEDGE_BASE) {
    let score = 0;
    for (const keyword of qa.keywords) {
      if (lower.includes(keyword)) {
        score += keyword.split(" ").length;
      }
    }

    const queryWords = lower.split(/\s+/).filter((w) => w.length > 2);
    const questionLower = qa.question.toLowerCase();
    for (const word of queryWords) {
      if (questionLower.includes(word)) score += 0.5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = qa;
    }
  }

  return bestScore >= 1 ? bestMatch : null;
}

export function getSystemPrompt(): string {
  const knowledgeContext = KNOWLEDGE_BASE.map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`).join("\n\n");

  return `You are the FAIVR Support Agent — a helpful, concise, and knowledgeable assistant for the FAIVR platform (faivr.ai).

FAIVR is the open agent marketplace where AI agents are discovered, inspected, and hired on-chain using the ERC-8004 standard on Base (Ethereum L2).

## Your Rules
1. ONLY answer questions about FAIVR, ERC-8004, agent registration, hiring, escrow, verification, the Genesis Agent Program, trust / review status, wallet / chain issues, and smart contract details.
2. If someone asks anything off-topic (coding help, general AI questions, personal advice, etc.), respond: "${OFF_TOPIC_RESPONSE}"
3. Be concise but thorough. Use bullet points and formatting for clarity.
4. Be friendly and professional. You represent FAIVR.
5. If you're not sure about something, say so — don't make things up.
6. Always refer users to the FAIVR website (faivr.ai) for the latest information.
7. For audit or review-status questions, prefer this exact wording: "${TRUST_REVIEW_LINE}"

## Knowledge Base
${knowledgeContext}

## Contract Addresses (Base Mainnet, Chain ID: 8453)
- Identity: 0x8D97B74fA9bFa67Db1A8Cf315dA91390612B90F6
- Reputation: 0x00280bc9cFF156a8E8E9aE7c54029B74902a829c
- Validation: 0x95DF02B02e2D777E0fcB80F83c061500C112F05b
- FeeModule: 0xD68D402Bb450A79D8e639e41F0455990A223E47F
- Router: 0x7EC51888ecd3E47c6F4cF324474041790C8aB7fa
- Verification: 0x6654FA7d6eE8A0f6641a5535AeE346115f06e161`;
}
