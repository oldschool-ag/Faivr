import assert from "node:assert/strict";
import test from "node:test";
import { gitBranchState, listNeonBranches, previewBranchExists, pruneOrphanedPreviewBranches } from "./neon-preview-branches.mjs";

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test("git status 128 is an error, not proof that a branch is absent", () => {
  const error = Object.assign(new Error("remote unavailable"), { status: 128 });
  assert.throws(() => gitBranchState("review/failure", () => { throw error; }), /remote unavailable/);
});

test("a confirmed missing Git branch deletes its matching preview branch", async () => {
  const deleted = [];
  await pruneOrphanedPreviewBranches({
    branches: [{ id: "branch-1", name: "preview/review/closed" }],
    gitState: () => "missing",
    deleteBranch: async (id) => { deleted.push(id); return { ok: true, status: 200 }; },
    log: () => {},
  });
  assert.deepEqual(deleted, ["branch-1"]);
});

test("main, protected, and default branches are preserved", async () => {
  const deleted = [];
  await pruneOrphanedPreviewBranches({
    branches: [
      { id: "primary", name: "preview/main" },
      { id: "protected", name: "preview/review/protected", protected: true },
      { id: "default", name: "preview/review/default", default: true },
      { id: "non-preview", name: "main" },
    ],
    gitState: () => "missing",
    deleteBranch: async (id) => { deleted.push(id); return { ok: true, status: 200 }; },
    log: () => {},
  });
  assert.deepEqual(deleted, []);
});

test("lists all Neon pages before pruning", async () => {
  const calls = [];
  const branches = await listNeonBranches({
    projectId: "project",
    apiKey: "test",
    fetchImpl: async (url) => {
      calls.push(String(url));
      return calls.length === 1
        ? ok({ branches: [{ id: "one", name: "preview/one" }], pagination: { cursor: "next-page" } })
        : ok({ branches: [{ id: "two", name: "preview/two" }], pagination: {} });
    },
  });
  assert.deepEqual(branches.map((branch) => branch.id), ["one", "two"]);
  assert.match(calls[1], /cursor=next-page/);
});

test("a missing preview branch is a successful preflight result", async () => {
  const exists = await previewBranchExists({
    projectId: "project",
    apiKey: "test",
    branchName: "preview/review/closed",
    fetchImpl: async () => ok({ branches: [], pagination: {} }),
  });
  assert.equal(exists, false);
});

test("an authentication failure stops cleanup", async () => {
  await assert.rejects(
    () => listNeonBranches({ projectId: "project", apiKey: "bad", fetchImpl: async () => ({ ok: false, status: 401 }) }),
    /HTTP 401/,
  );
});
