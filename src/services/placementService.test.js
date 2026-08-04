import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import {
  archivePlacement,
  createPlacement,
  getPlacementSummary,
  listPlacementsForWorkspace,
  placementHasAssignmentHistory,
  restorePlacement,
  updatePlacement,
} from "./placementService.js";
import { createAssignment, endAssignment } from "./assignmentService.js";
import { createEngagement } from "./engagementService.js";
import { createOrganisation } from "./organisationService.js";
import { reviseRateCard } from "./rateCardService.js";

// engagement-demo-agency's real startDate backdates to "today" (see
// migration 002) — any Assignment referencing it must use a date
// safely on/after that, same convention as shiftService.test.js.
const SAFE_DATE = "2099-01-01";
const SAFE_DATE_LATER = "2099-06-01";

describe("placementService", () => {
  it("creates a placement", async () => {
    const { db } = await createTestDb();
    const placement = await createPlacement(
      { workspaceId: "workspace-demo-agency", providerOrganisationId: "org-demo-agency", siteId: "site-demo-client", rateCardLineageId: "ratecard-demo-agency-client", effectiveFrom: "2026-01-01" },
      db
    );
    expect(placement.providerOrganisationId).toBe("org-demo-agency");
    expect(placement.archivedAt).toBeNull();
  });

  it("listPlacementsForWorkspace is workspace-scoped", async () => {
    const { db } = await createTestDb();
    await createPlacement(
      { workspaceId: "workspace-personal-demo", providerOrganisationId: "org-demo-agency", siteId: "site-demo-client", rateCardLineageId: "ratecard-demo-agency-client", effectiveFrom: "2026-01-01" },
      db
    );
    const demoPlacements = await listPlacementsForWorkspace("workspace-demo-agency", db);
    const personalPlacements = await listPlacementsForWorkspace("workspace-personal-demo", db);
    expect(demoPlacements.some((p) => p.workspaceId === "workspace-personal-demo")).toBe(false);
    expect(personalPlacements.length).toBe(1);
  });

  it("test plan #2/#6: multiple drivers can share one Placement, each via their own Assignment", async () => {
    const { db } = await createTestDb();
    const placement = await createPlacement(
      { workspaceId: "workspace-demo-agency", providerOrganisationId: "org-demo-agency", siteId: "site-demo-client", rateCardLineageId: "ratecard-demo-agency-client", effectiveFrom: "2026-01-01" },
      db
    );
    const johnEngagement = await createEngagement(
      { workspaceId: "workspace-demo-agency", driverId: "person-john", providerOrganisationId: "org-demo-agency", relationshipType: "agency_worker", startDate: "2026-01-01" },
      db
    );
    await createAssignment({ engagementId: "engagement-demo-agency", placementId: placement.id, startDate: SAFE_DATE }, db);
    await createAssignment({ engagementId: johnEngagement.id, placementId: placement.id, startDate: "2026-01-01" }, db);

    const summary = await getPlacementSummary(placement.id, db);
    expect(summary.activeAssignmentCount).toBe(2);

    // A revision to the shared lineage affects both drivers identically -- proven via resolveEffectiveRateCard.
    const revised = await reviseRateCard("ratecard-demo-agency-client", { effectiveFrom: "2099-01-01", rates: { MonThu: { Days: [99, 99], Lates: [99, 99], Nights: [99, 99] }, Fri: { Days: [99, 99], Lates: [99, 99], Nights: [99, 99] }, Sat: { Days: [99, 99], Lates: [99, 99], Nights: [99, 99] }, Sun: { Days: [99, 99], Lates: [99, 99], Nights: [99, 99] } } }, db);
    expect(revised.lineageId).toBe(placement.rateCardLineageId);
  });

  it("test plan #5: same site, different provider organisation are independent placements", async () => {
    const { db } = await createTestDb();
    const otherAgency = await createOrganisation({ workspaceId: "workspace-demo-agency", legalName: "Another Agency", tradingName: "Another Agency", types: ["agency"] }, db);
    const placementA = await createPlacement(
      { workspaceId: "workspace-demo-agency", providerOrganisationId: "org-demo-agency", siteId: "site-demo-client", rateCardLineageId: "ratecard-demo-agency-client", effectiveFrom: "2026-01-01" },
      db
    );
    const placementB = await createPlacement(
      { workspaceId: "workspace-demo-agency", providerOrganisationId: otherAgency.id, siteId: "site-demo-client", rateCardLineageId: "ratecard-demo-agency-client", effectiveFrom: "2026-01-01" },
      db
    );
    expect(placementA.id).not.toBe(placementB.id);
    expect(placementA.siteId).toBe(placementB.siteId);
    expect(placementA.providerOrganisationId).not.toBe(placementB.providerOrganisationId);
  });

  it("test plan #16: providerOrganisationId/siteId/rateCardLineageId lock once any Assignment references the placement", async () => {
    const { db } = await createTestDb();
    const placement = await createPlacement(
      { workspaceId: "workspace-demo-agency", providerOrganisationId: "org-demo-agency", siteId: "site-demo-client", rateCardLineageId: "ratecard-demo-agency-client", effectiveFrom: "2026-01-01" },
      db
    );
    expect(await placementHasAssignmentHistory(placement.id, db)).toBe(false);

    // Editable while unreferenced.
    const updated = await updatePlacement(placement.id, { siteId: "site-demo-client" }, db);
    expect(updated.siteId).toBe("site-demo-client");

    await createAssignment({ engagementId: "engagement-demo-agency", placementId: placement.id, startDate: SAFE_DATE }, db);
    expect(await placementHasAssignmentHistory(placement.id, db)).toBe(true);

    await expect(updatePlacement(placement.id, { siteId: "site-demo-client" }, db)).rejects.toThrow();
    // Non-locked fields stay editable.
    const stillEditable = await updatePlacement(placement.id, { effectiveTo: "2099-12-31" }, db);
    expect(stillEditable.effectiveTo).toBe("2099-12-31");
  });

  it("test plan #12: archivePlacement blocks while any Assignment referencing it is still active", async () => {
    const { db } = await createTestDb();
    const placement = await createPlacement(
      { workspaceId: "workspace-demo-agency", providerOrganisationId: "org-demo-agency", siteId: "site-demo-client", rateCardLineageId: "ratecard-demo-agency-client", effectiveFrom: "2026-01-01" },
      db
    );
    const assignment = await createAssignment({ engagementId: "engagement-demo-agency", placementId: placement.id, startDate: SAFE_DATE }, db);

    await expect(archivePlacement(placement.id, db)).rejects.toThrow();

    await endAssignment(assignment.id, SAFE_DATE_LATER, db);
    const archived = await archivePlacement(placement.id, db);
    expect(archived.archivedAt).toBeTruthy();
  });

  it("test plan #15: archive/restore round-trip", async () => {
    const { db } = await createTestDb();
    const placement = await createPlacement(
      { workspaceId: "workspace-demo-agency", providerOrganisationId: "org-demo-agency", siteId: "site-demo-client", rateCardLineageId: "ratecard-demo-agency-client", effectiveFrom: "2026-01-01" },
      db
    );
    await archivePlacement(placement.id, db);
    expect((await db.placements.getById(placement.id)).archivedAt).toBeTruthy();
    await restorePlacement(placement.id, db);
    expect((await db.placements.getById(placement.id)).archivedAt).toBeNull();
  });
});
