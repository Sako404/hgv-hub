import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import {
  createVehicle,
  updateVehicle,
  archiveVehicle,
  restoreVehicle,
  listVehiclesForWorkspace,
  resolveAvailableVehiclesForDriver,
} from "./vehicleService.js";

describe("vehicleService", () => {
  it("creates a vehicle scoped to a workspace", async () => {
    const { db } = await createTestDb();
    const vehicle = await createVehicle(
      { workspaceId: "workspace-demo-agency", registration: "AB12 CDE", vehicleType: "tractor_unit", make: "DAF", model: "XF" },
      db
    );
    expect(vehicle.registration).toBe("AB12 CDE");
    expect(vehicle.vehicleType).toBe("tractor_unit");
    expect(vehicle.archivedAt).toBeNull();
  });

  it("rejects creating a vehicle with no registration", async () => {
    const { db } = await createTestDb();
    await expect(
      createVehicle({ workspaceId: "workspace-demo-agency", registration: "", vehicleType: "rigid" }, db)
    ).rejects.toThrow();
  });

  it("rejects editing a vehicle down to an empty registration", async () => {
    const { db } = await createTestDb();
    const vehicle = await createVehicle({ workspaceId: "workspace-demo-agency", registration: "XY99 ZZZ", vehicleType: "van" }, db);
    await expect(updateVehicle(vehicle.id, { registration: "" }, db)).rejects.toThrow();
  });

  it("listVehiclesForWorkspace is workspace-scoped", async () => {
    const { db } = await createTestDb();
    await createVehicle({ workspaceId: "workspace-demo-agency", registration: "AA11 AAA", vehicleType: "rigid" }, db);
    await createVehicle({ workspaceId: "workspace-personal-demo", registration: "BB22 BBB", vehicleType: "van" }, db);

    const demoVehicles = await listVehiclesForWorkspace("workspace-demo-agency", db);
    expect(demoVehicles.some((v) => v.registration === "AA11 AAA")).toBe(true);
    expect(demoVehicles.some((v) => v.registration === "BB22 BBB")).toBe(false);
  });

  it("archive/restore round-trip", async () => {
    const { db } = await createTestDb();
    const vehicle = await createVehicle({ workspaceId: "workspace-demo-agency", registration: "CC33 CCC", vehicleType: "trailer" }, db);

    await archiveVehicle(vehicle.id, db);
    expect((await db.vehicles.getById(vehicle.id)).archivedAt).toBeTruthy();

    await restoreVehicle(vehicle.id, db);
    expect((await db.vehicles.getById(vehicle.id)).archivedAt).toBeNull();
  });
});

describe("vehicleService — resolveAvailableVehiclesForDriver (Stage VC-2)", () => {
  it("includes vehicles from the driver's home workspace and every active-assignment workspace", async () => {
    const { db } = await createTestDb();
    // person-demo's fixture: home workspace-personal-demo, one
    // active assignment at workspace-demo-agency (migration 002).
    await createVehicle({ workspaceId: "workspace-personal-demo", registration: "HOME 001", vehicleType: "van" }, db);
    await createVehicle({ workspaceId: "workspace-demo-agency", registration: "DEMO 001", vehicleType: "tractor_unit" }, db);
    await createVehicle({ workspaceId: "workspace-unrelated", registration: "OTHER 001", vehicleType: "rigid" }, db);

    const vehicles = await resolveAvailableVehiclesForDriver("person-demo", "workspace-personal-demo", db);
    const registrations = vehicles.map((v) => v.registration);
    expect(registrations).toContain("HOME 001");
    expect(registrations).toContain("DEMO 001");
    expect(registrations).not.toContain("OTHER 001");
  });

  it("excludes archived vehicles", async () => {
    const { db } = await createTestDb();
    const vehicle = await createVehicle({ workspaceId: "workspace-demo-agency", registration: "ARCH 001", vehicleType: "van" }, db);
    await archiveVehicle(vehicle.id, db);

    const vehicles = await resolveAvailableVehiclesForDriver("person-demo", "workspace-personal-demo", db);
    expect(vehicles.some((v) => v.registration === "ARCH 001")).toBe(false);
  });

  it("returns an empty list for a driver with no home workspace and no active assignments", async () => {
    const { db } = await createTestDb();
    await createVehicle({ workspaceId: "workspace-demo-agency", registration: "IRRELEVANT", vehicleType: "van" }, db);

    const vehicles = await resolveAvailableVehiclesForDriver("person-nobody", null, db);
    expect(vehicles).toHaveLength(0);
  });
});
