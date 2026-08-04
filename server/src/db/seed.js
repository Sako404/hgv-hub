import { eq } from "drizzle-orm";
import { complianceProfiles } from "./schema.js";

const DEFAULT_COMPLIANCE_PROFILE_ID = "compliance-default";

// Mirrors the client's src/migrations/001_init_schema.js exactly —
// server mode never runs client migrations (its Postgres schema is
// already current via drizzle-kit, see server/drizzle/), but this one
// migration is pure platform-level reference DATA, not a schema
// change, so it still needs seeding once per deployment.
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

/** Idempotent: safe to call on every server start. */
export async function seedDefaultComplianceProfile(db) {
  const rows = await db.select().from(complianceProfiles).where(eq(complianceProfiles.id, DEFAULT_COMPLIANCE_PROFILE_ID)).limit(1);
  if (rows[0]) return;
  await db.insert(complianceProfiles).values({ id: DEFAULT_COMPLIANCE_PROFILE_ID, scope: "default", rules: DEFAULT_RULES });
}
