import { newId } from "../domain/ids.js";

/**
 * Site has no direct workspaceId — it's scoped via its Organisation, so
 * this narrows by workspace-owned organisations first, then queries
 * sites by { organisationId: { in: [...] } }.
 * @param {string} workspaceId
 */
export async function listSitesForWorkspace(workspaceId, db) {
  const organisations = await db.organisations.query({ where: { workspaceId } });
  const organisationIds = organisations.map((o) => o.id);
  if (organisationIds.length === 0) return [];
  return db.sites.query({ where: { organisationId: { in: organisationIds } } });
}

/**
 * @param {{organisationId: string, name: string, kind?: 'hub'|'depot'|'client_site', address?: string, notes?: string}} input
 */
export async function createSite(input, db) {
  return db.sites.insert({
    id: newId("site"),
    organisationId: input.organisationId,
    name: input.name,
    kind: input.kind ?? "client_site",
    clientName: null,
    address: input.address ?? null,
    notes: input.notes ?? null,
    archivedAt: null,
  });
}

/**
 * Whether any Assignment (active or ended) has ever referenced this
 * site — the same check updateSite enforces, exposed for UI to show
 * the "locked" state before a user attempts an edit. Since Stage 4D,
 * Assignment no longer carries siteId directly — the chain is now
 * Site <- Placement <- Assignment, so this walks through Placement.
 */
export async function siteHasAssignmentHistory(siteId, db) {
  const placements = await db.placements.query({ where: { siteId } });
  if (placements.length === 0) return false;
  const assignments = await db.assignments.query({
    where: { placementId: { in: placements.map((p) => p.id) } },
  });
  return assignments.length > 0;
}

/**
 * name/address/notes are always editable. `organisationId` is only
 * editable while zero Assignments have EVER referenced this site
 * (active or ended) — once referenced, re-parenting would retroactively
 * confuse historical Assignment -> Site -> Organisation chains, so it
 * locks permanently. This is the only place that rule lives — not
 * generic repository code.
 */
export async function updateSite(id, patch, db) {
  if ("organisationId" in patch) {
    const existing = await db.sites.getById(id);
    if (existing.organisationId !== patch.organisationId && (await siteHasAssignmentHistory(id, db))) {
      throw new Error(
        "This site's organisation can no longer be changed — it has already been referenced by an Assignment."
      );
    }
  }
  return db.sites.update(id, patch);
}

export async function archiveSite(id, db) {
  return db.sites.update(id, { archivedAt: new Date().toISOString() });
}

export async function restoreSite(id, db) {
  return db.sites.update(id, { archivedAt: null });
}
