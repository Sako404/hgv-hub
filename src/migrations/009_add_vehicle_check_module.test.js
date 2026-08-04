import { describe, expect, it } from "vitest";
import { createDb } from "../storage/db.js";
import { createInMemoryStorage } from "../../test/inMemoryStorage.js";
import { migration009AddVehicleCheckModule } from "./009_add_vehicle_check_module.js";

async function seedWorkspaces() {
  const db = createDb(createInMemoryStorage());
  await db.workspaces.insert({ id: "ws-1", kind: "agency", name: "Agency", ownerPersonId: null, createdAt: "now" });
  await db.workspaces.insert({ id: "ws-2", kind: "personal", name: "Personal", ownerPersonId: "p1", createdAt: "now" });
  return db;
}

describe("migration 009 — Vehicle Check module foundation", () => {
  it("seeds one default ChecklistTemplate per existing workspace", async () => {
    const db = await seedWorkspaces();
    await migration009AddVehicleCheckModule(db);

    const ws1Templates = await db.checklistTemplates.query({ where: { workspaceId: "ws-1" } });
    expect(ws1Templates).toHaveLength(1);
    expect(ws1Templates[0].isDefault).toBe(true);
    expect(ws1Templates[0].items.length).toBeGreaterThan(0);
    expect(ws1Templates[0].archivedAt).toBeNull();

    const ws2Templates = await db.checklistTemplates.query({ where: { workspaceId: "ws-2" } });
    expect(ws2Templates).toHaveLength(1);
    expect(ws2Templates[0].isDefault).toBe(true);
  });

  it("every seeded item has a code, label, and category", async () => {
    const db = await seedWorkspaces();
    await migration009AddVehicleCheckModule(db);

    const [template] = await db.checklistTemplates.query({ where: { workspaceId: "ws-1" } });
    for (const item of template.items) {
      expect(item.code).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(item.category).toBeTruthy();
    }
    // Codes are unique within the template.
    const codes = template.items.map((i) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("is idempotent — a from-scratch re-run doesn't duplicate the default template", async () => {
    const db = await seedWorkspaces();
    await migration009AddVehicleCheckModule(db);
    await migration009AddVehicleCheckModule(db);

    const ws1Templates = await db.checklistTemplates.query({ where: { workspaceId: "ws-1" } });
    expect(ws1Templates).toHaveLength(1);
  });

  it("does not touch a workspace that already has a default template", async () => {
    const db = await seedWorkspaces();
    await db.checklistTemplates.insert({
      id: "custom-template",
      workspaceId: "ws-1",
      name: "Already customised",
      items: [{ code: "x", label: "Custom item", category: "Custom" }],
      isDefault: true,
      archivedAt: null,
      createdAt: "now",
    });

    await migration009AddVehicleCheckModule(db);

    const ws1Templates = await db.checklistTemplates.query({ where: { workspaceId: "ws-1" } });
    expect(ws1Templates).toHaveLength(1);
    expect(ws1Templates[0].name).toBe("Already customised");
  });
});
