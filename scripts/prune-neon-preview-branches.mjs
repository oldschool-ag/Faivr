import { listNeonBranches, pruneOrphanedPreviewBranches } from "./neon-preview-branches.mjs";

const projectId = process.env.NEON_PROJECT_ID;
const apiKey = process.env.NEON_API_KEY;
if (!projectId || !apiKey) throw new Error("NEON_PROJECT_ID and NEON_API_KEY are required");

const branches = await listNeonBranches({ fetchImpl: fetch, projectId, apiKey });
await pruneOrphanedPreviewBranches({
  branches,
  deleteBranch: (id) => fetch(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  }),
});
