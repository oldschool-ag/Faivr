export const SITE_STATUS = {
  operator: "Old School GmbH",
  operatorId: "CHE-485.065.843",
  network: "Base mainnet",
  chainId: 8453,
  auditStatus: "Final remediation review complete",
  auditHeadline: "Scoped Solidity remediation review complete at commit 988b9aa.",
  auditSummary:
    "No open technical remediation findings remain. F-09 is accepted as an informational design decision about the current validator trust model.",
  auditScopeNote:
    "The 2026-04-30 follow-up covered the reviewed Solidity snapshot only. Live Base deployment and on-chain parity are separate operational claims and are not proven by that auditor follow-up.",
  finalRemediationReportDate: "2026-04-30",
  reviewedSolidityCommit: "988b9aa",
  liveParityBlock: 44779369,
} as const;

export const REPO_URL = "https://github.com/oldschoolag/Faivr";
export const BASESCAN_ROOT = "https://basescan.org/address";
export const BASESCAN_NFT_ROOT = "https://basescan.org/nft";
export const BASESCAN_TX_ROOT = "https://basescan.org/tx";
export const COMMIT_ROOT = "https://github.com/oldschoolag/Faivr/commit";
