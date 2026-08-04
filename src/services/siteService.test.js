import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import { createOrganisation } from "./organisationService.js";
import { createSite, updateSite, archiveSite, restoreSite, listSitesForWorkspace, siteHasAssignmentHistory } from "./siteService.js";

describe("siteService", () => {
  it("creates a site under an organisation", async () => {
    const { db } = await createTestDb();
    const site = await createSite({ organisationId: "org-demo-agency", name: "New Depot", kind: "depot" }, db);
    expect(site.organisationId).toBe("org-demo-agency");
    expect(site.archivedAt).toBeNull();
  });

  it("listSitesForWorkspace is scoped via the workspace's organisations", async () => {
    const { db } = await createTestDb();
    const otherOrg = await createOrganisation(
      { workspaceId: "workspace-personal-demo", legalName: "X", tradingName: "X", types: ["other"] },
      db
    );
    await createSite({ organisationId: otherOrg.id, name: "Not Demo's site" }, db);

    const demoSites = await listSitesForWorkspace("workspace-demo-agency", db);
    expect(demoSites.some((s) => s.name === "Not Demo's site")).toBe(false);
    // migration002's real Example Logistics Depot A site is scoped correctly via
    // its client organisation's workspaceId (Part 4 fix — see migration 006).
    expect(demoSites.some((s) => s.name.includes("Example Logistics"))).toBe(true);
  });

  it("organisation is editable while zero Assignments have ever referenced the site", async () => {
    const { db } = await createTestDb();
    const orgA = await createOrganisation({ workspaceId: "workspace-demo-agency", legalName: "A", tradingName: "A", types: ["client"] }, db);
    const orgB = await createOrganisation({ workspaceId: "workspace-demo-agency", legalName: "B", tradingName: "B", types: ["client"] }, db);
    const site = await createSite({ organisationId: orgA.id, name: "Test Site" }, db);

    const updated = await updateSite(site.id, { organisationId: orgB.id }, db);
    expect(updated.organisationId).toBe(orgB.id);
  });

  it("organisation locks permanently once any Assignment (active or ended) references the site", async () => {
    const { db } = await createTestDb();
    // migration002's real site+assignment already reference each other.
    const referencedSiteId = "site-demo-client";
    expect(await siteHasAssignmentHistory(referencedSiteId, db)).toBe(true);

    const orgB = await createOrganisation({ workspaceId: "workspace-demo-agency", legalName: "B", tradingName: "B", types: ["client"] }, db);
    await expect(updateSite(referencedSiteId, { organisationId: orgB.id }, db)).rejects.toThrow();

    // Non-organisationId fields stay editable.
    const updated = await updateSite(referencedSiteId, { notes: "updated note" }, db);
    expect(updated.notes).toBe("updated note");
  });

  it("archive/restore round-trip", async () => {
    const { db } = await createTestDb();
    const org = await createOrganisation({ workspaceId: "workspace-demo-agency", legalName: "A", tradingName: "A", types: ["client"] }, db);
    const site = await createSite({ organisationId: org.id, name: "Test Site" }, db);

    await archiveSite(site.id, db);
    expect((await db.sites.getById(site.id)).archivedAt).toBeTruthy();

    await restoreSite(site.id, db);
    expect((await db.sites.getById(site.id)).archivedAt).toBeNull();
  });
});
