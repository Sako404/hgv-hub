import { describe, expect, it } from "vitest";
import { createDb } from "../storage/db.js";
import { createInMemoryStorage } from "../../test/inMemoryStorage.js";
import { migration008EngagementPlacementRefinement } from "./008_engagement_placement_refinement.js";

async function seedPreMigration008Data() {
  const db = createDb(createInMemoryStorage());
  await db.workspaces.insert({ id: "ws-1", kind: "agency", name: "Agency", ownerPersonId: null, createdAt: "now" });
  await db.organisations.insert({ id: "org-1", workspaceId: "ws-1", legalName: "Agency", tradingName: "Agency", types: ["agency"], archivedAt: null });
  await db.sites.insert({ id: "site-1", organisationId: "org-1", name: "Client Site", kind: "client_site", clientName: null, archivedAt: null });
  await db.rateCards.insert({ id: "rc-1", workspaceId: "ws-1", lineageId: "rc-1", version: 1, supersedesId: null, effectiveFrom: "2026-01-01", rates: {} });

  await db.engagements.insert({
    id: "eng-1",
    employerOrganisationId: "org-1",
    workspaceId: "ws-1",
    driverId: "person-1",
    role: "agency_worker",
    startDate: "2026-01-05",
    endDate: null,
    status: "active",
  });
  await db.engagements.insert({
    id: "eng-2",
    employerOrganisationId: "org-1",
    workspaceId: "ws-1",
    driverId: "person-2",
    role: "agency_worker",
    startDate: "2026-02-01",
    endDate: null,
    status: "active",
  });

  await db.assignments.insert({
    id: "assign-1",
    engagementId: "eng-1",
    siteId: "site-1",
    rateCardLineageId: "rc-1",
    startDate: "2026-01-05",
    endDate: null,
  });
  await db.assignments.insert({
    id: "assign-2",
    engagementId: "eng-2",
    siteId: "site-1",
    rateCardLineageId: "rc-1",
    startDate: "2026-02-01",
    endDate: null,
  });
  return db;
}

describe("migration 008 — Engagement rename + Placement derivation", () => {
  it("backfills Engagement.providerOrganisationId/relationshipType from the old field names, leaving old fields in place", async () => {
    const db = await seedPreMigration008Data();
    await migration008EngagementPlacementRefinement(db);

    const eng1 = await db.engagements.getById("eng-1");
    expect(eng1.providerOrganisationId).toBe("org-1");
    expect(eng1.relationshipType).toBe("agency_worker");
    expect(eng1.employerOrganisationId).toBe("org-1");
    expect(eng1.role).toBe("agency_worker");
  });

  it("derives exactly one shared Placement for two Assignments with the same (provider, site, rateCardLineage) triple", async () => {
    const db = await seedPreMigration008Data();
    await migration008EngagementPlacementRefinement(db);

    const placements = await db.placements.getAll();
    expect(placements).toHaveLength(1);
    expect(placements[0].providerOrganisationId).toBe("org-1");
    expect(placements[0].siteId).toBe("site-1");
    expect(placements[0].rateCardLineageId).toBe("rc-1");
    // Earliest startDate among the matching assignments.
    expect(placements[0].effectiveFrom).toBe("2026-01-05");

    const assign1 = await db.assignments.getById("assign-1");
    const assign2 = await db.assignments.getById("assign-2");
    expect(assign1.placementId).toBe(placements[0].id);
    expect(assign2.placementId).toBe(placements[0].id);
    // Assignment.id is never changed or reinserted.
    expect(assign1.id).toBe("assign-1");
    expect(assign2.id).toBe("assign-2");
  });

  it("never reuses an existing Assignment id as the new Placement id", async () => {
    const db = await seedPreMigration008Data();
    await migration008EngagementPlacementRefinement(db);

    const placements = await db.placements.getAll();
    expect(placements[0].id).not.toBe("assign-1");
    expect(placements[0].id).not.toBe("assign-2");
    expect(placements[0].id).toMatch(/^placement-/);
  });

  it("is idempotent — a from-scratch re-run doesn't duplicate a Placement or change Assignment ids", async () => {
    const db = await seedPreMigration008Data();
    await migration008EngagementPlacementRefinement(db);
    const placementsAfterFirst = await db.placements.getAll();
    const assign1AfterFirst = await db.assignments.getById("assign-1");

    await migration008EngagementPlacementRefinement(db);
    const placementsAfterSecond = await db.placements.getAll();
    const assign1AfterSecond = await db.assignments.getById("assign-1");

    expect(placementsAfterSecond).toHaveLength(placementsAfterFirst.length);
    expect(assign1AfterSecond).toEqual(assign1AfterFirst);
  });

  it("two distinct (provider, site, rateCardLineage) triples produce two distinct Placements", async () => {
    const db = await seedPreMigration008Data();
    await db.rateCards.insert({ id: "rc-2", workspaceId: "ws-1", lineageId: "rc-2", version: 1, supersedesId: null, effectiveFrom: "2026-01-01", rates: {} });
    await db.engagements.insert({
      id: "eng-3",
      employerOrganisationId: "org-1",
      workspaceId: "ws-1",
      driverId: "person-3",
      role: "agency_worker",
      startDate: "2026-03-01",
      endDate: null,
      status: "active",
    });
    await db.assignments.insert({
      id: "assign-3",
      engagementId: "eng-3",
      siteId: "site-1",
      rateCardLineageId: "rc-2",
      startDate: "2026-03-01",
      endDate: null,
    });

    await migration008EngagementPlacementRefinement(db);

    const placements = await db.placements.getAll();
    expect(placements).toHaveLength(2);
  });
});
