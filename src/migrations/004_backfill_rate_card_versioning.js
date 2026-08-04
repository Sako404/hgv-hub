import { resolveEffectiveRateCard } from "../services/rateCardService.js";

/**
 * One-time upgrade of RateCard/Assignment/Shift rows created by an
 * earlier deployment of this app, before RateCard gained append-only
 * lineage/version and Shift gained a pinned `rateCardId`. Every step
 * is guarded on "already new-shape", so this safely no-ops for rows
 * an already-updated migration 002 (or seedSecondCompany) created
 * directly in the new shape — restart-safe the same way as migration
 * 003: idempotent steps + the outer SCHEMA_VERSION gate in
 * migrations/index.js.
 *
 * This is the ONLY place the old "assignment.rateCardId points
 * directly at one RateCard row" lookup is used to resolve a Shift's
 * price. Normal application code (rateCardService.resolveRateCardForShift)
 * never falls back to it after this migration runs — historical pay
 * must never depend on resolving the currently active assignment/rate.
 * @param {ReturnType<typeof import('../storage/db.js').createIndexedDbDb>} db
 */
export async function migration004BackfillRateCardVersioning(db) {
  // 1. Every RateCard row that predates lineage/version fields becomes
  //    the first (and so far only) version of its own lineage.
  const allRateCards = await db.rateCards.getAll();
  for (const rateCard of allRateCards) {
    if (rateCard.lineageId) continue;
    await db.rateCards.update(rateCard.id, {
      lineageId: rateCard.id,
      version: 1,
      supersedesId: null,
    });
  }

  // 2. Every Assignment row still pointing directly at one RateCard id
  //    (the old shape) now references that RateCard's lineage instead.
  const allAssignments = await db.assignments.getAll();
  for (const assignment of allAssignments) {
    if (assignment.rateCardLineageId) continue;
    const oldRateCardId = assignment.rateCardId;
    if (!oldRateCardId) continue;
    const rateCard = await db.rateCards.getById(oldRateCardId);
    await db.assignments.update(assignment.id, {
      rateCardLineageId: rateCard ? rateCard.lineageId ?? rateCard.id : null,
    });
  }

  // 3. Pin every existing Shift's rateCardId via the (now-upgraded)
  //    assignment chain. Legacy shifts may use this live-assignment
  //    lookup once, here, solely to backfill rateCardId — after this
  //    migration, normal historical calculation never uses it again.
  const allShifts = await db.shifts.getAll();
  for (const shift of allShifts) {
    if (shift.rateCardId || !shift.assignmentId) continue;
    const assignment = await db.assignments.getById(shift.assignmentId);
    if (!assignment?.rateCardLineageId) continue;
    const rateCard = await resolveEffectiveRateCard(assignment.rateCardLineageId, shift.date, db);
    if (rateCard) {
      await db.shifts.update(shift.id, { rateCardId: rateCard.id });
    }
  }
}
