import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import { seedSecondCompany } from "./seed/seedSecondCompany.js";
import { createVehicle } from "./vehicleService.js";
import { createDefect } from "./defectService.js";
import { createDriverDocument } from "./driverDocumentService.js";
import { resolveTransportManagerDashboardData, resolveTransportManagerWorkspaces } from "./transportManagerService.js";

const TODAY = new Date("2026-08-04T00:00:00");

async function grantTransportManagerRole(personId, workspaceId, db) {
  const membership = (await db.memberships.query({ where: { workspaceId, personId } }))[0];
  await db.memberships.update(membership.id, { roles: [...membership.roles, "transport_manager"] });
}

describe("resolveTransportManagerWorkspaces", () => {
  it("returns only workspaces where the person holds transport_manager, with active vehicle counts", async () => {
    const { db } = await createTestDb();
    const seed = await seedSecondCompany(db);
    await grantTransportManagerRole(seed.ownerPersonId, seed.companyWorkspaceId, db);

    const active = await createVehicle({ workspaceId: seed.companyWorkspaceId, registration: "AB12CDE", vehicleType: "rigid" }, db);
    const archived = await createVehicle({ workspaceId: seed.companyWorkspaceId, registration: "XY99ZZZ", vehicleType: "rigid" }, db);
    await db.vehicles.update(archived.id, { archivedAt: new Date().toISOString() });

    const result = await resolveTransportManagerWorkspaces(seed.ownerPersonId, db);
    expect(result).toHaveLength(1);
    expect(result[0].workspaceId).toBe(seed.companyWorkspaceId);
    expect(result[0].vehicleCount).toBe(1);
    expect(active).toBeTruthy();
  });

  it("returns nothing for a person with no transport_manager role anywhere", async () => {
    const { db } = await createTestDb();
    const seed = await seedSecondCompany(db);
    const result = await resolveTransportManagerWorkspaces(seed.ownerPersonId, db);
    expect(result).toEqual([]);
  });
});

describe("resolveTransportManagerDashboardData", () => {
  it("rolls up driver document/CPC status and vehicle defect/roadworthiness status for one workspace", async () => {
    const { db } = await createTestDb();
    const seed = await seedSecondCompany(db);
    await grantTransportManagerRole(seed.ownerPersonId, seed.companyWorkspaceId, db);

    const driverPersonId = seed.drivers[0].personId;
    await createDriverDocument({ personId: driverPersonId, documentType: "driving_licence", expiryDate: "2020-01-01" }, db); // expired

    const vehicle = await createVehicle(
      { workspaceId: seed.companyWorkspaceId, registration: "AB12CDE", vehicleType: "rigid", motExpiryDate: "2020-01-01", insuranceExpiryDate: "2030-01-01" },
      db
    );
    await createDefect(
      { workspaceId: seed.companyWorkspaceId, vehicleId: vehicle.id, raisedByDriverId: driverPersonId, severity: "dangerous", description: "Brake fault" },
      db
    );

    const result = await resolveTransportManagerDashboardData(seed.ownerPersonId, seed.companyWorkspaceId, db, TODAY);

    expect(result.drivers).toHaveLength(3);
    const driverRow = result.drivers.find((d) => d.personId === driverPersonId);
    expect(driverRow.documentStatus).toBe("expired");
    expect(driverRow.cpcCycleStatus.status).toBe("unknown_cycle");
    expect(driverRow.hoursStatus).toBe("ok");

    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0].motStatus).toBe("expired");
    expect(result.vehicles[0].insuranceStatus).toBe("ok");
    expect(result.vehicles[0].openDefectCount).toBe(1);
    expect(result.vehicles[0].hasDangerousDefect).toBe(true);

    expect(result.recommendedHours.minHours).toBe(2);
    expect(result.recommendedHours.maxHours).toBe(4);
    expect(result.externalTmLimitStatus.operatorCount).toBe(1);
    expect(result.externalTmLimitStatus.withinLimit).toBe(true);
  });

  it("excludes archived drivers and vehicles from the roll-up", async () => {
    const { db } = await createTestDb();
    const seed = await seedSecondCompany(db);
    await grantTransportManagerRole(seed.ownerPersonId, seed.companyWorkspaceId, db);

    const vehicle = await createVehicle({ workspaceId: seed.companyWorkspaceId, registration: "AB12CDE", vehicleType: "rigid" }, db);
    await db.vehicles.update(vehicle.id, { archivedAt: new Date().toISOString() });

    const result = await resolveTransportManagerDashboardData(seed.ownerPersonId, seed.companyWorkspaceId, db, TODAY);
    expect(result.vehicles).toHaveLength(0);
  });
});
