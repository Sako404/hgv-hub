import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import { seedSecondCompany } from "./seed/seedSecondCompany.js";
import { exportWorkspace, importWorkspace } from "./exportImportService.js";
import { createDb } from "../storage/db.js";
import { createInMemoryStorage } from "../../test/inMemoryStorage.js";

describe("export/import — workspace-scoped, no cross-workspace leak", () => {
  it("round-trips a seeded company workspace into a fresh empty db", async () => {
    const { db: sourceDb } = await createTestDb();
    const seed = await seedSecondCompany(sourceDb);

    const bundle = await exportWorkspace(seed.companyWorkspaceId, sourceDb);
    expect(bundle.workspace.id).toBe(seed.companyWorkspaceId);
    // Alex's personal/agency data must NOT appear in this bundle.
    expect(bundle.shifts.every((s) => s.workspaceId === seed.companyWorkspaceId)).toBe(true);
    expect(bundle.rateCards.every((r) => r.workspaceId === seed.companyWorkspaceId)).toBe(true);

    const targetDb = createDb(createInMemoryStorage());
    await importWorkspace(bundle, targetDb);

    expect(await targetDb.workspaces.getById(seed.companyWorkspaceId)).toBeTruthy();
    expect((await targetDb.shifts.getAll()).length).toBe(bundle.shifts.length);
    // Nothing from Alex's workspaces leaked in.
    expect(await targetDb.workspaces.getById("workspace-personal-demo")).toBeUndefined();
    expect(await targetDb.shifts.query({ where: { workspaceId: "workspace-demo-agency" } })).toHaveLength(0);
  });

  it("is idempotent on repeated import (upsert, not duplicate)", async () => {
    const { db: sourceDb } = await createTestDb();
    const seed = await seedSecondCompany(sourceDb);
    const bundle = await exportWorkspace(seed.companyWorkspaceId, sourceDb);

    const targetDb = createDb(createInMemoryStorage());
    await importWorkspace(bundle, targetDb);
    await importWorkspace(bundle, targetDb);

    expect((await targetDb.shifts.getAll()).length).toBe(bundle.shifts.length);
  });
});
