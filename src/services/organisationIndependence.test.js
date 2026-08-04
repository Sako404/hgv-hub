import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import { newId } from "../domain/ids.js";
import { createOrganisation, listOrganisationsForWorkspace } from "./organisationService.js";
import { createSite } from "./siteService.js";
import { createRateCard } from "./rateCardService.js";

const RATES_A = { MonThu: { Days: [10, 11], Lates: [10, 11], Nights: [10, 11] }, Fri: { Days: [10, 11], Lates: [10, 11], Nights: [10, 11] }, Sat: { Days: [10, 11], Lates: [10, 11], Nights: [10, 11] }, Sun: { Days: [10, 11], Lates: [10, 11], Nights: [10, 11] } };
const RATES_B = { MonThu: { Days: [99, 100], Lates: [99, 100], Nights: [99, 100] }, Fri: { Days: [99, 100], Lates: [99, 100], Nights: [99, 100] }, Sat: { Days: [99, 100], Lates: [99, 100], Nights: [99, 100] }, Sun: { Days: [99, 100], Lates: [99, 100], Nights: [99, 100] } };

describe("Organisation/Site independence across agency workspaces", () => {
  it("the same client name + site name can carry a different Rate Card under two different agencies", async () => {
    const { db } = await createTestDb();

    const agencyAWorkspaceId = newId("workspace");
    await db.workspaces.insert({ id: agencyAWorkspaceId, kind: "agency", name: "Agency A", ownerPersonId: null, createdAt: "now" });
    const clientUnderA = await createOrganisation({ workspaceId: agencyAWorkspaceId, legalName: "Parcel Line", tradingName: "Parcel Line", types: ["client"] }, db);
    const siteUnderA = await createSite({ organisationId: clientUnderA.id, name: "Northfield Depot" }, db);
    const rateCardA = await createRateCard(
      { workspaceId: agencyAWorkspaceId, name: "Agency A — Parcel Line Northfield", effectiveFrom: "2026-01-01", rates: RATES_A },
      db
    );

    const agencyBWorkspaceId = newId("workspace");
    await db.workspaces.insert({ id: agencyBWorkspaceId, kind: "agency", name: "Agency B", ownerPersonId: null, createdAt: "now" });
    const clientUnderB = await createOrganisation({ workspaceId: agencyBWorkspaceId, legalName: "Parcel Line", tradingName: "Parcel Line", types: ["client"] }, db);
    const siteUnderB = await createSite({ organisationId: clientUnderB.id, name: "Northfield Depot" }, db);
    const rateCardB = await createRateCard(
      { workspaceId: agencyBWorkspaceId, name: "Agency B — Parcel Line Northfield", effectiveFrom: "2026-01-01", rates: RATES_B },
      db
    );

    // Distinct records throughout — no shared/global "Parcel Line" or "Northfield" entity.
    expect(clientUnderA.id).not.toBe(clientUnderB.id);
    expect(siteUnderA.id).not.toBe(siteUnderB.id);
    expect(rateCardA.rates).not.toEqual(rateCardB.rates);

    // Each agency only ever sees its own copy.
    const orgsForA = await listOrganisationsForWorkspace(agencyAWorkspaceId, db);
    expect(orgsForA.some((o) => o.id === clientUnderB.id)).toBe(false);
    const orgsForB = await listOrganisationsForWorkspace(agencyBWorkspaceId, db);
    expect(orgsForB.some((o) => o.id === clientUnderA.id)).toBe(false);
  });
});
