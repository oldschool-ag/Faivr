import { execFileSync as nativeExecFileSync } from "node:child_process";

export function gitBranchState(branch, execFileSync = nativeExecFileSync) {
  try {
    execFileSync("git", ["ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`], { stdio: "ignore" });
    return "exists";
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 2) return "missing";
    throw error;
  }
}

function isProtectedPreviewBranch(branch) {
  return branch.primary === true || branch.default === true || branch.protected === true || branch.name === "preview/main";
}

export async function listNeonBranches({ fetchImpl, projectId, apiKey }) {
  const branches = [];
  let cursor;
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const response = await fetchImpl(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/branches?${query}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) throw new Error(`Neon branch listing failed with HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.branches)) throw new Error("Neon branch listing returned an invalid response");
    branches.push(...payload.branches);
    cursor = payload.pagination?.cursor ?? null;
  } while (cursor);
  return branches;
}

export async function previewBranchExists({ fetchImpl, projectId, apiKey, branchName }) {
  const branches = await listNeonBranches({ fetchImpl, projectId, apiKey });
  return branches.some((branch) => branch?.name === branchName);
}

export async function pruneOrphanedPreviewBranches({ branches, gitState = gitBranchState, deleteBranch, log = console.log }) {
  for (const branch of branches) {
    if (typeof branch?.id !== "string" || typeof branch?.name !== "string" || !branch.name.startsWith("preview/") || isProtectedPreviewBranch(branch)) continue;
    const gitBranch = branch.name.slice("preview/".length);
    if (!gitBranch || gitState(gitBranch) !== "missing") continue;
    const response = await deleteBranch(branch.id);
    if (!response.ok && response.status !== 404) throw new Error(`Neon branch deletion failed with HTTP ${response.status}`);
    log(`Deleted orphaned Neon branch ${branch.name}.`);
  }
}
