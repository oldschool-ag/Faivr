# Deployment Runbook

## Authoritative Vercel Config

- Vercel project root: `web/`
- Vercel config: `web/vercel.json`
- Root `vercel.json` and tracked `.vercel/project.json` are intentionally absent.

## Required Environment Variables

Set secrets in Vercel project settings, scoped by environment.

| Variable | Required | Notes |
|---|---:|---|
| `DATABASE_URL` | Production yes | Durable quote-request storage. Production runtime rejects JSON fallback. |
| `OPERATOR_AUTH_USERNAME` | Yes | HTTP auth username for operator/admin surfaces. |
| `OPERATOR_AUTH_PASSWORD` | Yes | HTTP auth password for operator/admin surfaces. |
| `OPENAI_API_KEY` | Optional for fallback | Support chat uses rule-based responses when absent. |
| `QUOTE_REQUEST_OPERATOR_KEY` | Legacy only | Temporary server-to-server fallback. Do not use as browser UX. |

Do not commit local `.env` files. Use `.env.local` only for local development.

## Pre-Deploy Checks

- GitHub PR is approved.
- Required CI status checks passed:
  - `forge build and test`
  - `lint, typecheck, test, build`
- `docs/protocol-admin-risk.md` remains reflected in release notes if admin risk is unresolved.
- No tracked `.vercel/`, broadcast JSON, generated PDF/log, or local runtime artifact is present.

## Deploy

Standard path:

1. Merge through PR after required checks pass.
2. Let Vercel Git integration build from the `web/` root.
3. Verify the production deployment URL and commit SHA.

Custom CI path if needed:

```bash
cd web
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
vercel pull --yes --environment=production --token=$VERCEL_TOKEN
vercel build --prod --token=$VERCEL_TOKEN
vercel deploy --prebuilt --prod --token=$VERCEL_TOKEN
```

## Rollback

- Prefer Vercel rollback to the last verified production deployment.
- Record deployment ID, commit SHA, reason, and verification result in release notes.
- If the rollback relates to quote requests, verify `DATABASE_URL` points to the intended production database before and after rollback.

## Post-Deploy Verification

- Visit the public homepage and marketplace.
- Submit a test quote request with a non-production wallet/address if policy permits.
- Verify operator/admin surfaces require HTTP auth and return `Cache-Control: no-store`.
- Verify `/api/quote-requests?requesterAddress=<address>` remains public for the requester lookup path.
- Review Vercel function logs for operator audit events and unexpected 5xx responses.
