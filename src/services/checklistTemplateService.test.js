import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import {
  createChecklistTemplate,
  updateChecklistTemplate,
  archiveChecklistTemplate,
  restoreChecklistTemplate,
  setDefaultChecklistTemplate,
  listChecklistTemplatesForWorkspace,
  resolveDefaultChecklistTemplateForWorkspace,
} from "./checklistTemplateService.js";

const ITEMS_FIXTURE = [
  { code: "item-1", label: "Tyres", category: "Tyres & wheels" },
  { code: "item-2", label: "Lights", category: "Lights" },
];

describe("checklistTemplateService", () => {
  it("creates a checklist template scoped to a workspace, defaulting to not-default", async () => {
    const { db } = await createTestDb();
    const template = await createChecklistTemplate(
      { workspaceId: "workspace-demo-agency", name: "Custom checklist", items: ITEMS_FIXTURE },
      db
    );
    expect(template.name).toBe("Custom checklist");
    expect(template.items).toEqual(ITEMS_FIXTURE);
    expect(template.isDefault).toBe(false);
    expect(template.archivedAt).toBeNull();
  });

  it("rejects creating a template with no items", async () => {
    const { db } = await createTestDb();
    await expect(
      createChecklistTemplate({ workspaceId: "workspace-demo-agency", name: "Empty", items: [] }, db)
    ).rejects.toThrow();
  });

  it("rejects an item missing a label or category", async () => {
    const { db } = await createTestDb();
    await expect(
      createChecklistTemplate(
        { workspaceId: "workspace-demo-agency", name: "Bad", items: [{ code: "x", label: "", category: "Cab" }] },
        db
      )
    ).rejects.toThrow();
  });

  it("updateChecklistTemplate edits name/items without touching isDefault", async () => {
    const { db } = await createTestDb();
    const template = await createChecklistTemplate(
      { workspaceId: "workspace-demo-agency", name: "Original", items: ITEMS_FIXTURE },
      db
    );
    await setDefaultChecklistTemplate(template.id, "workspace-demo-agency", db);

    const newItems = [...ITEMS_FIXTURE, { code: "item-3", label: "Brakes", category: "Braking system" }];
    await updateChecklistTemplate(template.id, { name: "Renamed", items: newItems }, db);

    const updated = await db.checklistTemplates.getById(template.id);
    expect(updated.name).toBe("Renamed");
    expect(updated.items).toHaveLength(3);
    expect(updated.isDefault).toBe(true); // untouched by the name/items-only patch
  });

  it("listChecklistTemplatesForWorkspace is workspace-scoped", async () => {
    const { db } = await createTestDb();
    await createChecklistTemplate({ workspaceId: "workspace-demo-agency", name: "A", items: ITEMS_FIXTURE }, db);
    await createChecklistTemplate({ workspaceId: "workspace-personal-demo", name: "B", items: ITEMS_FIXTURE }, db);

    const demoTemplates = await listChecklistTemplatesForWorkspace("workspace-demo-agency", db);
    expect(demoTemplates.some((t) => t.name === "A")).toBe(true);
    expect(demoTemplates.some((t) => t.name === "B")).toBe(false);
  });

  it("archive/restore round-trip", async () => {
    const { db } = await createTestDb();
    const template = await createChecklistTemplate({ workspaceId: "workspace-demo-agency", name: "X", items: ITEMS_FIXTURE }, db);

    await archiveChecklistTemplate(template.id, db);
    expect((await db.checklistTemplates.getById(template.id)).archivedAt).toBeTruthy();

    await restoreChecklistTemplate(template.id, db);
    expect((await db.checklistTemplates.getById(template.id)).archivedAt).toBeNull();
  });

  describe("setDefaultChecklistTemplate", () => {
    it("sets exactly one default per workspace, unsetting any previous one", async () => {
      const { db } = await createTestDb();
      const a = await createChecklistTemplate({ workspaceId: "workspace-demo-agency", name: "A", items: ITEMS_FIXTURE }, db);
      const b = await createChecklistTemplate({ workspaceId: "workspace-demo-agency", name: "B", items: ITEMS_FIXTURE }, db);

      await setDefaultChecklistTemplate(a.id, "workspace-demo-agency", db);
      expect((await db.checklistTemplates.getById(a.id)).isDefault).toBe(true);
      expect((await db.checklistTemplates.getById(b.id)).isDefault).toBe(false);

      await setDefaultChecklistTemplate(b.id, "workspace-demo-agency", db);
      expect((await db.checklistTemplates.getById(a.id)).isDefault).toBe(false);
      expect((await db.checklistTemplates.getById(b.id)).isDefault).toBe(true);
    });

    it("never affects another workspace's default", async () => {
      const { db } = await createTestDb();
      const demoTemplate = await createChecklistTemplate({ workspaceId: "workspace-demo-agency", name: "Demo", items: ITEMS_FIXTURE }, db);
      const personalTemplate = await createChecklistTemplate(
        { workspaceId: "workspace-personal-demo", name: "Personal", items: ITEMS_FIXTURE },
        db
      );
      await setDefaultChecklistTemplate(personalTemplate.id, "workspace-personal-demo", db);

      await setDefaultChecklistTemplate(demoTemplate.id, "workspace-demo-agency", db);

      expect((await db.checklistTemplates.getById(demoTemplate.id)).isDefault).toBe(true);
      expect((await db.checklistTemplates.getById(personalTemplate.id)).isDefault).toBe(true); // untouched
    });
  });
});

describe("checklistTemplateService — resolveDefaultChecklistTemplateForWorkspace (Stage VC-2)", () => {
  it("resolves migration 009's seeded default when nothing else has been created", async () => {
    const { db } = await createTestDb();
    const resolved = await resolveDefaultChecklistTemplateForWorkspace("workspace-demo-agency", db);
    expect(resolved).toBeTruthy();
    expect(resolved.name).toBe("Daily walkaround (default)");
  });

  it("resolves the newly-set default after setDefaultChecklistTemplate", async () => {
    const { db } = await createTestDb();
    const custom = await createChecklistTemplate({ workspaceId: "workspace-demo-agency", name: "Custom", items: ITEMS_FIXTURE }, db);
    await setDefaultChecklistTemplate(custom.id, "workspace-demo-agency", db);

    const resolved = await resolveDefaultChecklistTemplateForWorkspace("workspace-demo-agency", db);
    expect(resolved.id).toBe(custom.id);
  });

  it("returns null when the workspace's only default has been archived", async () => {
    const { db } = await createTestDb();
    const [seeded] = await listChecklistTemplatesForWorkspace("workspace-demo-agency", db);
    await archiveChecklistTemplate(seeded.id, db);

    expect(await resolveDefaultChecklistTemplateForWorkspace("workspace-demo-agency", db)).toBeNull();
  });

  it("is workspace-scoped", async () => {
    const { db } = await createTestDb();
    const resolved = await resolveDefaultChecklistTemplateForWorkspace("workspace-personal-demo", db);
    expect(resolved.name).toBe("Daily walkaround (default)");
    expect(resolved.workspaceId).toBe("workspace-personal-demo");
  });
});
