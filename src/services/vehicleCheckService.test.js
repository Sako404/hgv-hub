import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import { createVehicle } from "./vehicleService.js";
import { createChecklistTemplate, setDefaultChecklistTemplate } from "./checklistTemplateService.js";
import { createVehicleCheck, listVehicleChecksForDriver, listVehicleChecksForWorkspace } from "./vehicleCheckService.js";

const ITEMS_FIXTURE = [
  { code: "item-1", label: "Tyres", category: "Tyres & wheels" },
  { code: "item-2", label: "Lights", category: "Lights" },
];

async function setUp(db) {
  const vehicle = await createVehicle(
    { workspaceId: "workspace-demo-agency", registration: "AB12 CDE", vehicleType: "rigid" },
    db
  );
  const template = await createChecklistTemplate(
    { workspaceId: "workspace-demo-agency", name: "Standard", items: ITEMS_FIXTURE },
    db
  );
  await setDefaultChecklistTemplate(template.id, "workspace-demo-agency", db);
  return { vehicle, template };
}

describe("vehicleCheckService — createVehicleCheck", () => {
  it("computes overallResult 'ok' when every item is ok/not_applicable", async () => {
    const { db } = await createTestDb();
    const { vehicle, template } = await setUp(db);

    const check = await createVehicleCheck(
      {
        workspaceId: "workspace-demo-agency",
        driverId: "person-demo",
        vehicleId: vehicle.id,
        checklistTemplateId: template.id,
        items: [
          { ...ITEMS_FIXTURE[0], result: "ok", notes: null },
          { ...ITEMS_FIXTURE[1], result: "not_applicable", notes: null },
        ],
        driverSignOffName: "Alex Demo",
      },
      db
    );

    expect(check.overallResult).toBe("ok");
    expect(check.driverId).toBe("person-demo");
    expect(check.vehicleId).toBe(vehicle.id);
    expect(check.performedAt).toBeTruthy();
  });

  it("computes overallResult 'defects_found' when any item is a defect", async () => {
    const { db } = await createTestDb();
    const { vehicle, template } = await setUp(db);

    const check = await createVehicleCheck(
      {
        workspaceId: "workspace-demo-agency",
        driverId: "person-demo",
        vehicleId: vehicle.id,
        checklistTemplateId: template.id,
        items: [
          { ...ITEMS_FIXTURE[0], result: "defect", notes: "Worn tread" },
          { ...ITEMS_FIXTURE[1], result: "ok", notes: null },
        ],
        driverSignOffName: "Alex Demo",
      },
      db
    );

    expect(check.overallResult).toBe("defects_found");
  });

  it("rejects a missing vehicle, missing sign-off, or an item with no result", async () => {
    const { db } = await createTestDb();
    const { vehicle, template } = await setUp(db);
    const validItems = [
      { ...ITEMS_FIXTURE[0], result: "ok", notes: null },
      { ...ITEMS_FIXTURE[1], result: "ok", notes: null },
    ];

    await expect(
      createVehicleCheck(
        { workspaceId: "workspace-demo-agency", driverId: "person-demo", vehicleId: "", checklistTemplateId: template.id, items: validItems, driverSignOffName: "Alex" },
        db
      )
    ).rejects.toThrow();

    await expect(
      createVehicleCheck(
        { workspaceId: "workspace-demo-agency", driverId: "person-demo", vehicleId: vehicle.id, checklistTemplateId: template.id, items: validItems, driverSignOffName: "" },
        db
      )
    ).rejects.toThrow();

    await expect(
      createVehicleCheck(
        {
          workspaceId: "workspace-demo-agency",
          driverId: "person-demo",
          vehicleId: vehicle.id,
          checklistTemplateId: template.id,
          items: [{ ...ITEMS_FIXTURE[0], result: null, notes: null }, { ...ITEMS_FIXTURE[1], result: "ok", notes: null }],
          driverSignOffName: "Alex",
        },
        db
      )
    ).rejects.toThrow();
  });
});

