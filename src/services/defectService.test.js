import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import { createVehicle } from "./vehicleService.js";
import { createDefect, raiseDefectsFromVehicleCheck, advanceDefectStatus } from "./defectService.js";

async function setUpVehicle(db) {
  return createVehicle({ workspaceId: "workspace-demo-agency", registration: "AB12 CDE", vehicleType: "rigid" }, db);
}

describe("defectService — createDefect", () => {
  it("creates a defect, always starting status 'open'", async () => {
    const { db } = await createTestDb();
    const vehicle = await setUpVehicle(db);
    const defect = await createDefect(
      { workspaceId: "workspace-demo-agency", vehicleId: vehicle.id, raisedByDriverId: "person-demo", severity: "major", description: "Cracked mirror" },
      db
    );
    expect(defect.status).toBe("open");
    expect(defect.severity).toBe("major");
    expect(defect.resolvedAt).toBeNull();
    expect(defect.resolvedNotes).toBeNull();
    expect(defect.raisedFromCheckId).toBeNull();
  });

  it("defaults severity to 'minor' when not specified", async () => {
    const { db } = await createTestDb();
    const vehicle = await setUpVehicle(db);
    const defect = await createDefect(
      { workspaceId: "workspace-demo-agency", vehicleId: vehicle.id, raisedByDriverId: "person-demo", description: "Small scratch" },
      db
    );
    expect(defect.severity).toBe("minor");
  });

  it("rejects a defect with no description", async () => {
    const { db } = await createTestDb();
    const vehicle = await setUpVehicle(db);
    await expect(
      createDefect({ workspaceId: "workspace-demo-agency", vehicleId: vehicle.id, raisedByDriverId: "person-demo", description: "" }, db)
    ).rejects.toThrow();
  });
});

describe("defectService — raiseDefectsFromVehicleCheck", () => {
  it("creates one Defect per failed item, none for ok/not_applicable items", async () => {
    const { db } = await createTestDb();
    const vehicle = await setUpVehicle(db);
    const check = {
      id: "check-1",
      workspaceId: "workspace-demo-agency",
      driverId: "person-demo",
      vehicleId: vehicle.id,
      items: [
        { code: "tyres", label: "Tyres", category: "Exterior", result: "ok", notes: null },
        { code: "lights", label: "Lights", category: "Exterior", result: "defect", notes: "Cracked lens" },
        { code: "horn", label: "Horn", category: "Cab", result: "not_applicable", notes: null },
      ],
    };

    const defects = await raiseDefectsFromVehicleCheck(check, db);

    expect(defects).toHaveLength(1);
    expect(defects[0].description).toBe("Lights: Cracked lens");
    expect(defects[0].raisedFromCheckId).toBe("check-1");
    expect(defects[0].raisedFromItemCode).toBe("lights");
    expect(defects[0].raisedByDriverId).toBe("person-demo");
    expect(defects[0].severity).toBe("minor");
  });

  it("falls back to the item label alone when no notes were given", async () => {
    const { db } = await createTestDb();
    const vehicle = await setUpVehicle(db);
    const check = {
      id: "check-2",
      workspaceId: "workspace-demo-agency",
      driverId: "person-demo",
      vehicleId: vehicle.id,
      items: [{ code: "horn", label: "Horn", category: "Cab", result: "defect", notes: null }],
    };

    const [defect] = await raiseDefectsFromVehicleCheck(check, db);
    expect(defect.description).toBe("Horn");
  });

  it("creates nothing for a check with no defect items", async () => {
    const { db } = await createTestDb();
    const vehicle = await setUpVehicle(db);
    const check = {
      id: "check-3",
      workspaceId: "workspace-demo-agency",
      driverId: "person-demo",
      vehicleId: vehicle.id,
      items: [{ code: "tyres", label: "Tyres", category: "Exterior", result: "ok", notes: null }],
    };

    const defects = await raiseDefectsFromVehicleCheck(check, db);
    expect(defects).toHaveLength(0);
    expect(await db.defects.getAll()).toHaveLength(0);
  });
});

describe("defectService — advanceDefectStatus", () => {
  it("moves through the linear workflow one step at a time: open -> reported -> in_progress -> resolved", async () => {
    const { db } = await createTestDb();
    const vehicle = await setUpVehicle(db);
    const defect = await createDefect(
      { workspaceId: "workspace-demo-agency", vehicleId: vehicle.id, raisedByDriverId: "person-demo", description: "X" },
      db
    );

    await advanceDefectStatus(defect.id, null, db);
    expect((await db.defects.getById(defect.id)).status).toBe("reported");

    await advanceDefectStatus(defect.id, null, db);
    expect((await db.defects.getById(defect.id)).status).toBe("in_progress");

    await advanceDefectStatus(defect.id, "Replaced the part", db);
    const resolved = await db.defects.getById(defect.id);
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedNotes).toBe("Replaced the part");
    expect(resolved.resolvedAt).toBeTruthy();
  });

  it("resolvedNotes is optional and only stored on the transition into resolved", async () => {
    const { db } = await createTestDb();
    const vehicle = await setUpVehicle(db);
    const defect = await createDefect(
      { workspaceId: "workspace-demo-agency", vehicleId: vehicle.id, raisedByDriverId: "person-demo", description: "X" },
      db
    );

    await advanceDefectStatus(defect.id, "ignored — not a resolve transition", db);
    const afterFirstAdvance = await db.defects.getById(defect.id);
    expect(afterFirstAdvance.status).toBe("reported");
    expect(afterFirstAdvance.resolvedNotes).toBeNull();
  });

  it("rejects advancing a defect that's already resolved", async () => {
    const { db } = await createTestDb();
    const vehicle = await setUpVehicle(db);
    const defect = await createDefect(
      { workspaceId: "workspace-demo-agency", vehicleId: vehicle.id, raisedByDriverId: "person-demo", description: "X" },
      db
    );
    await advanceDefectStatus(defect.id, null, db);
    await advanceDefectStatus(defect.id, null, db);
    await advanceDefectStatus(defect.id, null, db);

    await expect(advanceDefectStatus(defect.id, null, db)).rejects.toThrow();
  });
});
