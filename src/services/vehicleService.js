import { newId } from "../domain/ids.js";
import { resolveActiveAssignmentsForDriver } from "./assignmentService.js";

/** @param {string} workspaceId */
export async function listVehiclesForWorkspace(workspaceId, db) {
  return db.vehicles.query({ where: { workspaceId } });
}

/**
 * Every non-archived Vehicle a driver can log a check against right
 * now: their own home/personal workspace's vehicles (a solo owner-
 * operator's own vehicle — see
 * docs/VEHICLE_CHECK_ARCHITECTURE_PROPOSAL.md §3/§6.1) UNION every
 * vehicle belonging to a workspace behind one of their currently-active
 * Assignments (any driver active in that workspace can check any of
 * its vehicles — not restricted to a specific Assignment/Placement).
 * @param {string} personId
 * @param {string|null} homeWorkspaceId
 */
export async function resolveAvailableVehiclesForDriver(personId, homeWorkspaceId, db) {
  const activeAssignments = await resolveActiveAssignmentsForDriver(personId, db);
  const workspaceIds = new Set(activeAssignments.map((a) => a.engagement.workspaceId));
  if (homeWorkspaceId) workspaceIds.add(homeWorkspaceId);
  if (workspaceIds.size === 0) return [];
  return db.vehicles.query({ where: { workspaceId: { in: [...workspaceIds] }, archivedAt: null } });
}

/**
 * @param {{workspaceId: string, registration: string, vehicleType: import('../domain/types.js').VehicleType, make?: string, model?: string, notes?: string, motExpiryDate?: string|null, insuranceExpiryDate?: string|null}} input
 */
export async function createVehicle(input, db) {
  if (!input.registration) {
    throw new Error("Vehicle must have a registration");
  }
  return db.vehicles.insert({
    id: newId("vehicle"),
    workspaceId: input.workspaceId,
    registration: input.registration,
    vehicleType: input.vehicleType,
    make: input.make || null,
    model: input.model || null,
    notes: input.notes || null,
    motExpiryDate: input.motExpiryDate || null,
    insuranceExpiryDate: input.insuranceExpiryDate || null,
    archivedAt: null,
    createdAt: new Date().toISOString(),
  });
}

/** registration/vehicleType/make/model/notes/motExpiryDate/insuranceExpiryDate only — workspaceId is immutable once created. */
export async function updateVehicle(id, patch, db) {
  if ("registration" in patch && !patch.registration) {
    throw new Error("Vehicle must have a registration");
  }
  return db.vehicles.update(id, patch);
}

export async function archiveVehicle(id, db) {
  return db.vehicles.update(id, { archivedAt: new Date().toISOString() });
}

export async function restoreVehicle(id, db) {
  return db.vehicles.update(id, { archivedAt: null });
}
