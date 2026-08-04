import { newId } from "../domain/ids.js";

/** All Loads for one Shift — used to price it and to repopulate the Add Shift form on edit. */
export async function listLoadsForShift(shiftId, db) {
  return db.loads.query({ where: { shiftId } });
}

/** Removes every Load a Shift owns, e.g. when the Shift itself is deleted or switched off per-load pay. */
export async function clearLoadsForShift(shiftId, db) {
  const existing = await listLoadsForShift(shiftId, db);
  await Promise.all(existing.map((l) => db.loads.remove(l.id)));
}

/**
 * Replaces every Load a Shift owns with a fresh set entered on the Add
 * Shift form. Plain CRUD, not append-only/versioned like RateCard —
 * see the Load typedef's doc comment — so a delete-then-reinsert on
 * every save is the correct, simplest model rather than diffing rows.
 * @param {string} shiftId
 * @param {string} workspaceId - the owning Shift's workspaceId
 * @param {{reference: string|null, description: string|null, amount: number, distanceMiles: number|null}[]} loads
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function replaceLoadsForShift(shiftId, workspaceId, loads, db) {
  await clearLoadsForShift(shiftId, db);
  const now = new Date().toISOString();
  return Promise.all(
    loads.map((l) =>
      db.loads.insert({
        id: newId("load"),
        workspaceId,
        shiftId,
        reference: l.reference || null,
        description: l.description || null,
        amount: Number(l.amount) || 0,
        distanceMiles: l.distanceMiles === null || l.distanceMiles === undefined ? null : Number(l.distanceMiles),
        createdAt: now,
      })
    )
  );
}

/**
 * Batch-resolves every Load needed to price a set of shifts, then
 * returns a plain synchronous lookup function — same shape/purpose as
 * rateCardService.buildRateCardResolver, so screens can render a
 * per-load shift's breakdown without an async call per row.
 * @param {import('../domain/types.js').Shift[]} shifts
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 * @returns {Promise<(shift: import('../domain/types.js').Shift) => import('../domain/types.js').Load[]>}
 */
export async function buildLoadsResolver(shifts, db) {
  const shiftIds = shifts.map((s) => s.id);
  const loads = shiftIds.length ? await db.loads.query({ where: { shiftId: { in: shiftIds } } }) : [];
  const byShiftId = new Map();
  for (const load of loads) {
    if (!byShiftId.has(load.shiftId)) byShiftId.set(load.shiftId, []);
    byShiftId.get(load.shiftId).push(load);
  }
  return (shift) => byShiftId.get(shift.id) ?? [];
}
