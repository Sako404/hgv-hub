import { listWorkspacesForPerson } from "./workspaceService.js";
import { listVehiclesForWorkspace } from "./vehicleService.js";
import { listDriversForWorkspace, resolvePersonDisplayName } from "./driverService.js";
import { listShiftsForDriver } from "./shiftService.js";
import { resolveComplianceProfileForDriver } from "./complianceProfileService.js";
import { computeCompliance } from "./complianceEngine.js";
import { listDriverDocuments } from "./driverDocumentService.js";
import { resolveDriverDocumentSummary, resolveDocumentStatus } from "./documentExpiryEngine.js";
import { resolveCpcCycleStatusForDriver } from "./cpcTrainingService.js";
import { listDefectsForWorkspace } from "./defectService.js";
import { resolveExternalTmLimitStatus, resolveRecommendedHours } from "./transportManagerEngine.js";

/**
 * Every workspace this person holds the `transport_manager` role in,
 * each with its active Vehicle count — the input
 * `resolveExternalTmLimitStatus` needs (see the architecture
 * proposal's §2.3). Cross-workspace, same query shape
 * `workspaceService.resolveSession`'s `managerialMemberships` already
 * uses for the switcher.
 * @param {string} personId
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function resolveTransportManagerWorkspaces(personId, db) {
  const memberships = await listWorkspacesForPerson(personId, db);
  const tmMemberships = memberships.filter((m) => m.roles.includes("transport_manager"));
  return Promise.all(
    tmMemberships.map(async (m) => {
      const vehicles = await listVehiclesForWorkspace(m.workspace.id, db);
      const activeVehicleCount = vehicles.filter((v) => !v.archivedAt).length;
      return { workspaceId: m.workspace.id, workspaceName: m.workspace.name, vehicleCount: activeVehicleCount };
    })
  );
}

/** Driver hours compliance, CPC cycle, and document status, one row per active driver. */
async function resolveDriverRollUp(workspaceId, db, today) {
  const drivers = await listDriversForWorkspace(workspaceId, db);
  const activeDrivers = drivers.filter((d) => !d.driverProfile?.archivedAt);

  return Promise.all(
    activeDrivers.map(async ({ person, driverProfile }) => {
      const [shifts, complianceProfile, documents, cpcCycleStatus] = await Promise.all([
        listShiftsForDriver(person.id, db),
        resolveComplianceProfileForDriver(person.id, db),
        listDriverDocuments(person.id, db, { activeOnly: true }),
        resolveCpcCycleStatusForDriver(person.id, db, today),
      ]);
      const compliance = computeCompliance(shifts, complianceProfile);
      // A simplified roll-up bucket, not the 3-category detail DriverApp's
      // own dashboard shows — "any active alert at all" is the right
      // signal for a fleet-wide "who needs my attention" table; drilling
      // into DriverDrilldown already gives the full per-category detail.
      const hoursStatus = compliance.alerts.length > 0 ? "problem" : "ok";
      return {
        personId: person.id,
        driverProfileId: driverProfile?.id ?? null,
        displayName: resolvePersonDisplayName(person),
        hoursStatus,
        documentStatus: resolveDriverDocumentSummary(documents, today),
        cpcCycleStatus,
      };
    })
  );
}

/** Defect roll-up and MOT/insurance roadworthiness, one row per active vehicle. */
async function resolveVehicleRollUp(workspaceId, db, today) {
  const [vehicles, defects] = await Promise.all([
    listVehiclesForWorkspace(workspaceId, db),
    listDefectsForWorkspace(workspaceId, db),
  ]);
  const activeVehicles = vehicles.filter((v) => !v.archivedAt);
  const openDefectsByVehicleId = new Map();
  for (const defect of defects) {
    if (defect.status === "resolved") continue;
    if (!openDefectsByVehicleId.has(defect.vehicleId)) openDefectsByVehicleId.set(defect.vehicleId, []);
    openDefectsByVehicleId.get(defect.vehicleId).push(defect);
  }

  return activeVehicles.map((vehicle) => {
    const openDefects = openDefectsByVehicleId.get(vehicle.id) ?? [];
    const motStatus = resolveDocumentStatus({ expiryDate: vehicle.motExpiryDate }, today);
    const insuranceStatus = resolveDocumentStatus({ expiryDate: vehicle.insuranceExpiryDate }, today);
    return {
      vehicleId: vehicle.id,
      registration: vehicle.registration,
      openDefectCount: openDefects.length,
      hasDangerousDefect: openDefects.some((d) => d.severity === "dangerous"),
      motStatus,
      insuranceStatus,
    };
  });
}

/**
 * Everything the Transport Manager dashboard shows for one workspace —
 * see decision-2026-08-04-working-time-transport-manager-architecture.
 * Entirely a read/aggregate layer over existing services; the only new
 * data this app captures for this feature lives on `Vehicle`
 * (motExpiryDate/insuranceExpiryDate).
 * @param {string} personId - the signed-in Transport Manager, for the external-TM limit check (§2.3)
 * @param {string} workspaceId - the active workspace to roll up
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 * @param {Date} [today]
 */
export async function resolveTransportManagerDashboardData(personId, workspaceId, db, today = new Date()) {
  const [drivers, vehicles, tmWorkspaces] = await Promise.all([
    resolveDriverRollUp(workspaceId, db, today),
    resolveVehicleRollUp(workspaceId, db, today),
    resolveTransportManagerWorkspaces(personId, db),
  ]);
  return {
    drivers,
    vehicles,
    recommendedHours: resolveRecommendedHours(vehicles.length),
    externalTmLimitStatus: resolveExternalTmLimitStatus(tmWorkspaces),
  };
}
