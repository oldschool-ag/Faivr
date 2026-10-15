import { spawnSync } from "node:child_process";
import { createHash, createPrivateKey, generateKeyPairSync, sign as edSign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/lib/companyOs/auth";
import { assertFunctionLeadAvailable, existingFunctionLead, latestVersionIsFunctionLead } from "../../scripts/company-os-function-leads.mjs";

/**
 * The importer accepts the appliance exporter's pack-bundle file (bundle-index.json,
 * manifest.json, package.tar.gz) and validates it offline against the publisher key,
 * with the permission strings taken verbatim (declared order, no re-sorting).
 */

const importer = fileURLToPath(new URL("../../scripts/import-company-os-bundle.mjs", import.meta.url));

function tarEntry(name: string, body: Buffer, type: "0" | "5" = "0"): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, "utf8");
  header.write(type === "5" ? "0000755\0" : "0000644\0", 100, "ascii");
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  header.write(body.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  header.write("00000000000\0", 136, "ascii");
  header.write("        ", 148, "ascii");
  header.write(type, 156, "ascii");
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512, 0);
  body.copy(padded);
  return Buffer.concat([header, padded]);
}

function tar(entries: Array<[string, Buffer, ("0" | "5")?]>): Buffer {
  return Buffer.concat([...entries.map(([name, body, type]) => tarEntry(name, body, type)), Buffer.alloc(1024, 0)]);
}

