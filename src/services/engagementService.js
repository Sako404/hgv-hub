import { newId } from "../domain/ids.js";

/** Cross-workspace, "my employment history" — analogous to shiftService.listShiftsForDriver. */
export async function listEngagementsForDriver(personId, db) {
  return db.engagements.query({ where: { driverId: personId } });
}

/** @param {string} workspaceId */
export async function listEngagementsForWorkspace(workspaceId, db) {
  return db.engagements.query({ where: { workspaceId } });
}

/**
 * @param {{workspaceId: string, driverId: string, providerOrganisationId: string, relationshipType: import('../domain/types.js').RelationshipType, startDate: string}} input
 */
export async function createEngagement(input, db) {
  return db.engagements.insert({
    id: newId("engagement"),
    providerOrganisationId: input.providerOrganisationId,
    workspaceId: input.workspaceId,
    driverId: input.driverId,
    relationshipType: input.relationshipType,
    startDate: input.startDate,
    endDate: null,
    status: "active",
  });
}

/**
 * Ends the employment/supply relationship — BLOCKS (throws) if any
 * Assignment through this Engagement is still active (endDate null)
 * or would outlive the new endDate, rather than silently ending or
 * cascading to those Assignments. The caller must end/adjust the
 * dependent Assignments first — this is a deliberate no-cascade rule
 * (Stage 4D decision), not an oversight.
 * @param {string} id
 * @param {string} endDate
 */
export async function endEngagement(id, endDate, db) {
  const assignments = await db.assignments.query({ where: { engagementId: id } });
  const blocking = assignments.filter((a) => a.endDate === null || a.endDate > endDate);
  if (blocking.length > 0) {
    throw new Error(
      `Cannot end this engagement — ${blocking.length} assignment(s) are still active or extend beyond ${endDate}. End those assignments first.`
    );
  }
  return db.engagements.update(id, { endDate, status: "ended" });
}
