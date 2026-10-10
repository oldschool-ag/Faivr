import { previewBranchExists } from "./neon-preview-branches.mjs";

const [branchName] = process.argv.slice(2);
const projectId = process.env.NEON_PROJECT_ID;
const apiKey = process.env.NEON_API_KEY;
if (!branchName || !projectId || !apiKey) throw new Error("branch name, NEON_PROJECT_ID, and NEON_API_KEY are required");

const exists = await previewBranchExists({ fetchImpl: fetch, projectId, apiKey, branchName });
const output = process.env.GITHUB_OUTPUT;
if (!output) throw new Error("GITHUB_OUTPUT is required");
await (await import("node:fs/promises")).appendFile(output, `exists=${exists}\n`);
