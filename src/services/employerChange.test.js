import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import { newId } from "../domain/ids.js";
import { createShift, listShiftsForDriver } from "./shiftService.js";

describe("property 9: a driver can change employer while retaining historical records", () => {
  it("keeps shifts from a prior, now-ended engagement alongside shifts from a new one", async () => {
    const { db } = await createTestDb();
    const driverId = "person-demo";

    // Shifts already exist under the Apex Driving engagement (via migration
    // fixture would be empty here, so log one directly).
    const oldShift = await createShift(
      {
        workspaceId: "workspace-demo-agency",
        driverId,
        assignmentId: "assignment-demo-agency-client",
        date: "2026-06-01",
        start: "08:00",
        end: "16:00",
        breakMinutes: 45,
        drivingHours: 6,
      },
      db
    );

    // End the Apex Driving engagement.
    await db.engagements.update("engagement-demo-agency", { status: "ended", endDate: "2026-07-01" });

    // Onboard a brand-new employer.
    const newWorkspaceId = newId("workspace");
    await db.workspaces.insert({ id: newWorkspaceId, kind: "transport_company", name: "New Haulage Ltd", ownerPersonId: null, createdAt: "now" });
    const newOrgId = newId("org");
    await db.organisations.insert({ id: newOrgId, workspaceId: newWorkspaceId, legalName: "New Haulage Ltd", tradingName: "New Haulage" });
    const newSiteId = newId("site");
    await db.sites.insert({ id: newSiteId, organisationId: newOrgId, name: "Sheffield Depot", kind: "depot", clientName: null });
    const newRateCardId = newId("ratecard");
    await db.rateCards.insert({
      id: newRateCardId,
      workspaceId: newWorkspaceId,
      lineageId: newRateCardId,
      version: 1,
      supersedesId: null,
      name: "New Haulage Standard",
      effectiveFrom: "2026-07-01",
      rates: { MonThu: { Days: [17, 19], Lates: [17.5, 19.5], Nights: [18, 20] }, Fri: { Days: [17, 19], Lates: [17.5, 19.5], Nights: [18, 20] }, Sat: { Days: [18, 20], Lates: [18.5, 20.5], Nights: [19, 21] }, Sun: { Days: [19, 21], Lates: [19.5, 21.5], Nights: [20, 22] } },
    });
    const newEngagementId = newId("engagement");
    await db.engagements.insert({ id: newEngagementId, providerOrganisationId: newOrgId, workspaceId: newWorkspaceId, driverId, relationshipType: "employee", startDate: "2026-07-10", endDate: null, status: "active" });
    const newPlacementId = newId("placement");
    await db.placements.insert({
      id: newPlacementId,
      workspaceId: newWorkspaceId,
      providerOrganisationId: newOrgId,
      siteId: newSiteId,
      rateCardLineageId: newRateCardId,
      effectiveFrom: "2026-07-10",
      effectiveTo: null,
      archivedAt: null,
      createdAt: "now",
    });
    const newAssignmentId = newId("assignment");
    await db.assignments.insert({ id: newAssignmentId, engagementId: newEngagementId, placementId: newPlacementId, startDate: "2026-07-10", endDate: null });

    const newShift = await createShift(
      {
        workspaceId: newWorkspaceId,
        driverId,
        assignmentId: newAssignmentId,
        date: "2026-07-15",
        start: "08:00",
        end: "16:00",
        breakMinutes: 45,
        drivingHours: 6,
      },
      db
    );

    const history = await listShiftsForDriver(driverId, db);
    const ids = history.map((s) => s.id);
    expect(ids).toContain(oldShift.id);
    expect(ids).toContain(newShift.id);
  });
});
