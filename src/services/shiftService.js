import { newId } from "../domain/ids.js";
import { parseDateTime } from "./shiftMath.js";
import { computeShiftBreakdown } from "./payEngine.js";
import { buildRateCardResolver, resolveRateCardIdForContext } from "./rateCardService.js";
import { buildLoadsResolver, clearLoadsForShift, replaceLoadsForShift } from "./loadService.js";

function byStartAsc(a, b) {
  return parseDateTime(a.date, a.start) - parseDateTime(b.date, b.start);
}

/** "My history" — cross-workspace query by driverId, never workspaceId. */
export async function listShiftsForDriver(driverId, db) {
  return db.shifts.query({ where: { driverId } });
}

/** Company view — same collection, filtered by owning workspace instead. */
export async function listShiftsForWorkspace(workspaceId, db) {
  return db.shifts.query({ where: { workspaceId } });
}

/**
 * `input.loads`, when provided (even as `[]`), replaces this shift's
 * Load rows entirely — see loadService.replaceLoadsForShift. Omitting
 * it leaves Loads untouched, so callers that don't know about
 * per-load pay (migrations, seed data) are unaffected.
 * @param {{workspaceId: string, driverId: string, assignmentId: string|null, date: string, start: string, end: string, breakMinutes: number, drivingHours: number, loads?: {reference: string|null, description: string|null, amount: number, distanceMiles: number|null}[]}} input
 */
export async function createShift(input, db) {
  const now = new Date().toISOString();
  const assignmentId = input.assignmentId ?? null;
  const rateCardId = await resolveRateCardIdForContext(assignmentId, input.date, db);
  const shift = await db.shifts.insert({
    id: newId("shift"),
    workspaceId: input.workspaceId,
    driverId: input.driverId,
    assignmentId,
    date: input.date,
    start: input.start,
    end: input.end,
    breakMinutes: Number(input.breakMinutes),
    drivingHours: Number(input.drivingHours) || 0,
    rateCardId,
    createdAt: now,
    updatedAt: now,
    source: "manual",
  });
  if (input.loads !== undefined) {
    await replaceLoadsForShift(shift.id, shift.workspaceId, input.loads, db);
  }
  return shift;
}

/**
 * Shift.rateCardId stays pinned unless the edit actually changes
 * pricing CONTEXT (date or assignment) — editing notes/break/hours/
 * night-out-flag/other fields must never silently re-resolve it. Only
 * a date or assignment change re-resolves the effective RateCard for
 * the new context and re-pins the exact version, computed once here at
 * save time, never at render time.
 */
export async function updateShift(id, patch, db) {
  const existing = await db.shifts.getById(id);
  const contextChanged =
    ("date" in patch && patch.date !== existing.date) ||
    ("assignmentId" in patch && patch.assignmentId !== existing.assignmentId);
  const { loads, ...restPatch } = patch;
  const resolvedPatch = { ...restPatch, updatedAt: new Date().toISOString() };
  if (contextChanged) {
    const nextAssignmentId = "assignmentId" in patch ? patch.assignmentId : existing.assignmentId;
    const nextDate = "date" in patch ? patch.date : existing.date;
    resolvedPatch.rateCardId = await resolveRateCardIdForContext(nextAssignmentId, nextDate, db);
  }
  const updated = await db.shifts.update(id, resolvedPatch);
  if (loads !== undefined) {
    await replaceLoadsForShift(id, existing.workspaceId, loads, db);
  }
  return updated;
}

export async function deleteShift(id, db) {
  await clearLoadsForShift(id, db);
  await db.shifts.remove(id);
}

export async function driverShiftsWithBreakdown(driverId, db) {
  const shifts = await listShiftsForDriver(driverId, db);
  const sorted = [...shifts].sort(byStartAsc);
  const resolveRateCard = await buildRateCardResolver(sorted, db);
  const resolveLoads = await buildLoadsResolver(sorted, db);
  return sorted.map((shift) => ({
    shift,
    breakdown: computeShiftBreakdown(shift, resolveRateCard(shift), resolveLoads(shift)),
  }));
}

export async function workspaceShiftsWithBreakdown(workspaceId, db) {
  const shifts = await listShiftsForWorkspace(workspaceId, db);
  const sorted = [...shifts].sort(byStartAsc);
  const resolveRateCard = await buildRateCardResolver(sorted, db);
  const resolveLoads = await buildLoadsResolver(sorted, db);
  return sorted.map((shift) => ({
    shift,
    breakdown: computeShiftBreakdown(shift, resolveRateCard(shift), resolveLoads(shift)),
  }));
}
