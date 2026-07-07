# Public Repository Policy

This repository should contain product source, public-safe documentation, tests, CI, and legal documents only.

## Allowed

- Solidity contracts and tests.
- Next.js web app source and tests.
- Sanitized public product docs.
- Public-safe deployment addresses and explorer links.
- Legal terms, privacy, and risk disclosures.
- CI workflows and repo governance templates.

## Not Allowed

- Secrets, private keys, local `.env` files, Vercel project metadata, or secret inventories.
- Generated logs, local runtime data, generated PDFs, temporary exports, and Foundry broadcast output.
- Investor summaries, announcement drafts, internal ops notes, workspace memory, agent artifacts, or dated status packets.
- Detailed live-admin execution notes that materially help attackers.
- Claims that protocol admin risk is solved when live authority has not moved to an appropriate Safe/timelock posture.

## Cleanup Classification

Removed from this public repo in this hardening pass:

- generated PDF/log artifacts;
- dated audit/status/comms/investor packets from the repo root;
- stale auto-audit/security-fix work packets;
- obsolete live-upgrade parity scripts;
- tracked Foundry broadcast JSON;
- tracked local Vercel project metadata;
- stale root TypeScript config that pointed to Base Sepolia.

Keep public:

- sanitized README, legal docs, contract source, web source, tests, CI, and public-safe deployment docs.

Move to a private/internal repo if still operationally useful:

- historical status reports;
- auditor work packets;
- investor/data-room summaries;
- announcement drafts;
- admin execution notes;
- local workspace state and agent memory.

## Historical Exposure

Deleting a tracked file does not remove it from git history. Anything previously committed must be treated as historically public unless the repository owner performs a separate history-rewrite and downstream cache cleanup process.
