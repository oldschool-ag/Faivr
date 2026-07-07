# Production Readiness

## Current Status

Repo and app hardening has been prepared in this branch. FAIVR must not be described as production-ready while live upgrade authority remains unresolved.

## Completed In This Pass

- `.github/` is no longer ignored.
- Repo-tracked CI workflows exist for contracts and web.
- Public-repo policy and cleanup rules are documented.
- Generated/root spillover artifacts were removed from the current tree.
- Canonical runtime contract addresses live in `web/lib/contracts.ts`.
- Base Sepolia references are quarantined in `web/lib/contracts.base-sepolia.testnet.ts`.
- Operator quote-request APIs now use schema validation, timing-safe auth comparison, rate limiting, no-store responses, and structured audit logs.
- Operator/browser flow no longer asks the operator to paste the shared server secret into the UI.
- Vercel config is standardized on `web/vercel.json`.
- Deployment, GitHub settings, release, security, and admin-migration docs are present.
- Read-only admin role readiness tooling is present at `contracts/script/AdminRoleReadiness.s.sol`.

## Historical Public Exposure

The following categories were removed from the current public tree but must be treated as historically public because they were committed previously:

- dated audit/status/comms/investor packets;
- generated audit PDF and mdpdf log;
- Foundry broadcast JSON;
- obsolete live-upgrade parity script with admin context;
- tracked `.vercel/project.json`;
- deployment/admin notes that included signer/admin context;
- stale root Base Sepolia TypeScript config.

History rewrite, cache invalidation, and secret/identifier risk review are separate manual owner actions.

## Required Manual Follow-Ups

- Enable GitHub branch protection and required checks described in `docs/github-required-settings.md`.
- Verify CODEOWNERS entries use real GitHub teams/users before enforcing CODEOWNERS review.
- Configure Vercel project root as `web/`.
- Configure Vercel env vars from `docs/deployment-runbook.md`.
- Review `npm audit` output and schedule dependency remediation.
- Rehearse admin migration on a fork.
- Migrate live admin authority to Safe and, preferably, timelock.

## Blocking Risks Still Open

- Single-EOA live upgrade authority: unresolved until current onchain verification proves otherwise or migration is completed.
- Branch protection not yet enforced in GitHub settings: unresolved until manually enabled.
- Commit provenance/signing not yet enforced: unresolved until manually enabled or formally deferred.
- Remaining public-history exposure: unresolved unless repository history and external caches are separately remediated.
- Remaining weak operator-auth concerns: partially improved, but still not full managed operator identity/session auth.
