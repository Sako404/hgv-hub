import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import { newId } from "../domain/ids.js";
import { buildLoadsResolver, clearLoadsForShift, listLoadsForShift, replaceLoadsForShift } from "./loadService.js";

async function insertShift(db, overrides = {}) {
  const id = newId("shift");
  await db.shifts.insert({
    id,
    workspaceId: "workspace-demo-agency",
    driverId: "person-demo",
    assignmentId: null,
    date: "2099-01-01",
    start: "08:00",
    end: "16:00",
    breakMinutes: 45,
    drivingHours: 6,
    rateCardId: null,
    createdAt: "2099-01-01T00:00:00.000Z",
    updatedAt: "2099-01-01T00:00:00.000Z",
    source: "manual",
    ...overrides,
  });
  return id;
}

describe("loadService", () => {
  it("replaceLoadsForShift inserts fully-formed Load rows from partial input", async () => {
    const { db } = await createTestDb();
    const shiftId = await insertShift(db);
    await replaceLoadsForShift(
      shiftId,
      "workspace-demo-agency",
      [{ reference: "REF-1", description: "Amazon Relay — Load #1", amount: 120.5, distanceMiles: 85 }],
      db
    );
    const loads = await listLoadsForShift(shiftId, db);
    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({
      workspaceId: "workspace-demo-agency",
      shiftId,
      reference: "REF-1",
      description: "Amazon Relay — Load #1",
      amount: 120.5,
      distanceMiles: 85,
    });
    expect(loads[0].id).toBeTruthy();
    expect(loads[0].createdAt).toBeTruthy();
  });

  it("replaceLoadsForShift defaults optional fields to null", async () => {
    const { db } = await createTestDb();
    const shiftId = await insertShift(db);
    await replaceLoadsForShift(shiftId, "workspace-demo-agency", [{ amount: 50 }], db);
    const loads = await listLoadsForShift(shiftId, db);
    expect(loads[0].reference).toBeNull();
    expect(loads[0].description).toBeNull();
    expect(loads[0].distanceMiles).toBeNull();
  });

  it("replaceLoadsForShift removes every prior Load before inserting the new set — not additive", async () => {
    const { db } = await createTestDb();
    const shiftId = await insertShift(db);
    await replaceLoadsForShift(shiftId, "workspace-demo-agency", [{ amount: 10 }, { amount: 20 }], db);
    await replaceLoadsForShift(shiftId, "workspace-demo-agency", [{ amount: 99 }], db);
    const loads = await listLoadsForShift(shiftId, db);
    expect(loads).toHaveLength(1);
    expect(loads[0].amount).toBe(99);
  });

  it("replaceLoadsForShift with an empty array clears every existing Load", async () => {
    const { db } = await createTestDb();
    const shiftId = await insertShift(db);
    await replaceLoadsForShift(shiftId, "workspace-demo-agency", [{ amount: 10 }], db);
    await replaceLoadsForShift(shiftId, "workspace-demo-agency", [], db);
    expect(await listLoadsForShift(shiftId, db)).toHaveLength(0);
  });

  it("clearLoadsForShift removes a shift's Loads without touching another shift's", async () => {
    const { db } = await createTestDb();
    const shiftA = await insertShift(db);
    const shiftB = await insertShift(db);
    await replaceLoadsForShift(shiftA, "workspace-demo-agency", [{ amount: 10 }], db);
    await replaceLoadsForShift(shiftB, "workspace-demo-agency", [{ amount: 20 }], db);
    await clearLoadsForShift(shiftA, db);
    expect(await listLoadsForShift(shiftA, db)).toHaveLength(0);
    expect(await listLoadsForShift(shiftB, db)).toHaveLength(1);
  });

  it("buildLoadsResolver batch-resolves Loads for a set of shifts into a synchronous per-shift lookup", async () => {
    const { db } = await createTestDb();
    const shiftA = await insertShift(db);
    const shiftB = await insertShift(db);
    const shiftC = await insertShift(db);
    await replaceLoadsForShift(shiftA, "workspace-demo-agency", [{ amount: 10 }, { amount: 15 }], db);
    await replaceLoadsForShift(shiftB, "workspace-demo-agency", [{ amount: 20 }], db);

    const resolve = await buildLoadsResolver(
      [{ id: shiftA }, { id: shiftB }, { id: shiftC }],
      db
    );
    expect(resolve({ id: shiftA })).toHaveLength(2);
    expect(resolve({ id: shiftB })).toHaveLength(1);
    expect(resolve({ id: shiftC })).toEqual([]);
  });
});
