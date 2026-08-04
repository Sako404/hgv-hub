import { describe, expect, it } from "vitest";
import { createDb } from "../storage/db.js";
import { createInMemoryStorage } from "../../test/inMemoryStorage.js";
import { migration005AddMasterDataFoundation } from "./005_add_master_data_foundation.js";

async function seedOldShapeData() {
  const db = createDb(createInMemoryStorage());
  await db.workspaces.insert({ id: "ws-1", kind: "agency", name: "Agency", ownerPersonId: null, createdAt: "now" });
  await db.organisations.insert({ id: "org-1", workspaceId: "ws-1", legalName: "Agency", tradingName: "Agency" });
  await db.sites.insert({ id: "site-1", organisationId: "org-1", name: "Depot", kind: "depot", clientName: null });
  await db.memberships.insert({ id: "mem-1", workspaceId: "ws-1", personId: "person-1", roles: ["driver"], createdAt: "now" });
  await db.driverProfiles.insert({ id: "dp-1", personId: "person-1", defaultBreakMinutes: 45, createdAt: "now" });
  await db.rateCards.insert({ id: "rc-1", workspaceId: "ws-1", lineageId: "rc-1", version: 1, supersedesId: null, name: "Standard", effectiveFrom: "2026-01-01", rates: {} });
  await db.rateCards.insert({ id: "rc-2", workspaceId: "ws-1", lineageId: "rc-1", version: 2, supersedesId: "rc-1", effectiveFrom: "2026-06-01", rates: {} });
  return db;
}

describe("migration 005 — additive master-data schema foundation", () => {
  it("backfills types/archivedAt/address/notes/lastUsedAssignmentId, and creates one RateCardLineage row per lineage", async () => {
    const db = await seedOldShapeData();
    await migration005AddMasterDataFoundation(db);

    const org = await db.organisations.getById("org-1");
    expect(org.types).toEqual(["agency"]);
    expect(org.archivedAt).toBeNull();

    const site = await db.sites.getById("site-1");
    expect(site.archivedAt).toBeNull();
    expect(site.address).toBeNull();
    expect(site.notes).toBeNull();

    const membership = await db.memberships.getById("mem-1");
    expect(membership.archivedAt).toBeNull();

    const driverProfile = await db.driverProfiles.getById("dp-1");
    expect(driverProfile.lastUsedAssignmentId).toBeNull();

    const lineage = await db.rateCardLineages.getById("rc-1");
    expect(lineage).toBeTruthy();
    expect(lineage.workspaceId).toBe("ws-1");
    expect(lineage.name).toBe("Standard");
    expect(lineage.archivedAt).toBeNull();
    // Two RateCard versions share lineageId "rc-1" -> exactly one lineage row.
    expect(await db.rateCardLineages.getAll()).toHaveLength(1);
  });

  it("is idempotent — a from-scratch re-run doesn't duplicate or error", async () => {
    const db = await seedOldShapeData();
    await migration005AddMasterDataFoundation(db);
    await migration005AddMasterDataFoundation(db);

    expect(await db.rateCardLineages.getAll()).toHaveLength(1);
    expect((await db.organisations.getById("org-1")).types).toEqual(["agency"]);
  });

  it("infers transport_company types correctly; other workspace kinds fall back to 'other'", async () => {
    const db = createDb(createInMemoryStorage());
    await db.workspaces.insert({ id: "ws-2", kind: "transport_company", name: "TC", ownerPersonId: null, createdAt: "now" });
    await db.organisations.insert({ id: "org-2", workspaceId: "ws-2", legalName: "TC", tradingName: "TC" });
    await db.workspaces.insert({ id: "ws-3", kind: "personal", name: "P", ownerPersonId: "p1", createdAt: "now" });
    await db.organisations.insert({ id: "org-3", workspaceId: "ws-3", legalName: "Self-employed", tradingName: "Self-employed" });

    await migration005AddMasterDataFoundation(db);

    expect((await db.organisations.getById("org-2")).types).toEqual(["transport_company"]);
    expect((await db.organisations.getById("org-3")).types).toEqual(["other"]);
  });
});
