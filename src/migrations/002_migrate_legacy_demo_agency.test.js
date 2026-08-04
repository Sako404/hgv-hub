import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import { runMigrations } from "./index.js";

const LEGACY_SHIFTS = [
  { id: "legacy-1", date: "2026-07-14", start: "08:00", end: "16:00", drivingHours: 5, breakMinutes: 45 },
  { id: "legacy-2", date: "2026-07-15", start: "14:00", end: "23:00", drivingHours: 6.5, breakMinutes: 45 },
];

describe("002_migrate_legacy_demo_agency", () => {
  it("creates the full entity graph and migrates every legacy shift, preserving ids", async () => {
    const { db, storage } = await createTestDb({ legacyShifts: LEGACY_SHIFTS });

    const person = await db.people.getById("person-demo");
    expect(person).toBeTruthy();

    const personalWorkspace = await db.workspaces.getById("workspace-personal-demo");
    expect(personalWorkspace.kind).toBe("personal");
    expect(personalWorkspace.ownerPersonId).toBe("person-demo");

    const agencyWorkspace = await db.workspaces.getById("workspace-demo-agency");
    expect(agencyWorkspace.kind).toBe("agency");

    // Two Organisation rows exist against Apex Driving's own workspace
    // after migration 006 runs: Apex Driving's own self-org, and a
    // proper client Organisation for Parcel Line (previously just a free-text
    // Site.clientName string).
    const orgsInWorkspace = await db.organisations.query({ where: { workspaceId: agencyWorkspace.id } });
    const selfOrg = orgsInWorkspace.find((o) => o.types.includes("agency"));
    expect(selfOrg).toBeTruthy();
    const clientOrg = orgsInWorkspace.find((o) => o.tradingName === "Parcel Line");
    expect(clientOrg).toBeTruthy();
    expect(clientOrg.types).toEqual(["client"]);
    expect(clientOrg.id).not.toBe(selfOrg.id);

    const site = (await db.sites.getAll())[0];
    expect(site.name).toMatch(/Parcel Line/);
    // Site.organisationId points at the CLIENT (Parcel Line), not the agency's own org.
    expect(site.organisationId).toBe(clientOrg.id);

    const rateCard = (await db.rateCards.query({ where: { workspaceId: agencyWorkspace.id } }))[0];
    expect(rateCard.rates.MonThu.Days).toEqual([15.20, 17.20]);
    // Append-only versioning: version 1 of its own lineage.
    expect(rateCard.lineageId).toBe(rateCard.id);
    expect(rateCard.version).toBe(1);
    expect(rateCard.supersedesId).toBeNull();

    const engagement = (await db.engagements.query({ where: { driverId: "person-demo" } }))[0];
    expect(engagement.status).toBe("active");
    // providerOrganisationId (Stage 4D) is Apex Driving's own self-org — who employs Alex, not the client he's placed with.
    expect(engagement.providerOrganisationId).toBe(selfOrg.id);
    expect(engagement.relationshipType).toBe("agency_worker");

    const assignment = (await db.assignments.query({ where: { engagementId: engagement.id } }))[0];
    const placement = await db.placements.getById(assignment.placementId);
    expect(placement).toBeTruthy();
    expect(placement.rateCardLineageId).toBe(rateCard.lineageId);
    expect(placement.providerOrganisationId).toBe(selfOrg.id);
    expect(placement.siteId).toBe(site.id);

    const shifts = await db.shifts.getAll();
    expect(shifts).toHaveLength(2);
    expect(shifts.map((s) => s.id).sort()).toEqual(["legacy-1", "legacy-2"]);
    for (const s of shifts) {
      expect(s.driverId).toBe("person-demo");
      expect(s.workspaceId).toBe(agencyWorkspace.id);
      expect(s.assignmentId).toBe(assignment.id);
      expect(s.source).toBe("migration");
      // Every historical shift arrives with its exact RateCard version
      // already pinned — never resolved live at render time.
      expect(s.rateCardId).toBe(rateCard.id);
    }

    expect(storage.getItem("wt-current-person-id")).toBe("person-demo");
  });

  it("never deletes or mutates the legacy hgv-shifts key", async () => {
    const { storage } = await createTestDb({ legacyShifts: LEGACY_SHIFTS });
    expect(JSON.parse(storage.getItem("hgv-shifts"))).toEqual(LEGACY_SHIFTS);
  });

  it("is guarded by schema version and never reruns", async () => {
    const { db, storage } = await createTestDb({ legacyShifts: LEGACY_SHIFTS });
    expect(await db.shifts.getAll()).toHaveLength(2);

    // Re-running migrations against the same storage must be a no-op.
    await runMigrations(db, storage);
    expect(await db.shifts.getAll()).toHaveLength(2);
    expect(await db.people.getAll()).toHaveLength(1);
  });

  it("handles an empty legacy dataset gracefully", async () => {
    const { db } = await createTestDb({ legacyShifts: [] });
    expect(await db.shifts.getAll()).toHaveLength(0);
    expect(await db.people.getById("person-demo")).toBeTruthy();
  });
});
