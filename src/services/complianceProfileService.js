const DEFAULT_COMPLIANCE_PROFILE_ID = "compliance-default";

/**
 * Driver-specific profile if one exists, else the platform default. Never
 * resolves by organisation — see docs/ARCHITECTURE.md.
 * @param {string} driverId
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 * @returns {Promise<import('../domain/types.js').ComplianceProfile>}
 */
export async function resolveComplianceProfileForDriver(driverId, db) {
  return (
    (await db.complianceProfiles.getById(driverId)) ??
    (await db.complianceProfiles.query({ where: { scope: driverId } }))[0] ??
    (await db.complianceProfiles.getById(DEFAULT_COMPLIANCE_PROFILE_ID))
  );
}
