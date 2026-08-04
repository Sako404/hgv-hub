import { newId } from "../domain/ids.js";

/** @param {string} workspaceId */
export async function listPlacementsForWorkspace(workspaceId, db) {
  return db.placements.query({ where: { workspaceId } });
}

/**
 * Every Placement for a workspace, each paired with its active
 * Assignment count — everything the list screen needs in one call,
 * without an N+1 fetch per placement. Mirrors
 * rateCardService.listRateCardLineagesForWorkspace's shape.
 * @param {string} workspaceId
 */
export async function listPlacementSummariesForWorkspace(workspaceId, db) {
  const placements = await listPlacementsForWorkspace(workspaceId, db);
  if (placements.length === 0) return [];
  const assignments = await db.assignments.query({
    where: { placementId: { in: placements.map((p) => p.id) } },
  });
  const activeCountByPlacement = new Map();
  for (const assignment of assignments) {
    if (assignment.endDate !== null) continue;
    activeCountByPlacement.set(assignment.placementId, (activeCountByPlacement.get(assignment.placementId) ?? 0) + 1);
  }
  return placements.map((placement) => ({
    placement,
    activeAssignmentCount: activeCountByPlacement.get(placement.id) ?? 0,
  }));
}

/**
 * Placement + how many Assignments currently reference it (active
 * only, endDate null) — everything the list screen needs without an
 * N+1 fetch per placement.
 * @param {string} id
 */
export async function getPlacementSummary(id, db) {
  const placement = await db.placements.getById(id);
  if (!placement) return null;
  const assignments = await db.assignments.query({ where: { placementId: id } });
  const activeCount = assignments.filter((a) => a.endDate === null).length;
  return { placement, activeAssignmentCount: activeCount, totalAssignmentCount: assignments.length };
}

/**
 * @param {{workspaceId: string, providerOrganisationId: string, siteId: string, rateCardLineageId: string, effectiveFrom: string}} input
 */
export async function createPlacement(input, db) {
  return db.placements.insert({
    id: newId("placement"),
    workspaceId: input.workspaceId,
    providerOrganisationId: input.providerOrganisationId,
    siteId: input.siteId,
    rateCardLineageId: input.rateCardLineageId,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: null,
    archivedAt: null,
    createdAt: new Date().toISOString(),
  });
}

/** Whether any Assignment has ever referenced this placement — the same check updatePlacement enforces, exposed for UI to show the "locked" state before a user attempts an edit. */
export async function placementHasAssignmentHistory(id, db) {
  const assignments = await db.assignments.query({ where: { placementId: id } });
  return assignments.length > 0;
}

/**
 * effectiveFrom/effectiveTo are always editable. `providerOrganisationId`/
 * `siteId`/`rateCardLineageId` are only editable while zero Assignments
 * have EVER referenced this placement — once referenced, re-parenting
 * would retroactively confuse historical Assignment -> Placement
 * chains, so it locks permanently. Mirrors siteService.updateSite's
 * identical rule for Site.organisationId.
 */
export async function updatePlacement(id, patch, db) {
  const lockedFields = ["providerOrganisationId", "siteId", "rateCardLineageId"];
  const touchesLockedField = lockedFields.some((field) => field in patch);
  if (touchesLockedField && (await placementHasAssignmentHistory(id, db))) {
    throw new Error(
      "This placement's provider/site/rate card can no longer be changed — it has already been referenced by an assignment."
    );
  }
  return db.placements.update(id, patch);
}

/**
 * Hides the placement from future Assignment pickers — BLOCKS
 * (throws) if any Assignment referencing it is still active (endDate
 * null), rather than silently archiving underneath live work. No
 * auto-ending of those Assignments (Stage 4D no-cascade rule); a
 * manager must end them individually first.
 * @param {string} id
 */
export async function archivePlacement(id, db) {
  const assignments = await db.assignments.query({ where: { placementId: id, endDate: null } });
  if (assignments.length > 0) {
    throw new Error(
      `Cannot archive this placement — ${assignments.length} assignment(s) are still active. End those assignments first.`
    );
  }
  return db.placements.update(id, { archivedAt: new Date().toISOString() });
}

export async function restorePlacement(id, db) {
  return db.placements.update(id, { archivedAt: null });
}
