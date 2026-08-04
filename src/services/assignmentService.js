import { newId } from "../domain/ids.js";
import { resolveEffectiveRateCard } from "./rateCardService.js";

/**
 * Resolves the driver's currently-active assignments (engagement status
 * === "active", assignment open-ended) across ALL their workspaces,
 * with the CURRENTLY effective rate card / site / organisations eagerly
 * resolved (via the assignment's placement, resolved as of today — this
 * is a live "what applies right now" view for the Add Shift form; the
 * actual pinned value for a saved Shift is resolved separately, per its
 * own date, in shiftService.js). This is what "no forced company-
 * management screens" looks like for a solo driver: zero active
 * assignments -> shifts are logged unpriced against the driver's own
 * personal workspace; exactly one -> used silently, same zero-friction
 * UX as before the refactor; more than one -> an extra picker field.
 *
 * Resolves TWO distinct organisations, not one — Placement.siteId's
 * Site.organisationId is the CLIENT the site belongs to (e.g. Example Logistics),
 * while Engagement.providerOrganisationId is who employs/supplies the
 * driver (e.g. Example Driver Agency). A "Example Driver Agency · Example Logistics Depot A" style
 * label needs `employerOrganisation`, not `siteOrganisation`.
 *
 * Return shape is intentionally unchanged from the pre-Stage-4D
 * version (Site/RateCardLineage now resolved via Placement internally,
 * invisibly) — DriverApp's Add Shift form needs zero changes.
 * @param {string} personId
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function resolveActiveAssignmentsForDriver(personId, db) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const activeEngagements = await db.engagements.query({
    where: { driverId: personId, status: "active" },
  });
  const resolved = await Promise.all(
    activeEngagements.map(async (engagement) => {
      const assignments = await db.assignments.query({
        where: { engagementId: engagement.id, endDate: null },
      });
      const assignment = assignments[0];
      if (!assignment) return null;
      const placement = await db.placements.getById(assignment.placementId);
      if (!placement) return null;
      const [rateCard, site, employerOrganisation] = await Promise.all([
        resolveEffectiveRateCard(placement.rateCardLineageId, todayKey, db),
        db.sites.getById(placement.siteId),
        db.organisations.getById(engagement.providerOrganisationId),
      ]);
      const siteOrganisation = site ? await db.organisations.getById(site.organisationId) : null;
      return { engagement, assignment, rateCard, site, employerOrganisation, siteOrganisation };
    })
  );
  return resolved.filter(Boolean);
}

/** "Who's currently on this placement" — the point of the Placement/Assignment split. */
export async function listAssignmentsForPlacement(placementId, db) {
  return db.assignments.query({ where: { placementId } });
}

/**
 * Both-boundary containment: the Assignment's start AND end must fit
 * within both its Engagement's and its Placement's effective windows.
 * Deliberately does NOT check for overlap against sibling Assignments
 * — a driver may legitimately hold multiple concurrently-active
 * Assignments (e.g. two agencies, or two placements at once).
 */
function validateAssignmentDates(engagement, placement, startDate, endDate) {
  if (startDate < engagement.startDate) {
    throw new Error("Assignment cannot start before its engagement starts.");
  }
  if (engagement.endDate !== null && startDate > engagement.endDate) {
    throw new Error("Assignment cannot start after its engagement has ended.");
  }
  if (endDate !== null && engagement.endDate !== null && endDate > engagement.endDate) {
    throw new Error("Assignment cannot end after its engagement has ended.");
  }
  if (startDate < placement.effectiveFrom) {
    throw new Error("Assignment cannot start before its placement becomes effective.");
  }
  if (placement.effectiveTo !== null && startDate > placement.effectiveTo) {
    throw new Error("Assignment cannot start after its placement's effective period has ended.");
  }
  if (endDate !== null && placement.effectiveTo !== null && endDate > placement.effectiveTo) {
    throw new Error("Assignment cannot end after its placement's effective period has ended.");
  }
}

/**
 * Links a driver's Engagement to a shared Placement. Validates:
 * (1) provider compatibility — the Engagement's provider organisation
 * must match the Placement's, so an agency's engagement can never be
 * accidentally attached to a different agency's placement; (2) both
 * start/end boundaries fit within both parents' effective windows.
 * @param {{engagementId: string, placementId: string, startDate: string, endDate?: string|null}} input
 */
export async function createAssignment(input, db) {
  const [engagement, placement] = await Promise.all([
    db.engagements.getById(input.engagementId),
    db.placements.getById(input.placementId),
  ]);
  if (!engagement) throw new Error("Engagement not found");
  if (!placement) throw new Error("Placement not found");
  if (engagement.providerOrganisationId !== placement.providerOrganisationId) {
    throw new Error(
      "This engagement's provider organisation does not match this placement's provider organisation."
    );
  }
  const endDate = input.endDate ?? null;
  validateAssignmentDates(engagement, placement, input.startDate, endDate);

  return db.assignments.insert({
    id: newId("assignment"),
    engagementId: input.engagementId,
    placementId: input.placementId,
    startDate: input.startDate,
    endDate,
  });
}

/**
 * Ends this driver's stint on the placement — the Placement itself
 * (and every other driver's Assignment onto it) is unaffected. No
 * "reactivate": a new stint after a gap is a new Assignment row, so
 * history stays unambiguous.
 * @param {string} id
 * @param {string} endDate
 */
export async function endAssignment(id, endDate, db) {
  const assignment = await db.assignments.getById(id);
  if (!assignment) throw new Error("Assignment not found");
  const [engagement, placement] = await Promise.all([
    db.engagements.getById(assignment.engagementId),
    db.placements.getById(assignment.placementId),
  ]);
  validateAssignmentDates(engagement, placement, assignment.startDate, endDate);
  return db.assignments.update(id, { endDate });
}
