import { describe, expect, it } from "vitest";
import { createDb } from "../storage/db.js";
import { createInMemoryStorage } from "../../test/inMemoryStorage.js";
import { migration014AddVehicleRoadworthinessFields } from "./014_add_vehicle_roadworthiness_fields.js";

describe("migration 014 — vehicle roadworthiness fields backfill", () => {
  it("backfills motExpiryDate/insuranceExpiryDate: null onto an existing Vehicle that predates them", async () => {
    const db = createDb(createInMemoryStorage());
    await db.vehicles.insert({
      id: "vehicle-1",
      workspaceId: "ws-1",
      registration: "AB12CDE",
      vehicleType: "rigid",
      make: null,
      model: null,
      notes: null,
      archivedAt: null,
      createdAt: "now",
    });

    await migration014AddVehicleRoadworthinessFields(db);

    const vehicle = await db.vehicles.getById("vehicle-1");
    expect(vehicle.motExpiryDate).toBeNull();
    expect(vehicle.insuranceExpiryDate).toBeNull();
  });

  it("is idempotent — a from-scratch re-run doesn't error or overwrite an already-set value", async () => {
    const db = createDb(createInMemoryStorage());
    await db.vehicles.insert({
      id: "vehicle-1",
      workspaceId: "ws-1",
      registration: "AB12CDE",
      vehicleType: "rigid",
      make: null,
      model: null,
      notes: null,
      motExpiryDate: "2027-01-01",
      insuranceExpiryDate: "2027-06-01",
      archivedAt: null,
      createdAt: "now",
    });

    await migration014AddVehicleRoadworthinessFields(db);
    await migration014AddVehicleRoadworthinessFields(db);

    const vehicle = await db.vehicles.getById("vehicle-1");
    expect(vehicle.motExpiryDate).toBe("2027-01-01");
    expect(vehicle.insuranceExpiryDate).toBe("2027-06-01");
  });
});
