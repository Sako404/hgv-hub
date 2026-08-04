/**
 * Additive backfill for the Transport Manager dashboard (see
 * decision-2026-08-04-working-time-transport-manager-architecture):
 * adds `Vehicle.motExpiryDate`/`Vehicle.insuranceExpiryDate` (both
 * null on every existing row — this app never captured either date
 * before). Guarded on "does this row already have the field" — a
 * retry after a partial failure is harmless, same restart-safety
 * pattern as migration 010's `DriverProfile.preferredAssignmentId`
 * backfill.
 * @param {ReturnType<typeof import('../storage/db.js').createIndexedDbDb>} db
 */
export async function migration014AddVehicleRoadworthinessFields(db) {
  const vehicles = await db.vehicles.getAll();
  for (const vehicle of vehicles) {
    if ("motExpiryDate" in vehicle) continue;
    await db.vehicles.update(vehicle.id, { motExpiryDate: null, insuranceExpiryDate: null });
  }
}