function digest(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

describe("importing a signed Truchsess bundle file into the store", () => {
  const modelId = "faivr.agent.example-reviewer";
  const version = "1.0.0";
  const permissions = ["workspace.read", "workspace.write", "exec.sandbox", "net.allowlist", "knowledge.read:example", "model.lane:standard"];
  const files: Array<[string, Buffer, ("0" | "5")?]> = [
    ["AGENT.md", Buffer.from("# Example reviewer\n")],
    ["agent-definition.json", Buffer.from(JSON.stringify({ agentDefinitionId: "agdef_example_reviewer", permissions }))],
    ["skills/", Buffer.alloc(0), "5"],
    // The exporter walks folders, so strategy precedes strategy-advisor even though
    // plain lexicographic ordering would put strategy-advisor first.
    ["skills/strategy/SKILL.md", Buffer.from("---\nname: strategy\n---\n")],
    ["skills/strategy-advisor/SKILL.md", Buffer.from("---\nname: strategy-advisor\n---\n")],
    ["tools/tool-policy.json", Buffer.from("{}")],
    ["workflows/example.md", Buffer.from("workflow")],
    ["docs/operator-guide.md", Buffer.from("guide")],
    ["assets/README.md", Buffer.from("assets")],
  ];
  const payload = gzipSync(tar(files), { level: 9 });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const der = publicKey.export({ type: "spki", format: "der" });
  const keyId = `ed25519-${createHash("sha256").update(der.subarray(der.length - 32)).digest("hex").slice(0, 16)}`;
  const contents = files.filter(([, , type]) => type !== "5").map(([path, body]) => ({ path, sha256: digest(body), bytes: body.length }));
  const unsigned = {
    schemaVersion: "faivr-portable-agent-bundle.v1", modelId, version, displayName: "Example reviewer", summary: "Reviews supplied artifacts.",
    publisher: { publisherId: "old-school", name: "Old School AG" }, packageDigest: `sha256:${digest(payload)}`, artifactBytes: payload.length, entrypoint: "agent-definition.json",
    companyOsCompatibility: { minVersion: "1.0.0", maxVersion: "1.999.999" }, permissions, dependencies: [], managedPaths: [`agents/${modelId}/${version}`], tenantDataIncluded: false,
    monthlyPrice: { billingPeriod: "month", amountCents: 1, stripePriceId: null, activationState: "price_required" }, contents,
  };
  const manifest = { ...unsigned, signature: { keyId, algorithm: "Ed25519", value: edSign(null, Buffer.from(canonicalJson(unsigned)), createPrivateKey(privateKey.export({ type: "pkcs8", format: "pem" }).toString())).toString("base64url") } };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  const index = { schemaVersion: "truchsess-signed-bundle-file.v1", modelId, version, packageDigest: manifest.packageDigest, artifactBytes: payload.length, manifestSha256: digest(manifestBytes), publisherKeyId: keyId, publicationState: "local_install" };

  function signedManifestBytes(input: typeof unsigned & Record<string, unknown>) {
    const signed = { ...input, signature: { keyId, algorithm: "Ed25519", value: edSign(null, Buffer.from(canonicalJson(input)), privateKey).toString("base64url") } };
    return Buffer.from(JSON.stringify(signed));
  }

  function signedBundle(input: typeof unsigned & Record<string, unknown>, packagePayload = payload) {
    const bytes = signedManifestBytes(input);
    const bundleIndex = { ...index, modelId: input.modelId, version: input.version, packageDigest: input.packageDigest, artifactBytes: packagePayload.length, manifestSha256: digest(bytes) };
    return tar([["bundle-index.json", Buffer.from(JSON.stringify(bundleIndex))], ["manifest.json", bytes], ["package.tar.gz", packagePayload]]);
  }

  function packageFor(packageFiles: typeof files) {
    const packagePayload = gzipSync(tar(packageFiles), { level: 9 });
    const packageContents = packageFiles.filter(([, , type]) => type !== "5").map(([path, body]) => ({ path, sha256: digest(body), bytes: body.length }));
    return {
      packagePayload,
      packageManifest: { ...unsigned, packageDigest: `sha256:${digest(packagePayload)}`, artifactBytes: packagePayload.length, contents: packageContents },
    };
  }

  function run(args: string[], env: Record<string, string>) {
    return spawnSync(process.execPath, [importer, ...args], { encoding: "utf8", env: { ...process.env, ...env, DATABASE_URL: "" } });
  }

  it("validates the pack-bundle file offline, keeping the permission strings verbatim", () => {
    const dir = mkdtempSync(join(tmpdir(), "faivr-import-"));
    const bundleFile = join(dir, `${modelId}-${version}.truchsess-bundle.tar`);
    writeFileSync(bundleFile, tar([["bundle-index.json", Buffer.from(JSON.stringify(index))], ["manifest.json", manifestBytes], ["package.tar.gz", payload]]));
    writeFileSync(join(dir, "publisher.pub"), publicPem);
    const result = run([bundleFile, "--release-notes", "Fixes the misleading report output."], { FAIVR_VALIDATE_ONLY: "1", FAIVR_PUBLISHER_PUBLIC_KEY_PATH: join(dir, "publisher.pub"), FAIVR_PACKAGE_ORIGIN: "https://store.faivr.test", FAIVR_STORE_ARTIFACT_INLINE: "1", FAIVR_STORE_BUNDLE: "design-review" });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout.trim());
    expect(report).toMatchObject({ valid: true, modelId, version, digest: manifest.packageDigest, permissions, bundle: "design-review", releaseNotes: "Fixes the misleading report output.", inlineArtifact: true });
    expect(report.artifactUrl).toBe(`https://store.faivr.test/company-os/v1/packages/${modelId}/${version}/${digest(payload)}.tar.gz`);
  });

  it("accepts signed extension fields with portable names, including routines and fooBar", () => {
    const dir = mkdtempSync(join(tmpdir(), "faivr-import-extensions-"));
    writeFileSync(join(dir, "publisher.pub"), publicPem);
    const bundleFile = join(dir, "extensions.truchsess-bundle.tar");
    const routines = [{ name: "weeklyReview", schedule: "0 9 * * 1", workflow: "workflows/example.md" }];
    writeFileSync(bundleFile, signedBundle({ ...unsigned, routines, fooBar: { enabled: true } }));
    const result = run([bundleFile], { FAIVR_VALIDATE_ONLY: "1", FAIVR_PUBLISHER_PUBLIC_KEY_PATH: join(dir, "publisher.pub"), FAIVR_PACKAGE_ORIGIN: "https://store.faivr.test", FAIVR_STORE_ARTIFACT_INLINE: "1" });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout.trim());
    expect(report).not.toHaveProperty("routines");
    expect(report).not.toHaveProperty("fooBar");
  });

  it("rejects invalid extension names and manifests over 256 KiB", () => {
    const dir = mkdtempSync(join(tmpdir(), "faivr-import-extension-limits-"));
    writeFileSync(join(dir, "publisher.pub"), publicPem);
    const env = { FAIVR_VALIDATE_ONLY: "1", FAIVR_PUBLISHER_PUBLIC_KEY_PATH: join(dir, "publisher.pub"), FAIVR_PACKAGE_ORIGIN: "https://store.faivr.test", FAIVR_STORE_ARTIFACT_INLINE: "1" };

    const badNameFile = join(dir, "bad-name.truchsess-bundle.tar");
    writeFileSync(badNameFile, signedBundle({ ...unsigned, "bad-name": true }));
    const badName = run([badNameFile], env);
    expect(badName.status).not.toBe(0);
    expect(badName.stderr).toContain("invalid manifest fields");

    const emptyExtensionBytes = signedManifestBytes({ ...unsigned, fooBar: "" });
    const exactPadding = 256 * 1024 - emptyExtensionBytes.length;
    const atLimitBytes = signedManifestBytes({ ...unsigned, fooBar: "x".repeat(exactPadding) });
    expect(atLimitBytes).toHaveLength(256 * 1024);
    const atLimitFile = join(dir, "at-limit.truchsess-bundle.tar");
    writeFileSync(atLimitFile, tar([["bundle-index.json", Buffer.from(JSON.stringify({ ...index, manifestSha256: digest(atLimitBytes) }))], ["manifest.json", atLimitBytes], ["package.tar.gz", payload]]));
    const atLimit = run([atLimitFile], env);
    expect(atLimit.status, atLimit.stderr).toBe(0);

    const oversizedBytes = signedManifestBytes({ ...unsigned, fooBar: "x".repeat(exactPadding + 1) });
    expect(oversizedBytes).toHaveLength(256 * 1024 + 1);
    const oversizedFile = join(dir, "oversized.truchsess-bundle.tar");
    writeFileSync(oversizedFile, tar([["bundle-index.json", Buffer.from(JSON.stringify({ ...index, manifestSha256: digest(oversizedBytes) }))], ["manifest.json", oversizedBytes], ["package.tar.gz", payload]]));
    const oversized = run([oversizedFile], env);
    expect(oversized.status).not.toBe(0);
    expect(oversized.stderr).toContain("portable manifest exceeds 262144 byte limit");
  });

  it("keeps extension fields and schemaVersion inside the publisher signature", () => {
    const dir = mkdtempSync(join(tmpdir(), "faivr-import-extension-signature-"));
    writeFileSync(join(dir, "publisher.pub"), publicPem);
    const env = { FAIVR_VALIDATE_ONLY: "1", FAIVR_PUBLISHER_PUBLIC_KEY_PATH: join(dir, "publisher.pub"), FAIVR_PACKAGE_ORIGIN: "https://store.faivr.test", FAIVR_STORE_ARTIFACT_INLINE: "1" };

    const signed = { ...unsigned, fooBar: "signed value" };
    const signature = { keyId, algorithm: "Ed25519", value: edSign(null, Buffer.from(canonicalJson(signed)), privateKey).toString("base64url") };
    const tamperedBytes = Buffer.from(JSON.stringify({ ...signed, fooBar: "tampered value", signature }));
    const tamperedFile = join(dir, "extension-tampered.truchsess-bundle.tar");
    writeFileSync(tamperedFile, tar([["bundle-index.json", Buffer.from(JSON.stringify({ ...index, manifestSha256: digest(tamperedBytes) }))], ["manifest.json", tamperedBytes], ["package.tar.gz", payload]]));
    const tampered = run([tamperedFile], env);
    expect(tampered.status).not.toBe(0);
    expect(tampered.stderr).toContain("invalid publisher signature");

    const v2File = join(dir, "v2.truchsess-bundle.tar");
    writeFileSync(v2File, signedBundle({ ...unsigned, schemaVersion: "faivr-portable-agent-bundle.v2" }));
    const v2 = run([v2File], env);
    expect(v2.status).not.toBe(0);
    expect(v2.stderr).toContain("invalid portable manifest identity");
  });

  it("accepts only boolean functionLead values while preserving legacy manifests", () => {
    const dir = mkdtempSync(join(tmpdir(), "faivr-import-function-lead-"));
    writeFileSync(join(dir, "publisher.pub"), publicPem);
    const env = { FAIVR_VALIDATE_ONLY: "1", FAIVR_PUBLISHER_PUBLIC_KEY_PATH: join(dir, "publisher.pub"), FAIVR_PACKAGE_ORIGIN: "https://store.faivr.test", FAIVR_STORE_ARTIFACT_INLINE: "1" };

    const legacyFile = join(dir, "legacy.truchsess-bundle.tar");
    writeFileSync(legacyFile, signedBundle(unsigned));
    const legacy = run([legacyFile], env);
    expect(legacy.status, legacy.stderr).toBe(0);
    expect(JSON.parse(legacy.stdout.trim())).not.toHaveProperty("functionLead");

    const leadFile = join(dir, "lead.truchsess-bundle.tar");
    writeFileSync(leadFile, signedBundle({ ...unsigned, functionLead: true }));
    const lead = run([leadFile], env);
    expect(lead.status, lead.stderr).toBe(0);
    expect(JSON.parse(lead.stdout.trim())).toMatchObject({ valid: true, functionLead: true });

    const nonLeadFile = join(dir, "non-lead.truchsess-bundle.tar");
    writeFileSync(nonLeadFile, signedBundle({ ...unsigned, functionLead: false }));
    const nonLead = run([nonLeadFile], env);
    expect(nonLead.status, nonLead.stderr).toBe(0);
    expect(JSON.parse(nonLead.stdout.trim())).not.toHaveProperty("functionLead");

    const invalidFunctionLeads = ["true", 1, null, {}, []];
    for (let position = 0; position < invalidFunctionLeads.length; position += 1) {
      const functionLead = invalidFunctionLeads[position];
      const invalidFile = join(dir, `invalid-${position}.truchsess-bundle.tar`);
      writeFileSync(invalidFile, signedBundle({ ...unsigned, functionLead }));
      const invalid = run([invalidFile], env);
      expect(invalid.status).not.toBe(0);
      expect(invalid.stderr).toContain("functionLead must be a boolean when present");
    }
  });

  it("keeps functionLead inside the publisher signature", () => {
    const dir = mkdtempSync(join(tmpdir(), "faivr-import-function-lead-signature-"));
    writeFileSync(join(dir, "publisher.pub"), publicPem);
    const signed = { ...unsigned, functionLead: true };
    const signature = { keyId, algorithm: "Ed25519", value: edSign(null, Buffer.from(canonicalJson(signed)), privateKey).toString("base64url") };
    const tampered = Buffer.from(JSON.stringify({ ...signed, functionLead: false, signature }));
    const bundleFile = join(dir, "tampered.truchsess-bundle.tar");
    writeFileSync(bundleFile, tar([["bundle-index.json", Buffer.from(JSON.stringify({ ...index, manifestSha256: digest(tampered) }))], ["manifest.json", tampered], ["package.tar.gz", payload]]));
    const result = run([bundleFile], { FAIVR_VALIDATE_ONLY: "1", FAIVR_PUBLISHER_PUBLIC_KEY_PATH: join(dir, "publisher.pub"), FAIVR_PACKAGE_ORIGIN: "https://store.faivr.test", FAIVR_STORE_ARTIFACT_INLINE: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("invalid publisher signature");
  });

  it("allows a newer version of the same lead package but names a different existing lead", async () => {
    const rows = [
      { package_id: modelId, version: "1.0.0", manifest: { functionLead: true } },
      { package_id: modelId, version: "1.0.1", manifest: { functionLead: true } },
      { package_id: "faivr.agent.support", version: "1.0.0", manifest: {} },
    ];
    expect(existingFunctionLead(rows)).toBe(modelId);
    expect(latestVersionIsFunctionLead(rows.filter((row) => row.package_id === modelId))).toBe(true);

    const samePackageClient = { query: async (sql: string) => ({ rows: sql.includes("company_os_bundle_packages") ? rows.filter((row) => row.package_id !== modelId) : [{ id: "build" }], rowCount: 1 }) };
    await expect(assertFunctionLeadAvailable(samePackageClient, "build", modelId)).resolves.toBeUndefined();

    const differentPackageClient = { query: async (sql: string) => ({ rows: sql.includes("company_os_bundle_packages") ? rows.filter((row) => row.package_id === modelId) : [{ id: "build" }], rowCount: 1 }) };
    await expect(assertFunctionLeadAvailable(differentPackageClient, "build", "faivr.agent.writer")).rejects.toThrow(`function bundle build already has function lead ${modelId}; cannot add faivr.agent.writer`);
  });

  it("reads release notes from the signed payload and reports null only when the file is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "faivr-import-release-notes-"));
    writeFileSync(join(dir, "publisher.pub"), publicPem);
    const env = { FAIVR_VALIDATE_ONLY: "1", FAIVR_PUBLISHER_PUBLIC_KEY_PATH: join(dir, "publisher.pub"), FAIVR_PACKAGE_ORIGIN: "https://store.faivr.test", FAIVR_STORE_ARTIFACT_INLINE: "1" };
    const notes = "# 1.0.0\n\n- Fixes the misleading report output.\n";
    const withNotes = packageFor([...files, ["docs/release-notes.md", Buffer.from(notes)]]);
    const withNotesFile = join(dir, "with-notes.truchsess-bundle.tar");
    writeFileSync(withNotesFile, signedBundle(withNotes.packageManifest, withNotes.packagePayload));
    const withNotesResult = run([withNotesFile], env);
    expect(withNotesResult.status, withNotesResult.stderr).toBe(0);
    expect(JSON.parse(withNotesResult.stdout.trim()).releaseNotes).toBe(notes);

    const absentFile = join(dir, "without-notes.truchsess-bundle.tar");
    writeFileSync(absentFile, signedBundle(unsigned));
    const absentResult = run([absentFile], env);
    expect(absentResult.status, absentResult.stderr).toBe(0);
    expect(JSON.parse(absentResult.stdout.trim()).releaseNotes).toBeNull();

    const emptyNotes = packageFor([...files, ["docs/release-notes.md", Buffer.alloc(0)]]);
    const emptyNotesFile = join(dir, "empty-notes.truchsess-bundle.tar");
    writeFileSync(emptyNotesFile, signedBundle(emptyNotes.packageManifest, emptyNotes.packagePayload));
    const emptyNotesResult = run([emptyNotesFile], env);
    expect(emptyNotesResult.status, emptyNotesResult.stderr).toBe(0);
    expect(JSON.parse(emptyNotesResult.stdout.trim()).releaseNotes).toBe("");
  });

  it("caps oversized payload release notes at a line boundary with an ellipsis", () => {
    const dir = mkdtempSync(join(tmpdir(), "faivr-import-long-release-notes-"));
    writeFileSync(join(dir, "publisher.pub"), publicPem);
    const firstLine = "A".repeat(600);
    const notes = `${firstLine}\n${"B".repeat(600)}`;
    const withNotes = packageFor([...files, ["docs/release-notes.md", Buffer.from(notes)]]);
    const bundleFile = join(dir, "long-notes.truchsess-bundle.tar");
    writeFileSync(bundleFile, signedBundle(withNotes.packageManifest, withNotes.packagePayload));
    const result = run([bundleFile], { FAIVR_VALIDATE_ONLY: "1", FAIVR_PUBLISHER_PUBLIC_KEY_PATH: join(dir, "publisher.pub"), FAIVR_PACKAGE_ORIGIN: "https://store.faivr.test", FAIVR_STORE_ARTIFACT_INLINE: "1" });
    expect(result.status, result.stderr).toBe(0);
    const releaseNotes = JSON.parse(result.stdout.trim()).releaseNotes as string;
    expect(releaseNotes).toBe(`${firstLine}…`);
    expect(Array.from(releaseNotes)).toHaveLength(601);
  });

  it("accepts the publisher's folder order but still rejects duplicate or missing contents paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "faivr-import-contents-"));
    writeFileSync(join(dir, "publisher.pub"), publicPem);
    const env = { FAIVR_VALIDATE_ONLY: "1", FAIVR_PUBLISHER_PUBLIC_KEY_PATH: join(dir, "publisher.pub"), FAIVR_PACKAGE_ORIGIN: "https://store.faivr.test", FAIVR_STORE_ARTIFACT_INLINE: "1" };
    const folderOrder = join(dir, "folder-order.truchsess-bundle.tar");
    writeFileSync(folderOrder, signedBundle(unsigned));
    expect(run([folderOrder], env).status).toBe(0);

    const duplicate = { ...unsigned, contents: [...contents.slice(0, -1), contents[0]] };
    const duplicateFile = join(dir, "duplicate.truchsess-bundle.tar");
    writeFileSync(duplicateFile, signedBundle(duplicate));
    const duplicateResult = run([duplicateFile], env);
    expect(duplicateResult.status).not.toBe(0);
    expect(duplicateResult.stderr).toContain("contents paths must be unique and include the entrypoint");

    const missingEntrypoint = { ...unsigned, contents: contents.filter((entry) => entry.path !== "agent-definition.json") };
    const missingEntrypointFile = join(dir, "missing-entrypoint.truchsess-bundle.tar");
    writeFileSync(missingEntrypointFile, signedBundle(missingEntrypoint));
    const missingEntrypointResult = run([missingEntrypointFile], env);
    expect(missingEntrypointResult.status).not.toBe(0);
    expect(missingEntrypointResult.stderr).toContain("contents must exhaustively enumerate regular files");
  });

  it("rejects contents reordered after the publisher signed the manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "faivr-import-reordered-"));
    writeFileSync(join(dir, "publisher.pub"), publicPem);
    const reordered = { ...manifest, contents: [...contents].reverse() };
    const bytes = Buffer.from(JSON.stringify(reordered));
    const bundleFile = join(dir, "reordered.truchsess-bundle.tar");
    writeFileSync(bundleFile, tar([["bundle-index.json", Buffer.from(JSON.stringify({ ...index, manifestSha256: digest(bytes) }))], ["manifest.json", bytes], ["package.tar.gz", payload]]));
    const result = run([bundleFile], { FAIVR_VALIDATE_ONLY: "1", FAIVR_PUBLISHER_PUBLIC_KEY_PATH: join(dir, "publisher.pub"), FAIVR_PACKAGE_ORIGIN: "https://store.faivr.test", FAIVR_STORE_ARTIFACT_INLINE: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("invalid publisher signature");
  });

  it("validates signed install slots and rejects invalid slot contracts", () => {
    const dir = mkdtempSync(join(tmpdir(), "faivr-import-slots-"));
    writeFileSync(join(dir, "publisher.pub"), publicPem);
    const slots = [
      { id: "product", question: "Which product does this product owner own?", kind: "product", required: true },
      { id: "code-repository", question: "Which repository holds the product's code and documents (read only)?", kind: "repository", required: false },
    ];
    const signManifest = (input: Record<string, unknown>) => {
      const signed = { ...input, signature: { keyId, algorithm: "Ed25519", value: edSign(null, Buffer.from(canonicalJson(input)), privateKey).toString("base64url") } };
      const bytes = Buffer.from(JSON.stringify(signed));
      const bundleIndex = { ...index, manifestSha256: digest(bytes) };
      return tar([["bundle-index.json", Buffer.from(JSON.stringify(bundleIndex))], ["manifest.json", bytes], ["package.tar.gz", payload]]);
    };
    const valid = { ...unsigned, permissions: ["workspace.read", "repo.read:{code-repository}", "knowledge.read:{product}"], slots };
    const validFile = join(dir, "slots-valid.truchsess-bundle.tar");
    writeFileSync(validFile, signManifest(valid));
    const env = { FAIVR_VALIDATE_ONLY: "1", FAIVR_PUBLISHER_PUBLIC_KEY_PATH: join(dir, "publisher.pub"), FAIVR_PACKAGE_ORIGIN: "https://store.faivr.test", FAIVR_STORE_ARTIFACT_INLINE: "1" };
    expect(run([validFile], env).status).toBe(0);
    const invalid = [
      { ...valid, slots: [{ ...slots[0], extra: true }] },
      { ...valid, slots: [{ ...slots[0], id: "Bad_id" }] },
      { ...valid, slots: [{ ...slots[0], kind: "other" }] },
      { ...valid, permissions: ["repo.read:{missing}"], slots },
      { ...valid, slots: [slots[0], slots[0]] },
    ];
    for (let position = 0; position < invalid.length; position += 1) {
      const candidate = invalid[position];
      const file = join(dir, `slots-invalid-${position}.truchsess-bundle.tar`);
      writeFileSync(file, signManifest(candidate));
      expect(run([file], env).status).not.toBe(0);
    }
    const signed = { ...valid, signature: { keyId, algorithm: "Ed25519", value: edSign(null, Buffer.from(canonicalJson(valid)), privateKey).toString("base64url") } };
    const altered = { ...signed, slots: [{ ...slots[0], question: "A changed question" }, slots[1]] };
    const alteredBytes = Buffer.from(JSON.stringify(altered));
    const alteredIndex = { ...index, manifestSha256: digest(alteredBytes) };
    const alteredFile = join(dir, "slots-tampered.truchsess-bundle.tar");
    writeFileSync(alteredFile, tar([["bundle-index.json", Buffer.from(JSON.stringify(alteredIndex))], ["manifest.json", alteredBytes], ["package.tar.gz", payload]]));
    const tamperedResult = run([alteredFile], env);
    expect(tamperedResult.status).not.toBe(0);
    expect(tamperedResult.stderr).toContain("invalid publisher signature");
  });

  it("accepts extensible permission names and rejects malformed or duplicate values", () => {
    const dir = mkdtempSync(join(tmpdir(), "faivr-import-permissions-"));
    writeFileSync(join(dir, "publisher.pub"), publicPem);
    const env = { FAIVR_VALIDATE_ONLY: "1", FAIVR_PUBLISHER_PUBLIC_KEY_PATH: join(dir, "publisher.pub"), FAIVR_PACKAGE_ORIGIN: "https://store.faivr.test", FAIVR_STORE_ARTIFACT_INLINE: "1" };
    const allowed = join(dir, "permissions-allowed.truchsess-bundle.tar");
    writeFileSync(allowed, signedBundle({ ...unsigned, permissions: [...permissions, "mail.read", "mail.draft", "mail.send", "delegate:Fixture"] }));
    const allowedResult = run([allowed], env);
    expect(allowedResult.status, allowedResult.stderr).toBe(0);
    const invalidPermissions = ["Workspace.read", "workspace read", "1workspace.read", "workspace.read:", "workspace.read:has space", `workspace.read:${"x".repeat(201)}`];
    for (let position = 0; position < invalidPermissions.length; position += 1) {
      const invalidFile = join(dir, `permissions-invalid-${position}.truchsess-bundle.tar`);
      writeFileSync(invalidFile, signedBundle({ ...unsigned, permissions: [...permissions, invalidPermissions[position]] }));
      const invalid = run([invalidFile], env);
      expect(invalid.status).not.toBe(0);
      expect(invalid.stderr).toContain("permissions must be unique strings in portable permission format");
    }
    const duplicateFile = join(dir, "permissions-duplicate.truchsess-bundle.tar");
    writeFileSync(duplicateFile, signedBundle({ ...unsigned, permissions: [...permissions, permissions[0]] }));
    const duplicate = run([duplicateFile], env);
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain("permissions must be unique strings in portable permission format");
  });

  it("refuses a bundle whose payload was swapped or whose signature does not verify", () => {
    const dir = mkdtempSync(join(tmpdir(), "faivr-import-bad-"));
    writeFileSync(join(dir, "publisher.pub"), publicPem);
    const swapped = join(dir, "swapped.truchsess-bundle.tar");
    writeFileSync(swapped, tar([["bundle-index.json", Buffer.from(JSON.stringify(index))], ["manifest.json", manifestBytes], ["package.tar.gz", gzipSync(tar([["AGENT.md", Buffer.from("other")], ["agent-definition.json", Buffer.from("{}")]]))]]));
    let result = run([swapped], { FAIVR_VALIDATE_ONLY: "1", FAIVR_PUBLISHER_PUBLIC_KEY_PATH: join(dir, "publisher.pub"), FAIVR_PACKAGE_ORIGIN: "https://store.faivr.test", FAIVR_STORE_ARTIFACT_INLINE: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("packageDigest does not match");
    const otherKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    writeFileSync(join(dir, "other.pub"), otherKey);
    const good = join(dir, "good.truchsess-bundle.tar");
    writeFileSync(good, tar([["bundle-index.json", Buffer.from(JSON.stringify(index))], ["manifest.json", manifestBytes], ["package.tar.gz", payload]]));
    result = run([good], { FAIVR_VALIDATE_ONLY: "1", FAIVR_PUBLISHER_PUBLIC_KEY_PATH: join(dir, "other.pub"), FAIVR_PACKAGE_ORIGIN: "https://store.faivr.test", FAIVR_STORE_ARTIFACT_INLINE: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("invalid publisher signature");
    // a foreign member in the bundle file is refused before anything is read
    const foreign = join(dir, "foreign.truchsess-bundle.tar");
    writeFileSync(foreign, tar([["bundle-index.json", Buffer.from(JSON.stringify(index))], ["manifest.json", manifestBytes], ["package.tar.gz", payload], ["extra.txt", Buffer.from("x")]]));
    result = run([foreign], { FAIVR_VALIDATE_ONLY: "1", FAIVR_PUBLISHER_PUBLIC_KEY_PATH: join(dir, "publisher.pub"), FAIVR_PACKAGE_ORIGIN: "https://store.faivr.test", FAIVR_STORE_ARTIFACT_INLINE: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("foreign member");
  });
});
