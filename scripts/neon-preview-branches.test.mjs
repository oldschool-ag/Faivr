import assert from "node:assert/strict";
import test from "node:test";
import { gitBranchState, listNeonBranches, previewBranchExists, pruneOrphanedPreviewBranches, validatePreviewBranchName } from "./neon-preview-branches.mjs";

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const preview = (id, name, extra = {}) => ({ id, name, parent_id: "parent-branch", ...extra });

test("git status 128 is an error, not proof that a branch is absent", () => {
  const error = Object.assign(new Error("remote unavailable"), { status: 128 });
  assert.throws(() => gitBranchState("review/failure", () => { throw error; }), /remote unavailable/);
});

test("a confirmed missing Git branch deletes its matching preview branch", async () => {
  const deleted = [];
  await pruneOrphanedPreviewBranches({
    branches: [preview("branch-1", "preview/review/closed")],
    gitState: () => "missing",
    deleteBranch: async (id) => { deleted.push(id); return { ok: true, status: 200 }; },
    log: () => {},
  });
  assert.deepEqual(deleted, ["branch-1"]);
});

test("all Git lookups finish before any deletion", async () => {
  const deleted = [];
  const transportError = Object.assign(new Error("remote unavailable"), { status: 128 });
  await assert.rejects(
    () => pruneOrphanedPreviewBranches({
      branches: [preview("first", "preview/review/first"), preview("second", "preview/review/second")],
      gitState: (branch) => { if (branch === "review/second") throw transportError; return "missing"; },
      deleteBranch: async (id) => { deleted.push(id); return { ok: true, status: 200 }; },
      log: () => {},
    }),
    /remote unavailable/,
  );
  assert.deepEqual(deleted, []);
});

test("main, protected, default, primary, and root branches are preserved", async () => {
  const deleted = [];
  await pruneOrphanedPreviewBranches({
    branches: [
      preview("primary", "preview/main"),
      preview("protected", "preview/review/protected", { protected: true }),
      preview("default", "preview/review/default", { default: true }),
      preview("primary-flag", "preview/review/primary", { primary: true }),
      { id: "root", name: "preview/review/root" },
      { id: "non-preview", name: "main" },
    ],
    gitState: () => "missing",
    deleteBranch: async (id) => { deleted.push(id); return { ok: true, status: 200 }; },
    log: () => {},
  });
  assert.deepEqual(deleted, []);
});

test("lists all Neon pages using pagination.next before pruning", async () => {
  const calls = [];
  const branches = await listNeonBranches({
    projectId: "project",
    apiKey: "test",
    fetchImpl: async (url) => {
      calls.push(String(url));
      return calls.length === 1
        ? ok({ branches: [preview("one", "preview/one")], pagination: { next: "next-page" } })
        : ok({ branches: [preview("two", "preview/two")], pagination: {} });
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

test("preflight rejects unsafe branch names and roots", async () => {
  assert.throws(() => validatePreviewBranchName("preview/review;rm-rf"), /Invalid/);
  await assert.rejects(
    () => previewBranchExists({ projectId: "project", apiKey: "test", branchName: "preview/review/root", fetchImpl: async () => ok({ branches: [{ id: "root", name: "preview/review/root" }], pagination: {} }) }),
    /Refusing/,
  );
});

test("an authentication failure stops cleanup", async () => {
  await assert.rejects(
    () => listNeonBranches({ projectId: "project", apiKey: "bad", fetchImpl: async () => ({ ok: false, status: 401 }) }),
    /HTTP 401/,
  );
});
