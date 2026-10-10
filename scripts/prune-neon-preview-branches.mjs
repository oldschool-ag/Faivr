import { execFileSync } from "node:child_process";

const projectId = process.env.NEON_PROJECT_ID;
const apiKey = process.env.NEON_API_KEY;

if (!projectId || !apiKey) throw new Error("NEON_PROJECT_ID and NEON_API_KEY are required");

async function neon(path, options = {}) {
  const response = await fetch(`https://console.neon.tech/api/v2${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${apiKey}`, ...(options.headers ?? {}) },
  });
  return response;
}

function gitBranchExists(branch) {
  try {
    execFileSync("git", ["ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const listed = await neon(`/projects/${encodeURIComponent(projectId)}/branches`);
if (!listed.ok) throw new Error(`Neon branch listing failed with HTTP ${listed.status}`);
const payload = await listed.json();
const branches = Array.isArray(payload.branches) ? payload.branches : [];

for (const branch of branches) {
  if (typeof branch?.id !== "string" || typeof branch?.name !== "string" || !branch.name.startsWith("preview/")) continue;
  const gitBranch = branch.name.slice("preview/".length);
  if (!gitBranch || gitBranchExists(gitBranch)) continue;
  const deleted = await neon(`/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branch.id)}`, { method: "DELETE" });
  if (!deleted.ok && deleted.status !== 404) throw new Error(`Neon branch deletion failed with HTTP ${deleted.status}`);
  console.log(`Deleted orphaned Neon branch ${branch.name}.`);
}
