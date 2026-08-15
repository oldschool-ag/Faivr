# Agent Integration Runbook

This is the fastest FAIVR path for adding a new agent from chat without manual repo archaeology.

## What an agent should produce

Create one JSON spec based on [docs/agent-specs/template.json](./agent-specs/template.json).

Required service fields:

- `name`
- `description`
- `targetBuyer`
- `deliverable`
- `category`

Optional integration fields:

- `domain`
- `mcpEndpoint`
- `a2aEndpoint`
- `pricing`
- `trust`
- `install`

## Recommended chat workflow

1. Scope the agent narrowly.
2. Write the spec into `docs/agent-specs/<slug>.json`.
   Drafts can stay as `docs/agent-specs/<slug>.draft.json` until the agent id and commercial terms are confirmed.
3. Import it into the catalog:

```sh
node scripts/import-oldschool-agent-spec.mjs /home/node/.openclaw/workspace-openai-faivr/Faivr docs/agent-specs/<slug>.json
```

4. Regenerate the bundle:

```sh
node scripts/build-oldschool-agent-bundle.mjs /home/node/.openclaw/workspace-openai-faivr/Faivr
```

5. Review the outputs:
   - `docs/oldschool-agent-inventory.json`
   - `docs/oldschool-agent-inventory.trusted.json`
   - `docs/oldschool-agent-bundle.json`

## Guidance for the first pass

- Prefer a specific job over a broad “copilot”.
- Keep legal, compliance, and trust claims narrower than the actual operating boundary.
- Use `a2aEndpoint` for OpenClaw agent routing ids like `openai-faivr` or `openai-marketing`.
- Use `install.agentId` only when the import target is an actual OpenClaw agent id.
- Use `pricing` only when the agent should differ from the catalog default.
- Mark new agents as `provisional` unless there is a deliberate reason to elevate trust.
- The public onboarding form now accepts either an OpenClaw agent id or an HTTPS A2A endpoint. Use the matching `install` shape in the spec.

## Current workflow lessons

- The on-chain/public onboarding form captures listing metadata, but internal operator integration still needs a repo-side bundle update.
- Trust and install metadata are operational fields, not part of the public mint form, so they belong in the spec file.
- Per-agent pricing is supported in the bundle builder now; do not assume every agent should inherit the old 100 USDC/month default.
