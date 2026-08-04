import { afterEach, afterAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/pool.js";
import { complianceProfiles } from "../src/db/schema.js";
import { seedDefaultComplianceProfile } from "../src/db/seed.js";

describe("seedDefaultComplianceProfile — against a real local Postgres", () => {
  afterEach(async () => {
    await db.delete(complianceProfiles);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates the default ComplianceProfile when missing", async () => {
    await seedDefaultComplianceProfile(db);
    const [profile] = await db.select().from(complianceProfiles);
    expect(profile.id).toBe("compliance-default");
    expect(profile.scope).toBe("default");
    expect(profile.rules.drivingHardLimitHours).toBe(10);
  });

  it("is idempotent — calling it twice doesn't duplicate or error", async () => {
    await seedDefaultComplianceProfile(db);
    await seedDefaultComplianceProfile(db);
    const rows = await db.select().from(complianceProfiles);
    expect(rows).toHaveLength(1);
  });
});
