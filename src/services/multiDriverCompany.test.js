import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import { seedSecondCompany } from "./seed/seedSecondCompany.js";
import { listShiftsForDriver, createShift, deleteShift, updateShift } from "./shiftService.js";
import { resolveRateCardForShift } from "./rateCardService.js";
import { computeShiftBreakdown } from "./payEngine.js";

describe("multi-driver / multi-organisation proof", () => {
  it("property 3: multiple drivers can belong to the same company", async () => {
    const { db } = await createTestDb();
    const seed = await seedSecondCompany(db);
    const driverMemberships = (await db.memberships.query({ where: { workspaceId: seed.companyWorkspaceId } }))
      .filter((m) => m.roles.includes("driver"));
    expect(driverMemberships.length).toBe(3);
    const distinctPersonIds = new Set(driverMemberships.map((m) => m.personId));
    expect(distinctPersonIds.size).toBe(3);
  });

  it("property 4: company data for Driver A never corrupts Driver B", async () => {
    const { db } = await createTestDb();
    const seed = await seedSecondCompany(db);
    const [driverA, driverB] = seed.drivers;

    const beforeB = await listShiftsForDriver(driverB.personId, db);

    // Mutate and delete Driver A's shifts.
    const aShifts = await listShiftsForDriver(driverA.personId, db);
    await updateShift(aShifts[0].id, { drivingHours: 999 }, db);
    await deleteShift(aShifts[1].id, db);
    await createShift(
      {
        workspaceId: seed.companyWorkspaceId,
        driverId: driverA.personId,
        assignmentId: driverA.assignmentId,
        date: "2026-07-20",
        start: "08:00",
        end: "12:00",
        breakMinutes: 0,
        drivingHours: 3,
      },
      db
    );

    const afterB = await listShiftsForDriver(driverB.personId, db);
    expect(afterB).toEqual(beforeB);
  });

  it("property 8: different drivers may have different rate cards", async () => {
    const { db } = await createTestDb();
    const seed = await seedSecondCompany(db);
    const secondCompanyDriver = seed.drivers[0];

    const demoShift = { date: "2026-07-14", start: "08:00", end: "13:00", breakMinutes: 0 };
    const demoRateCard = await db.rateCards.getById("ratecard-demo-agency-client");

    const secondCompanyShifts = await listShiftsForDriver(secondCompanyDriver.personId, db);
    const secondCompanyRateCard = await resolveRateCardForShift(secondCompanyShifts[0], db);

    expect(secondCompanyRateCard.id).not.toBe(demoRateCard.id);
    expect(secondCompanyRateCard.rates).not.toEqual(demoRateCard.rates);

    const hypotheticalDemo = computeShiftBreakdown(demoShift, demoRateCard);
    const hypotheticalSecondCompany = computeShiftBreakdown(demoShift, secondCompanyRateCard);
    expect(hypotheticalDemo.totalGross).not.toBeCloseTo(hypotheticalSecondCompany.totalGross, 2);
  });

  it("seeding twice is idempotent (no duplicate organisation/drivers)", async () => {
    const { db } = await createTestDb();
    await seedSecondCompany(db);
    await seedSecondCompany(db);
    expect(await db.organisations.query({ where: { legalName: "Northline Transport Ltd" } })).toHaveLength(1);
  });

  it("Stage 4D: all three demo drivers share exactly one Placement, each via their own Engagement/Assignment", async () => {
    const { db } = await createTestDb();
    const seed = await seedSecondCompany(db);

    const placements = await db.placements.query({ where: { workspaceId: seed.companyWorkspaceId } });
    expect(placements).toHaveLength(1);

    for (const driver of seed.drivers) {
      const assignment = await db.assignments.getById(driver.assignmentId);
      expect(assignment.placementId).toBe(placements[0].id);
      const engagement = await db.engagements.getById(driver.engagementId);
      expect(engagement.providerOrganisationId).toBe(placements[0].providerOrganisationId);
    }
  });

  it("test plan #7: direct employment (no agency) resolves end-to-end through Placement to a priced Shift", async () => {
    const { db } = await createTestDb();
    const seed = await seedSecondCompany(db);
    const driver = seed.drivers[0];

    const engagement = await db.engagements.getById(driver.engagementId);
    expect(engagement.relationshipType).toBe("employee");
    expect(engagement.providerOrganisationId).toBe(seed.orgId); // the company's own self-organisation, not an external agency

    const shifts = await listShiftsForDriver(driver.personId, db);
    expect(shifts.length).toBeGreaterThan(0);
    expect(shifts[0].rateCardId).toBeTruthy();
  });
});
