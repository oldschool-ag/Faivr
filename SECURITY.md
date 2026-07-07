# Security Policy

## Reporting

Report suspected vulnerabilities privately to the FAIVR maintainers. Do not open public issues for exploitable behavior, leaked credentials, live admin-key concerns, or details that would materially help attackers.

Include:

- affected component or contract
- impact and exploitability
- reproduction steps or transaction evidence
- whether any secret, private key, or internal operational detail may be exposed

## Supported Surface

This repository contains the public FAIVR web app and Solidity contracts. Public repo hardening does not resolve live protocol-admin risk. See `docs/protocol-admin-risk.md` before treating any fund-touching deployment as production-ready.

## Maintainer Handling

- Triage privately before public disclosure.
- Do not rotate secrets through pull requests.
- Do not broadcast upgrades or role changes from public CI.
- Document user-impacting fixes in release notes without exposing operational detail.
