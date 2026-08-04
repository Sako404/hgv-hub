/**
 * Additive schema foundation for Part 4 (operational master data —
 * Organisations, Sites, Drivers, Engagements, Assignments, Rate Cards).
 * Every field added here is nullable/inert until its own Part 4 stage's
 * service/UI actually uses it, so this single migration covers the
 * whole phase's schema needs rather than one bump per stage. Every
 * step is guarded on "does this row already have the new shape",
 * making a from-scratch retry after a partial failure harmless — same
 * restart-safety pattern as migrations 003/004.
 * @param {ReturnType<typeof import('../storage/db.js').createIndexedDbDb>} db
 */
export async function migration005AddMasterDataFoundation(db) {
  // 1. Organisations: types[] inferred from the owning workspace's kind
  //    (unambiguous today — exactly one org per workspace before Part 4).
  const organisations = await db.organisations.getAll();
  const workspaceKindCache = new Map();
  for (const organisation of organisations) {
    if (organisation.types) continue;
    let workspaceKind = workspaceKindCache.get(organisation.workspaceId);
    if (workspaceKind === undefined) {
      const workspace = await db.workspaces.getById(organisation.workspaceId);
      workspaceKind = workspace?.kind ?? "other";
      workspaceKindCache.set(organisation.workspaceId, workspaceKind);
    }
    const inferredType = workspaceKind === "agency" || workspaceKind === "transport_company" ? workspaceKind : "other";
    await db.organisations.update(organisation.id, { types: [inferredType], archivedAt: null });
  }

  // 2. Sites: archivedAt/address/notes.
  const sites = await db.sites.getAll();
  for (const site of sites) {
    if ("archivedAt" in site) continue;
    await db.sites.update(site.id, { archivedAt: null, address: null, notes: null });
  }

  // 3. Memberships: archivedAt.
  const memberships = await db.memberships.getAll();
  for (const membership of memberships) {
    if ("archivedAt" in membership) continue;
    await db.memberships.update(membership.id, { archivedAt: null });
  }

  // 4. DriverProfiles: lastUsedAssignmentId.
  const driverProfiles = await db.driverProfiles.getAll();
  for (const driverProfile of driverProfiles) {
    if ("lastUsedAssignmentId" in driverProfile) continue;
    await db.driverProfiles.update(driverProfile.id, { lastUsedAssignmentId: null });
  }

  // 5. RateCardLineages (new store): one row per distinct lineageId
  //    already present across the existing RateCard versions.
  const rateCards = await db.rateCards.getAll();
  const versionsByLineage = new Map();
  for (const rateCard of rateCards) {
    const versions = versionsByLineage.get(rateCard.lineageId) ?? [];
    versions.push(rateCard);
    versionsByLineage.set(rateCard.lineageId, versions);
  }
  const now = new Date().toISOString();
  for (const [lineageId, versions] of versionsByLineage) {
    if (await db.rateCardLineages.getById(lineageId)) continue;
    const v1 = versions.find((v) => v.version === 1) ?? versions[0];
    await db.rateCardLineages.insert({
      id: lineageId,
      workspaceId: v1.workspaceId,
      name: v1.name ?? "",
      archivedAt: null,
      createdAt: now,
    });
  }
}