describe("vehicleCheckService — no-duplication rule (mirrors shiftService)", () => {
  it("listVehicleChecksForDriver and listVehicleChecksForWorkspace read the same row, scoped differently", async () => {
    const { db } = await createTestDb();
    const { vehicle, template } = await setUp(db);
    const check = await createVehicleCheck(
      {
        workspaceId: "workspace-demo-agency",
        driverId: "person-demo",
        vehicleId: vehicle.id,
        checklistTemplateId: template.id,
        items: [
          { ...ITEMS_FIXTURE[0], result: "ok", notes: null },
          { ...ITEMS_FIXTURE[1], result: "ok", notes: null },
        ],
        driverSignOffName: "Alex Demo",
      },
      db
    );

    const byDriver = await listVehicleChecksForDriver("person-demo", db);
    const byWorkspace = await listVehicleChecksForWorkspace("workspace-demo-agency", db);
    expect(byDriver.map((c) => c.id)).toContain(check.id);
    expect(byWorkspace.map((c) => c.id)).toContain(check.id);
    expect(byDriver.find((c) => c.id === check.id)).toEqual(byWorkspace.find((c) => c.id === check.id));

    // Scoped correctly — a different driver/workspace sees nothing.
    expect(await listVehicleChecksForDriver("person-someone-else", db)).toHaveLength(0);
    expect(await listVehicleChecksForWorkspace("workspace-personal-demo", db)).toHaveLength(0);
  });
});

describe("vehicleCheckService — auto-raises Defects (Stage VC-3)", () => {
  it("createVehicleCheck raises one Defect per failed item, linked back to the check", async () => {
    const { db } = await createTestDb();
    const { vehicle, template } = await setUp(db);

    const check = await createVehicleCheck(
      {
        workspaceId: "workspace-demo-agency",
        driverId: "person-demo",
        vehicleId: vehicle.id,
        checklistTemplateId: template.id,
        items: [
          { ...ITEMS_FIXTURE[0], result: "defect", notes: "Worn tread" },
          { ...ITEMS_FIXTURE[1], result: "ok", notes: null },
        ],
        driverSignOffName: "Alex Demo",
      },
      db
    );

    const defects = await db.defects.query({ where: { raisedFromCheckId: check.id } });
    expect(defects).toHaveLength(1);
    expect(defects[0].raisedFromItemCode).toBe("item-1");
    expect(defects[0].vehicleId).toBe(vehicle.id);
    expect(defects[0].workspaceId).toBe("workspace-demo-agency");
    expect(defects[0].status).toBe("open");
  });

  it("creates no Defects for a fully OK check", async () => {
    const { db } = await createTestDb();
    const { vehicle, template } = await setUp(db);

    const check = await createVehicleCheck(
      {
        workspaceId: "workspace-demo-agency",
        driverId: "person-demo",
        vehicleId: vehicle.id,
        checklistTemplateId: template.id,
        items: [
          { ...ITEMS_FIXTURE[0], result: "ok", notes: null },
          { ...ITEMS_FIXTURE[1], result: "not_applicable", notes: null },
        ],
        driverSignOffName: "Alex Demo",
      },
      db
    );

    expect(await db.defects.query({ where: { raisedFromCheckId: check.id } })).toHaveLength(0);
  });

  it("a paired tractor+trailer check raises each defect against the item's OWN vehicle, not always the primary vehicle", async () => {
    const { db } = await createTestDb();
    const { vehicle: tractor, template } = await setUp(db);
    const trailer = await createVehicle({ workspaceId: "workspace-demo-agency", registration: "XY99 TRL", vehicleType: "trailer" }, db);

    const check = await createVehicleCheck(
      {
        workspaceId: "workspace-demo-agency",
        driverId: "person-demo",
        vehicleId: tractor.id,
        pairedVehicleId: trailer.id,
        checklistTemplateId: template.id,
        items: [
          { ...ITEMS_FIXTURE[0], result: "defect", notes: "Tractor tyre worn", vehicleId: tractor.id },
          { ...ITEMS_FIXTURE[1], result: "defect", notes: "Trailer light out", vehicleId: trailer.id },
        ],
        driverSignOffName: "Alex Demo",
      },
      db
    );

    expect(check.pairedVehicleId).toBe(trailer.id);
    const defects = await db.defects.query({ where: { raisedFromCheckId: check.id } });
    expect(defects).toHaveLength(2);
    expect(defects.find((d) => d.raisedFromItemCode === "item-1").vehicleId).toBe(tractor.id);
    expect(defects.find((d) => d.raisedFromItemCode === "item-2").vehicleId).toBe(trailer.id);
  });

  it("rejects pairing a vehicle with itself", async () => {
    const { db } = await createTestDb();
    const { vehicle, template } = await setUp(db);

    await expect(
      createVehicleCheck(
        {
          workspaceId: "workspace-demo-agency",
          driverId: "person-demo",
          vehicleId: vehicle.id,
          pairedVehicleId: vehicle.id,
          checklistTemplateId: template.id,
          items: [{ ...ITEMS_FIXTURE[0], result: "ok", notes: null }],
          driverSignOffName: "Alex",
        },
        db
      )
    ).rejects.toThrow();
  });
});
