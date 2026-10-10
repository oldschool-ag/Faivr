import { previewBranchExists, validatePreviewBranchName } from "./neon-preview-branches.mjs";
import { appendFile } from "node:fs/promises";

const branchName = process.env.PREVIEW_BRANCH;
const projectId = process.env.NEON_PROJECT_ID;
const apiKey = process.env.NEON_API_KEY;
if (!branchName || !projectId || !apiKey) throw new Error("PREVIEW_BRANCH, NEON_PROJECT_ID, and NEON_API_KEY are required");

validatePreviewBranchName(branchName);
const exists = await previewBranchExists({ fetchImpl: fetch, projectId, apiKey, branchName });
const output = process.env.GITHUB_OUTPUT;
if (!output) throw new Error("GITHUB_OUTPUT is required");
await appendFile(output, `exists=${exists}\nbranch=${branchName}\n`);
