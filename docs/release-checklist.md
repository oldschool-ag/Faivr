# Release Checklist

## Tagging Convention

- Web deployable states: `web-vYYYY.MM.DD-N` after CI passes and the Vercel deployment is verified.
- Contract milestones: `contracts-vYYYY.MM.DD-N` for reviewed source states, audit snapshots, or deployment documentation milestones.
- Do not create tags for live protocol changes until the admin-action runbook and verification report are attached to the release.

## Required Records

Each release note must include:

- commit SHA
- CI run links
- Vercel deployment URL for web releases
- canonical contract addresses for contract-related releases
- audit reference commit or audit report pointer
- deployment notes
- rollback notes
- known unresolved blockers

## Pre-Release Checks

- `cd contracts && forge build`
- `cd contracts && forge test`
- `cd web && npm run lint`
- `cd web && npm run typecheck`
- `cd web && npm run test`
- `cd web && npm run build`

## Web Rollback

Use Vercel rollback or promote the last verified preview/production deployment. Record the deployment ID and reason for rollback in the release notes.

## Contract Release Guardrail

Do not tag or describe any live admin migration as complete until:

- fork rehearsal is complete;
- Safe owner set and threshold are verified;
- target Safe role receipt is verified onchain;
- EOA role revocation is verified onchain;
- timelock status is either implemented or explicitly listed as unresolved.
