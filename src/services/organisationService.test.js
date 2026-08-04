import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import {
  createOrganisation,
  updateOrganisation,
  archiveOrganisation,
  restoreOrganisation,
  listOrganisationsForWorkspace,
} from "./organisationService.js";

describe("organisationService", () => {
  it("creates an organisation scoped to a workspace, with multiple types", async () => {
    const { db } = await createTestDb();
    const org = await createOrganisation(
      { workspaceId: "workspace-demo-agency", legalName: "Northline Transport Ltd", tradingName: "Northline Transport", types: ["transport_company", "client"] },
      db
    );
    expect(org.types).toEqual(["transport_company", "client"]);
    expect(org.archivedAt).toBeNull();
  });

  it("rejects creating an organisation with no types", async () => {
    const { db } = await createTestDb();
    await expect(
      createOrganisation({ workspaceId: "workspace-demo-agency", legalName: "X", tradingName: "X", types: [] }, db)
    ).rejects.toThrow();
  });

  it("rejects editing an organisation down to zero types", async () => {
    const { db } = await createTestDb();
    const org = await createOrganisation({ workspaceId: "workspace-demo-agency", legalName: "X", tradingName: "X", types: ["client"] }, db);
    await expect(updateOrganisation(org.id, { types: [] }, db)).rejects.toThrow();
  });

  it("listOrganisationsForWorkspace is workspace-scoped", async () => {
    const { db } = await createTestDb();
    await createOrganisation({ workspaceId: "workspace-demo-agency", legalName: "A", tradingName: "A", types: ["client"] }, db);
    await createOrganisation({ workspaceId: "workspace-personal-demo", legalName: "B", tradingName: "B", types: ["other"] }, db);

    const demoOrgs = await listOrganisationsForWorkspace("workspace-demo-agency", db);
    expect(demoOrgs.some((o) => o.tradingName === "A")).toBe(true);
    expect(demoOrgs.some((o) => o.tradingName === "B")).toBe(false);
  });

  it("archive/restore round-trip", async () => {
    const { db } = await createTestDb();
    const org = await createOrganisation({ workspaceId: "workspace-demo-agency", legalName: "X", tradingName: "X", types: ["client"] }, db);

    await archiveOrganisation(org.id, db);
    expect((await db.organisations.getById(org.id)).archivedAt).toBeTruthy();

    await restoreOrganisation(org.id, db);
    expect((await db.organisations.getById(org.id)).archivedAt).toBeNull();
  });
});
