/**
 * Additive backfill for the Workplaces feature: adds
 * `DriverProfile.preferredAssignmentId` (explicitly driver-set, see
 * driverService.setPreferredAssignment) alongside the existing
 * auto-tracked `lastUsedAssignmentId`. Guarded on "does this row
 * already have the field" — a from-scratch retry after a partial
 * failure is harmless, same restart-safety pattern as prior migrations.
 * @param {ReturnType<typeof import('../storage/db.js').createIndexedDbDb>} db
 */
export async function migration010AddPreferredAssignment(db) {
  const driverProfiles = await db.driverProfiles.getAll();
  for (const driverProfile of driverProfiles) {
    if ("preferredAssignmentId" in driverProfile) continue;
    await db.driverProfiles.update(driverProfile.id, { preferredAssignmentId: null });
  }
}
