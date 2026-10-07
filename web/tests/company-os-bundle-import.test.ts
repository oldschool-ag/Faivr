import { spawnSync } from "node:child_process";
import { createHash, createPrivateKey, generateKeyPairSync, sign as edSign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/lib/companyOs/auth";

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
    ["skills/example/SKILL.md", Buffer.from("---\nname: example\n---\n")],
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
  const contents = files.filter(([, , type]) => type !== "5").map(([path, body]) => ({ path, sha256: digest(body), bytes: body.length })).sort((a, b) => (a.path < b.path ? -1 : 1));
  const unsigned = {
    schemaVersion: "faivr-portable-agent-bundle.v1", modelId, version, displayName: "Example reviewer", summary: "Reviews supplied artifacts.",
    publisher: { publisherId: "old-school", name: "Old School AG" }, packageDigest: `sha256:${digest(payload)}`, artifactBytes: payload.length, entrypoint: "agent-definition.json",
    companyOsCompatibility: { minVersion: "1.0.0", maxVersion: "1.999.999" }, permissions, dependencies: [], managedPaths: [`agents/${modelId}/${version}`], tenantDataIncluded: false,
    monthlyPrice: { billingPeriod: "month", amountCents: 1, stripePriceId: null, activationState: "price_required" }, contents,
  };
  const manifest = { ...unsigned, signature: { keyId, algorithm: "Ed25519", value: edSign(null, Buffer.from(canonicalJson(unsigned)), createPrivateKey(privateKey.export({ type: "pkcs8", format: "pem" }).toString())).toString("base64url") } };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  const index = { schemaVersion: "truchsess-signed-bundle-file.v1", modelId, version, packageDigest: manifest.packageDigest, artifactBytes: payload.length, manifestSha256: digest(manifestBytes), publisherKeyId: keyId, publicationState: "local_install" };

  function run(args: string[], env: Record<string, string>) {
    return spawnSync(process.execPath, [importer, ...args], { encoding: "utf8", env: { ...process.env, ...env, DATABASE_URL: "" } });
  }

  it("validates the pack-bundle file offline, keeping the permission strings verbatim", () => {
    const dir = mkdtempSync(join(tmpdir(), "faivr-import-"));
    const bundleFile = join(dir, `${modelId}-${version}.truchsess-bundle.tar`);
    writeFileSync(bundleFile, tar([["bundle-index.json", Buffer.from(JSON.stringify(index))], ["manifest.json", manifestBytes], ["package.tar.gz", payload]]));
    writeFileSync(join(dir, "publisher.pub"), publicPem);
    const result = run([bundleFile], { FAIVR_VALIDATE_ONLY: "1", FAIVR_PUBLISHER_PUBLIC_KEY_PATH: join(dir, "publisher.pub"), FAIVR_PACKAGE_ORIGIN: "https://store.faivr.test", FAIVR_STORE_ARTIFACT_INLINE: "1", FAIVR_STORE_BUNDLE: "design-review" });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout.trim());
    expect(report).toMatchObject({ valid: true, modelId, version, digest: manifest.packageDigest, permissions, bundle: "design-review", inlineArtifact: true });
    expect(report.artifactUrl).toBe(`https://store.faivr.test/company-os/v1/packages/${modelId}/${version}/${digest(payload)}.tar.gz`);
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
