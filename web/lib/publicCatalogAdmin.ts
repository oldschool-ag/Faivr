import type { PoolClient } from "pg";
type AdminDb = Pick<PoolClient, "query">;

// Administrative CLI only. These functions are not exposed by a public route.
export async function renamePublicPublisher(db: AdminDb, keyId: string, name: string) {
  if (!keyId.trim() || !name.trim()) throw new Error("Publisher key and name are required");
  const result = await db.query("UPDATE company_os_publishers SET name=$2 WHERE key_id=$1 RETURNING key_id,name", [keyId, name]);
  if (result.rows.length !== 1) throw new Error("Publisher key was not found; no publisher was created");
  return result.rows[0];
}

export async function setBundlePublic(db: AdminDb, bundleId: string, published: boolean) {
  await db.query("BEGIN");
  try {
    const bundles = await db.query("SELECT id,status FROM company_os_function_bundles WHERE id=$1", [bundleId]);
    if (!bundles.rows.length) throw new Error("Bundle not found");
    if (published) {
      if (bundles.rows[0].status !== "active") throw new Error("Only an active bundle can be made public");
      const members = await db.query("SELECT package_id FROM company_os_bundle_packages WHERE bundle_id=$1", [bundleId]);
      if (!members.rows.length) throw new Error("An empty bundle cannot be made public");
      for (const member of members.rows) {
        const versions = await db.query(`
          SELECT p.id FROM company_os_packages p
          JOIN company_os_package_versions v ON v.package_id=p.id
          JOIN company_os_publishers pub ON pub.key_id=v.publisher_key_id
          JOIN company_os_package_artifacts a ON a.version_id=v.id AND a.artifact_sha256=v.artifact_sha256
          WHERE p.id=$1 AND p.status='active' AND v.status='published'
            AND v.publisher_signature<>'' AND pub.status='active' AND pub.name IS NOT NULL
        `, [member.package_id]);
        if (!versions.rows.length) throw new Error(`Package ${member.package_id} needs a published signed version, active publisher and stored bundle first`);
      }
      // Explicitly publishing a bundle also publishes its validated membership.
      // Hiding a bundle does not hide packages used by another public bundle.
      for (const member of members.rows) {
        await db.query("UPDATE company_os_packages SET public_listing=true WHERE id=$1", [member.package_id]);
      }
    }
    await db.query("UPDATE company_os_function_bundles SET public_listing=$2 WHERE id=$1", [bundleId, published]);
    await db.query("COMMIT");
    return { bundleId, publicListing: published };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
