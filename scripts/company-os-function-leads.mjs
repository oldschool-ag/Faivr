function compareSemver(a, b) {
  const parse = (value) => {
    const clean = value.split("+", 1)[0];
    const dash = clean.indexOf("-");
    return { core: (dash < 0 ? clean : clean.slice(0, dash)).split(".").map((part) => Number.parseInt(part, 10) || 0), prerelease: dash < 0 ? [] : clean.slice(dash + 1).split(".") };
  };
  const [left, right] = [parse(a), parse(b)];
  for (let index = 0; index < 3; index += 1) if ((left.core[index] ?? 0) !== (right.core[index] ?? 0)) return (left.core[index] ?? 0) - (right.core[index] ?? 0);
  if (!left.prerelease.length || !right.prerelease.length) return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length ? -1 : 1;
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const [x, y] = [left.prerelease[index], right.prerelease[index]];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const [xn, yn] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (xn && yn) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function manifestOf(row) {
  if (typeof row.manifest === "string") return JSON.parse(row.manifest);
  return row.manifest && typeof row.manifest === "object" ? row.manifest : {};
}

export function latestVersionIsFunctionLead(rows) {
  const latest = rows.reduce((current, row) => !current || compareSemver(row.version, current.version) > 0 ? row : current, null);
  return latest !== null && manifestOf(latest).functionLead === true;
}

export function existingFunctionLead(rows) {
  const byPackage = new Map();
  for (const row of rows) {
    const current = byPackage.get(row.package_id);
    if (!current || compareSemver(row.version, current.version) > 0) byPackage.set(row.package_id, row);
  }
  return [...byPackage.entries()]
    .filter(([, row]) => manifestOf(row).functionLead === true)
    .map(([packageId]) => packageId)
    .sort()[0] ?? null;
}

export async function assertFunctionLeadAvailable(client, bundleId, candidatePackageId) {
  await client.query("SELECT id FROM company_os_function_bundles WHERE id=$1 FOR UPDATE", [bundleId]);
  const versions = await client.query(
    "SELECT bp.package_id,v.version,v.manifest FROM company_os_bundle_packages bp JOIN company_os_package_versions v ON v.package_id=bp.package_id AND v.status='published' WHERE bp.bundle_id=$1 AND bp.package_id<>$2",
    [bundleId, candidatePackageId],
  );
  const existing = existingFunctionLead(versions.rows);
  if (existing) throw new Error(`function bundle ${bundleId} already has function lead ${existing}; cannot add ${candidatePackageId}`);
}
