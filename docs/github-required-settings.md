# GitHub Required Settings

These controls must be enabled in GitHub. Local repo edits do not enforce them by themselves.

## Branch Protection

Protect `main` with:

- PRs required before merge.
- Required approving review from CODEOWNERS.
- Required status checks:
  - `forge build and test`
  - `lint, typecheck, test, build`
- Branch must be up to date before merge.
- Force pushes disabled.
- Branch deletion disabled.
- Direct pushes restricted to maintainers or disabled entirely where the plan supports it.
- Conversation resolution required before merge.

## Repository Security

Enable where available:

- Secret scanning.
- Push protection for detected secrets.
- Dependabot alerts.
- Dependabot security updates.
- Code scanning if a Solidity/TypeScript scanner is configured later.

## Provenance

Preferred policy:

- require signed commits for `main` if all maintainers can support it;
- require squash or merge commits through PRs only;
- disallow local-only release tags without review.

If signed commits are not enforceable immediately, record that as an open governance follow-up in the release checklist.
