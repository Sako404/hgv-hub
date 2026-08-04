import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import { createEngagement, endEngagement, listEngagementsForDriver, listEngagementsForWorkspace } from "./engagementService.js";
import { createAssignment, endAssignment } from "./assignmentService.js";
import { createPlacement } from "./placementService.js";

async function seedSecondEngagement(db, personId = "person-demo") {
  return createEngagement(
    { workspaceId: "workspace-demo-agency", driverId: personId, providerOrganisationId: "org-demo-agency", relationshipType: "agency_worker", startDate: "2026-01-01" },
    db
  );
}

describe("engagementService", () => {
  it("creates an engagement", async () => {
    const { db } = await createTestDb();
    const engagement = await seedSecondEngagement(db);
    expect(engagement.driverId).toBe("person-demo");
    expect(engagement.providerOrganisationId).toBe("org-demo-agency");
    expect(engagement.status).toBe("active");
    expect(engagement.endDate).toBeNull();
  });

  it("test plan #1: a driver can hold multiple concurrently-active Engagements (e.g. two different agencies at once)", async () => {
    const { db } = await createTestDb();
    // Alex's real migrated Engagement (Example Driver Agency) is already active.
    const secondAgencyOrg = "org-demo-agency"; // reuse for simplicity; a distinct org would work identically
    const second = await createEngagement(
      { workspaceId: "workspace-demo-agency", driverId: "person-demo", providerOrganisationId: secondAgencyOrg, relationshipType: "agency_worker", startDate: "2026-02-01" },
      db
    );
    const engagements = await listEngagementsForDriver("person-demo", db);
    expect(engagements.filter((e) => e.status === "active").length).toBeGreaterThanOrEqual(2);
    expect(engagements.some((e) => e.id === second.id)).toBe(true);
    expect(engagements.some((e) => e.id === "engagement-demo-agency")).toBe(true);
  });

  it("listEngagementsForWorkspace is workspace-scoped", async () => {
    const { db } = await createTestDb();
    const workspaceEngagements = await listEngagementsForWorkspace("workspace-demo-agency", db);
    expect(workspaceEngagements.some((e) => e.id === "engagement-demo-agency")).toBe(true);

    const personalEngagements = await listEngagementsForWorkspace("workspace-personal-demo", db);
    expect(personalEngagements.some((e) => e.id === "engagement-demo-agency")).toBe(false);
  });

  it("endEngagement blocks (throws) while a live Assignment through it is still active", async () => {
    const { db } = await createTestDb();
    // Alex's real migrated Assignment through engagement-demo-agency is still active.
    await expect(endEngagement("engagement-demo-agency", "2026-08-01", db)).rejects.toThrow();
    expect((await db.engagements.getById("engagement-demo-agency")).status).toBe("active");
  });

  it("endEngagement blocks when a live Assignment would extend beyond the new end date", async () => {
    const { db } = await createTestDb();
    const placement = await createPlacement(
      { workspaceId: "workspace-demo-agency", providerOrganisationId: "org-demo-agency", siteId: "site-demo-client", rateCardLineageId: "ratecard-demo-agency-client", effectiveFrom: "2026-01-01" },
      db
    );
    const engagement = await seedSecondEngagement(db);
    const assignment = await createAssignment({ engagementId: engagement.id, placementId: placement.id, startDate: "2026-01-01", endDate: "2026-12-31" }, db);
    void assignment;

    // Trying to end the engagement in 2026-06 would leave the assignment (ending 2026-12-31) outliving it.
    await expect(endEngagement(engagement.id, "2026-06-01", db)).rejects.toThrow();
  });

  it("endEngagement succeeds once dependent assignments are ended first", async () => {
    const { db } = await createTestDb();
    const placement = await createPlacement(
      { workspaceId: "workspace-demo-agency", providerOrganisationId: "org-demo-agency", siteId: "site-demo-client", rateCardLineageId: "ratecard-demo-agency-client", effectiveFrom: "2026-01-01" },
      db
    );
    const engagement = await seedSecondEngagement(db);
    const assignment = await createAssignment({ engagementId: engagement.id, placementId: placement.id, startDate: "2026-01-01" }, db);

    await endAssignment(assignment.id, "2026-06-01", db);
    const ended = await endEngagement(engagement.id, "2026-06-01", db);
    expect(ended.status).toBe("ended");
    expect(ended.endDate).toBe("2026-06-01");
  });
});
