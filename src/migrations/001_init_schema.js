const DEFAULT_COMPLIANCE_PROFILE_ID = "compliance-default";

// Today's exact thresholds, lifted from the pre-refactor computeCompliance.
const DEFAULT_RULES = {
  reducedRestMaxPerCycle: 3,
  minRestHardHours: 9,
  reducedRestUpperHours: 11,
  cycleResetGapHours: 24,
  absoluteMaxDailyHours: 15,
  longShiftThresholdHours: 13,
  longShiftMaxPerCycle: 3,
  drivingHardLimitHours: 10,
  extendedDrivingThresholdHours: 9,
  extendedDrivingMaxPerWeek: 2,
};

/**
 * Idempotent bootstrap: ensures the platform-level default
 * ComplianceProfile exists. Collections themselves need no seeding —
 * an absent collection already reads back as [].
 * @param {ReturnType<typeof import('../storage/db.js').createIndexedDbDb>} db
 */
export async function migration001InitSchema(db) {
  if (await db.complianceProfiles.getById(DEFAULT_COMPLIANCE_PROFILE_ID)) return;
  await db.complianceProfiles.insert({
    id: DEFAULT_COMPLIANCE_PROFILE_ID,
    scope: "default",
    rules: DEFAULT_RULES,
  });
}
