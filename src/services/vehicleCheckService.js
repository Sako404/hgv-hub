import { newId } from "../domain/ids.js";
import { raiseDefectsFromVehicleCheck } from "./defectService.js";

/** "My history" — cross-workspace query by driverId, never workspaceId. Mirrors shiftService's split exactly. */
export async function listVehicleChecksForDriver(driverId, db) {
  return db.vehicleChecks.query({ where: { driverId } });
}

/** Company view — same collection, filtered by owning workspace instead. */
export async function listVehicleChecksForWorkspace(workspaceId, db) {
  return db.vehicleChecks.query({ where: { workspaceId } });
}

function validateVehicleCheckInput(input) {
  if (!input.vehicleId) {
    throw new Error("A vehicle check needs a vehicle");
  }
  if (input.pairedVehicleId && input.pairedVehicleId === input.vehicleId) {
    throw new Error("The paired vehicle must be different from the primary vehicle");
  }
  if (!input.driverSignOffName) {
    throw new Error("A vehicle check needs a driver sign-off");
  }
  if (!input.items || input.items.length === 0) {
    throw new Error("A vehicle check needs at least one item");
  }
  for (const item of input.items) {
    if (item.result !== "ok" && item.result !== "defect" && item.result !== "not_applicable") {
      throw new Error(`Every item needs a result — "${item.label}" is unset`);
    }
  }
}

/**
 * Submits a completed walkaround. `items` must already be the caller's
 * OWN copy (snapshotted from the ChecklistTemplate the UI resolved,
 * with each item's `result`/`notes` filled in) — this function stores
 * it as-is, it does not re-snapshot from `checklistTemplateId` itself,
 * since the whole point of the snapshot is that it was taken once, in
 * the UI, at the moment the driver started the check.
 * Also auto-raises one Defect per failed item (Stage VC-3) —
 * inherent to what submitting a check with failures means, so this
 * happens for every caller, not left to the UI to remember. When
 * `pairedVehicleId` is set (tractor+trailer combination, see
 * decision-2026-08-04-working-time-owner-operator-architecture), each
 * item's own `vehicleId` (already stamped by the caller — see
 * VehicleCheckApp) decides which physical vehicle a defect raises
 * against; this function doesn't need to know which items belong to
 * which vehicle itself.
 * @param {{workspaceId: string, driverId: string, vehicleId: string, pairedVehicleId?: string|null, shiftId?: string|null, checklistTemplateId: string, items: import('../domain/types.js').VehicleCheck['items'], odometerReading?: number|null, driverSignOffName: string}} input
 */
export async function createVehicleCheck(input, db) {
  validateVehicleCheckInput(input);
  const overallResult = input.items.some((item) => item.result === "defect") ? "defects_found" : "ok";
  const now = new Date().toISOString();
  const check = await db.vehicleChecks.insert({
    id: newId("vehiclecheck"),
    workspaceId: input.workspaceId,
    driverId: input.driverId,
    vehicleId: input.vehicleId,
    pairedVehicleId: input.pairedVehicleId ?? null,
    shiftId: input.shiftId ?? null,
    checklistTemplateId: input.checklistTemplateId,
    items: input.items.map((item) => ({ ...item, vehicleId: item.vehicleId ?? input.vehicleId })),
    overallResult,
    odometerReading: input.odometerReading ?? null,
    performedAt: now,
    driverSignOffName: input.driverSignOffName,
    createdAt: now,
  });
  await raiseDefectsFromVehicleCheck(check, db);
  return check;
}
