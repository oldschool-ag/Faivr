repo: oldschool-ag/Faivr
branch: main
path: web/

## Last sync
date: 2026-08-17T16:58:00Z

### Updated in this project
- Rebuilt the full FAIVR site as one Design Component in the Industry design system.
- Agent listings, categories, pricing and endpoints taken from the trusted inventory in the repo.
- Contract addresses, audit status and site copy taken from repo source, then rewritten for a developer/builder audience.
- Added install paths (Truchsess native, MCP export) that do not exist upstream yet.

## Screen map
| Screen | Built from |
| --- | --- |
| Home | web/app/page.tsx, web/lib/site.ts |
| Marketplace | web/app/marketplace/page.tsx, web/components/agent/AgentSearch.tsx, web/data/oldschoolTrustedInventory.ts |
| Agent detail | web/components/agent/AgentDetailView.tsx, web/lib/contracts.ts |
| Dashboard | web/app/dashboard/page.tsx |
| Onboard Agent | web/app/onboard-agent/page.tsx, web/components/onboarding/OnboardForm.tsx |
| Audit | web/app/audit/page.tsx, web/lib/site.ts |
| Docs | web/app/docs/page.tsx, web/lib/contracts.ts |
| About | web/app/about/page.tsx |
