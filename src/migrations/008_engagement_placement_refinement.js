/**
 * Stage 4D: introduces the shared Placement entity and thins Assignment
 * down to a per-driver link, so multiple drivers can reference the
 * SAME provider+site+rate configuration instead of each duplicating it
 * (e.g. Alex and John both working Example Driver Agency -> Example Logistics Depot A on
 * the same rate lineage share one Placement row).
 *
 * Three guarded, idempotent passes — a from-scratch retry after a
 * partial failure only ever re-checks/no-ops already-migrated rows,
 * same restart-safety pattern as migrations 003-007:
 *
 * 1. Engagement rename backfill: providerOrganisationId <-
 *    employerOrganisationId, relationshipType <- role. Straight
 *    copies, old fields left in place and never deleted (same
 *    convention as every prior migration's renames).
 * 2. Placement derivation: for every distinct (providerOrganisationId,
 *    siteId, rateCardLineageId) triple found across existing
 *    Assignment rows (provider resolved via the Assignment's
 *    Engagement), insert one Placement row with a DETERMINISTIC id
 *    derived from the triple itself (not a fresh random id, and never
 *    an existing Assignment's id) — this makes step 2 naturally
 *    idempotent: re-deriving the same triple always yields the same
 *    id, so a getById check is enough to skip re-insertion.
 * 3. Assignment patch: every existing Assignment gains `placementId`
 *    (pointing at the Placement derived from its own triple) without
 *    its `id` ever changing or being reinserted — so Shift.assignmentId
 *    requires zero rewrites and keeps resolving correctly. `siteId`/
 *    `rateCardLineageId` are left in place on the old row (unused by
 *    new code, but needed so a from-scratch retry can re-derive the
 *    same Placement id).
 *
 * Shift.assignmentId and Shift.rateCardId are never written to by this
 * migration — only Engagement and Assignment rows are touched — so
 * historical pay (including the real Alex/Example Driver Agency/Example Logistics
 * Depot A £118.35 regression figure) is structurally unaffected, not
 * just tested to be unaffected.
 * @param {ReturnType<typeof import('../storage/db.js').createIndexedDbDb>} db
 */
export async function migration008EngagementPlacementRefinement(db) {
  const engagements = await db.engagements.getAll();
  for (const engagement of engagements) {
    const patch = {};
    if (!engagement.providerOrganisationId) patch.providerOrganisationId = engagement.employerOrganisationId;
    if (!engagement.relationshipType) patch.relationshipType = engagement.role;
    if (Object.keys(patch).length > 0) {
      await db.engagements.update(engagement.id, patch);
    }
  }

  const engagementById = new Map((await db.engagements.getAll()).map((e) => [e.id, e]));
  const now = new Date().toISOString();

  const assignments = await db.assignments.getAll();
  for (const assignment of assignments) {
    if (assignment.placementId) continue; // already migrated
    if (!assignment.siteId || !assignment.rateCardLineageId) continue; // defensive: not a pre-4D-shaped row

    const engagement = engagementById.get(assignment.engagementId);
    if (!engagement) continue; // defensive: orphaned assignment, nothing to derive a provider from

    const providerOrganisationId = engagement.providerOrganisationId;
    const placementId = derivePlacementId(providerOrganisationId, assignment.siteId, assignment.rateCardLineageId);

    const existingPlacement = await db.placements.getById(placementId);
    if (!existingPlacement) {
      await db.placements.insert({
        id: placementId,
        workspaceId: engagement.workspaceId,
        providerOrganisationId,
        siteId: assignment.siteId,
        rateCardLineageId: assignment.rateCardLineageId,
        effectiveFrom: assignment.startDate,
        effectiveTo: null,
        archivedAt: null,
        createdAt: now,
      });
    }

    await db.assignments.update(assignment.id, { placementId });
  }
}

/** Deterministic, collision-safe (namespaced) Placement id — never reused from any Assignment id. */
function derivePlacementId(providerOrganisationId, siteId, rateCardLineageId) {
  return `placement-${providerOrganisationId}-${siteId}-${rateCardLineageId}`;
}
