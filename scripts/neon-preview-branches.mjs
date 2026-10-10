import { execFileSync as nativeExecFileSync } from "node:child_process";

const SAFE_PREVIEW_BRANCH = /^preview\/[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$/;

export function validatePreviewBranchName(branchName) {
  if (!SAFE_PREVIEW_BRANCH.test(branchName) || branchName.includes("..") || branchName.endsWith("/") || branchName.includes("//")) {
    throw new Error("Invalid Neon preview branch name");
  }
  return branchName;
}

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
  return branch.primary === true || branch.default === true || branch.protected === true || !branch.parent_id || branch.name === "preview/main";
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
    cursor = payload.pagination?.next ?? null;
  } while (cursor);
  return branches;
}

export async function previewBranchExists({ fetchImpl, projectId, apiKey, branchName }) {
  validatePreviewBranchName(branchName);
  const branches = await listNeonBranches({ fetchImpl, projectId, apiKey });
  const branch = branches.find((candidate) => candidate?.name === branchName);
  if (!branch) return false;
  if (isProtectedPreviewBranch(branch)) throw new Error("Refusing to delete a protected, default, primary, or root Neon branch");
  return true;
}

export async function pruneOrphanedPreviewBranches({ branches, gitState = gitBranchState, deleteBranch, log = console.log }) {
  const candidates = branches
    .filter((branch) => typeof branch?.id === "string" && typeof branch?.name === "string" && branch.name.startsWith("preview/") && !isProtectedPreviewBranch(branch))
    .map((branch) => ({ branch, gitBranch: branch.name.slice("preview/".length) }))
    .filter(({ gitBranch }) => gitBranch);

  // Complete all Git lookups first. A later lookup failure must not allow partial deletion.
  const orphaned = candidates.filter(({ gitBranch }) => gitState(gitBranch) === "missing");
  for (const { branch } of orphaned) {
    const response = await deleteBranch(branch.id);
    if (!response.ok && response.status !== 404) throw new Error(`Neon branch deletion failed with HTTP ${response.status}`);
    log(`Deleted orphaned Neon branch ${branch.name}.`);
  }
}
