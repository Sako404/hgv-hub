import { describe, expect, it } from "vitest";
import { createDb } from "../storage/db.js";
import { createInMemoryStorage } from "../../test/inMemoryStorage.js";
import { migration005AddMasterDataFoundation } from "./005_add_master_data_foundation.js";
import { migration006FixEmployerAndClientOrganisations } from "./006_fix_employer_and_client_organisations.js";

async function seedPreMigration006Data() {
  const db = createDb(createInMemoryStorage());
  await db.workspaces.insert({ id: "ws-1", kind: "agency", name: "Agency", ownerPersonId: null, createdAt: "now" });
  await db.organisations.insert({ id: "org-1", workspaceId: "ws-1", legalName: "Agency", tradingName: "Agency" });
  await db.sites.insert({ id: "site-1", organisationId: "org-1", name: "Client Site", kind: "client_site", clientName: "BigClient" });
  await db.sites.insert({ id: "site-2", organisationId: "org-1", name: "Own Depot", kind: "depot", clientName: null });
  await db.engagements.insert({ id: "eng-1", organisationId: "org-1", workspaceId: "ws-1", driverId: "person-1", role: "agency_worker", startDate: "2026-01-01", endDate: null, status: "active" });
  // A real boot always runs 005 before 006 — org-1 gets types:["agency"] first.
  await migration005AddMasterDataFoundation(db);
  return db;
}

describe("migration 006 — Engagement.employerOrganisationId + Site -> client Organisation fix", () => {
  it("backfills Engagement.employerOrganisationId from the old organisationId", async () => {
    const db = await seedPreMigration006Data();
    await migration006FixEmployerAndClientOrganisations(db);
    expect((await db.engagements.getById("eng-1")).employerOrganisationId).toBe("org-1");
  });

  it("creates a proper client Organisation from Site.clientName and re-points organisationId, leaving self-owned sites untouched", async () => {
    const db = await seedPreMigration006Data();
    await migration006FixEmployerAndClientOrganisations(db);

    const clientSite = await db.sites.getById("site-1");
    const clientOrg = await db.organisations.getById(clientSite.organisationId);
    expect(clientOrg.tradingName).toBe("BigClient");
    expect(clientOrg.types).toEqual(["client"]);
    expect(clientOrg.workspaceId).toBe("ws-1");
    expect(clientOrg.id).not.toBe("org-1");

    // The depot site (clientName: null) is untouched.
    expect((await db.sites.getById("site-2")).organisationId).toBe("org-1");
  });

  it("is idempotent — re-running does not create a duplicate client Organisation", async () => {
    const db = await seedPreMigration006Data();
    await migration006FixEmployerAndClientOrganisations(db);
    await migration006FixEmployerAndClientOrganisations(db);

    const bigClientOrgs = await db.organisations.query({ where: { tradingName: "BigClient" } });
    expect(bigClientOrgs).toHaveLength(1);
  });
});
