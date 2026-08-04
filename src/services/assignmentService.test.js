import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import { createAssignment, endAssignment, listAssignmentsForPlacement, resolveActiveAssignmentsForDriver } from "./assignmentService.js";
import { createEngagement } from "./engagementService.js";
import { createPlacement } from "./placementService.js";
import { createOrganisation } from "./organisationService.js";

// createTestDb() without a legacyShifts fixture backdates
// engagement-demo-agency's startDate to "today" (see migration 002) —
// every date used alongside that real engagement must be safely
// on/after that, same convention as shiftService.test.js's SAFE_DATE.
const SAFE_DATE = "2099-01-01";
const SAFE_DATE_LATER = "2099-06-01";
const SAFE_DATE_LATEST = "2099-09-01";

async function basePlacement(db, overrides = {}) {
  return createPlacement(
    {
      workspaceId: "workspace-demo-agency",
      providerOrganisationId: "org-demo-agency",
      siteId: "site-demo-client",
      rateCardLineageId: "ratecard-demo-agency-client",
      effectiveFrom: "2026-01-01",
      ...overrides,
    },
    db
  );
}

describe("assignmentService — createAssignment", () => {
  it("creates a valid assignment", async () => {
    const { db } = await createTestDb();
    const placement = await basePlacement(db);
    const engagement = await createEngagement(
      { workspaceId: "workspace-demo-agency", driverId: "person-john", providerOrganisationId: "org-demo-agency", relationshipType: "agency_worker", startDate: "2026-01-01" },
      db
    );
    const assignment = await createAssignment({ engagementId: engagement.id, placementId: placement.id, startDate: "2026-01-10" }, db);
    expect(assignment.engagementId).toBe(engagement.id);
    expect(assignment.placementId).toBe(placement.id);
    expect(assignment.endDate).toBeNull();
  });

  it("test plan #6: rejects a mismatched provider organisation (Engagement's provider != Placement's provider)", async () => {
    const { db } = await createTestDb();
    const otherAgency = await createOrganisation({ workspaceId: "workspace-demo-agency", legalName: "Agency B", tradingName: "Agency B", types: ["agency"] }, db);
    const placementForAgencyB = await basePlacement(db, { providerOrganisationId: otherAgency.id });

    // Alex's real engagement is with Example Driver Agency, not Agency B.
    await expect(
      createAssignment({ engagementId: "engagement-demo-agency", placementId: placementForAgencyB.id, startDate: "2026-01-10" }, db)
    ).rejects.toThrow(/provider organisation/i);
  });

  it("accepts a matching provider organisation", async () => {
    const { db } = await createTestDb();
    const placement = await basePlacement(db);
    const assignment = await createAssignment({ engagementId: "engagement-demo-agency", placementId: placement.id, startDate: SAFE_DATE }, db);
    expect(assignment).toBeTruthy();
  });

  describe("test plan #13: effective-date validation, both boundaries", () => {
    it("rejects start before the engagement's own start date", async () => {
      const { db } = await createTestDb();
      const engagement = await createEngagement(
        { workspaceId: "workspace-demo-agency", driverId: "person-x", providerOrganisationId: "org-demo-agency", relationshipType: "employee", startDate: "2026-03-01" },
        db
      );
      const placement = await basePlacement(db);
      await expect(createAssignment({ engagementId: engagement.id, placementId: placement.id, startDate: "2026-01-01" }, db)).rejects.toThrow(/engagement/i);
    });

    it("rejects start after the engagement has ended", async () => {
      const { db } = await createTestDb();
      const engagement = await createEngagement(
        { workspaceId: "workspace-demo-agency", driverId: "person-x", providerOrganisationId: "org-demo-agency", relationshipType: "employee", startDate: "2026-01-01" },
        db
      );
      await db.engagements.update(engagement.id, { endDate: "2026-06-01", status: "ended" });
      const placement = await basePlacement(db);
      await expect(createAssignment({ engagementId: engagement.id, placementId: placement.id, startDate: "2026-07-01" }, db)).rejects.toThrow(/engagement/i);
    });

    it("rejects end after the engagement has ended", async () => {
      const { db } = await createTestDb();
      const engagement = await createEngagement(
        { workspaceId: "workspace-demo-agency", driverId: "person-x", providerOrganisationId: "org-demo-agency", relationshipType: "employee", startDate: "2026-01-01" },
        db
      );
      await db.engagements.update(engagement.id, { endDate: "2026-06-01", status: "ended" });
      const placement = await basePlacement(db);
      await expect(
        createAssignment({ engagementId: engagement.id, placementId: placement.id, startDate: "2026-02-01", endDate: "2026-07-01" }, db)
      ).rejects.toThrow(/engagement/i);
    });

    it("rejects start before the placement's effectiveFrom", async () => {
      const { db } = await createTestDb();
      const placement = await basePlacement(db, { effectiveFrom: SAFE_DATE_LATER });
      await expect(
        createAssignment({ engagementId: "engagement-demo-agency", placementId: placement.id, startDate: SAFE_DATE }, db)
      ).rejects.toThrow(/placement/i);
    });

    it("rejects start after the placement's effectiveTo", async () => {
      const { db } = await createTestDb();
      const placement = await basePlacement(db);
      await db.placements.update(placement.id, { effectiveTo: SAFE_DATE });
      await expect(
        createAssignment({ engagementId: "engagement-demo-agency", placementId: placement.id, startDate: SAFE_DATE_LATER }, db)
      ).rejects.toThrow(/placement/i);
    });

    it("rejects end after the placement's effectiveTo", async () => {
      const { db } = await createTestDb();
      const placement = await basePlacement(db);
      await db.placements.update(placement.id, { effectiveTo: SAFE_DATE_LATER });
      await expect(
        createAssignment({ engagementId: "engagement-demo-agency", placementId: placement.id, startDate: SAFE_DATE, endDate: SAFE_DATE_LATEST }, db)
      ).rejects.toThrow(/placement/i);
    });

    it("accepts an assignment fully inside both windows", async () => {
      const { db } = await createTestDb();
      const engagement = await createEngagement(
        { workspaceId: "workspace-demo-agency", driverId: "person-x", providerOrganisationId: "org-demo-agency", relationshipType: "employee", startDate: "2026-01-01", },
        db
      );
      const placement = await basePlacement(db, { effectiveFrom: "2026-01-01" });
      const assignment = await createAssignment(
        { engagementId: engagement.id, placementId: placement.id, startDate: "2026-02-01", endDate: "2026-05-01" },
        db
      );
      expect(assignment.startDate).toBe("2026-02-01");
    });
  });

  it("test plan #14: concurrent Assignments are allowed — no global overlap ban", async () => {
    const { db } = await createTestDb();
    const placementA = await basePlacement(db);
    const otherAgency = await createOrganisation({ workspaceId: "workspace-demo-agency", legalName: "Agency B", tradingName: "Agency B", types: ["agency"] }, db);
    const placementB = await basePlacement(db, { providerOrganisationId: otherAgency.id });
    const engagementB = await createEngagement(
      { workspaceId: "workspace-demo-agency", driverId: "person-demo", providerOrganisationId: otherAgency.id, relationshipType: "agency_worker", startDate: "2026-01-01" },
      db
    );

    // Alex's real engagement-demo-agency already has an active Assignment onto a Example Driver Agency placement.
    // A second, concurrently-active Assignment via a DIFFERENT engagement/placement must be accepted, not rejected.
    const secondAssignment = await createAssignment({ engagementId: engagementB.id, placementId: placementB.id, startDate: "2026-01-10" }, db);
    expect(secondAssignment.endDate).toBeNull();
    void placementA;
  });

  it("listAssignmentsForPlacement returns every assignment (active or ended) referencing it", async () => {
    const { db } = await createTestDb();
    const placement = await basePlacement(db);
    const a1 = await createAssignment({ engagementId: "engagement-demo-agency", placementId: placement.id, startDate: SAFE_DATE }, db);
    await endAssignment(a1.id, SAFE_DATE_LATER, db);
    const list = await listAssignmentsForPlacement(placement.id, db);
    expect(list.map((a) => a.id)).toContain(a1.id);
  });

  it("endAssignment sets endDate without touching the Placement or other Assignments onto it", async () => {
    const { db } = await createTestDb();
    const placement = await basePlacement(db);
    const johnEngagement = await createEngagement(
      { workspaceId: "workspace-demo-agency", driverId: "person-john", providerOrganisationId: "org-demo-agency", relationshipType: "agency_worker", startDate: "2026-01-01" },
      db
    );
    const demoAssignment = await createAssignment({ engagementId: "engagement-demo-agency", placementId: placement.id, startDate: SAFE_DATE }, db);
    const johnAssignment = await createAssignment({ engagementId: johnEngagement.id, placementId: placement.id, startDate: "2026-01-01" }, db);

    await endAssignment(demoAssignment.id, SAFE_DATE_LATER, db);

    expect((await db.assignments.getById(demoAssignment.id)).endDate).toBe(SAFE_DATE_LATER);
    expect((await db.assignments.getById(johnAssignment.id)).endDate).toBeNull();
    expect((await db.placements.getById(placement.id)).archivedAt).toBeNull();
  });
});

describe("assignmentService — test plan #18: resolveActiveAssignmentsForDriver contract stability", () => {
  it("returns the pinned {engagement, assignment, rateCard, site, employerOrganisation, siteOrganisation} shape", async () => {
    const { db } = await createTestDb();
    const resolved = await resolveActiveAssignmentsForDriver("person-demo", db);
    expect(resolved).toHaveLength(1);
    const entry = resolved[0];
    expect(Object.keys(entry).sort()).toEqual(["assignment", "employerOrganisation", "engagement", "rateCard", "site", "siteOrganisation"].sort());
    expect(entry.employerOrganisation.tradingName).toBe("Example Driver Agency");
    expect(entry.site.name).toMatch(/Example Logistics/);
    expect(entry.siteOrganisation.tradingName).toBe("Example Logistics");
    expect(entry.rateCard).toBeTruthy();
  });
});
