import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import { newId } from "../domain/ids.js";
import { createShift, deleteShift, updateShift } from "./shiftService.js";
import { createRateCard, reviseRateCard } from "./rateCardService.js";
import { listLoadsForShift } from "./loadService.js";

// createTestDb() without a legacyShifts fixture backdates Alex's
// RateCard's effectiveFrom to "today" (see migration 002) — every date
// used here must be safely on/after that, so tests stay valid
// regardless of which day they actually run on.
const SAFE_DATE = "2099-01-01";
const SAFE_DATE_LATER = "2099-06-01";
const SAFE_DATE_LATEST = "2099-09-01";

async function secondAssignment(db) {
  const rateCard = await createRateCard(
    { workspaceId: "workspace-demo-agency", name: "Alternate site rates", effectiveFrom: "2026-01-01", rates: { MonThu: { Days: [1, 1], Lates: [1, 1], Nights: [1, 1] }, Fri: { Days: [1, 1], Lates: [1, 1], Nights: [1, 1] }, Sat: { Days: [1, 1], Lates: [1, 1], Nights: [1, 1] }, Sun: { Days: [1, 1], Lates: [1, 1], Nights: [1, 1] } } },
    db
  );
  const placementId = newId("placement");
  await db.placements.insert({
    id: placementId,
    workspaceId: "workspace-demo-agency",
    providerOrganisationId: "org-demo-agency",
    siteId: "site-demo-client",
    rateCardLineageId: rateCard.lineageId,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const assignmentId = newId("assignment");
  await db.assignments.insert({
    id: assignmentId,
    engagementId: "engagement-demo-agency",
    placementId,
    startDate: "2026-01-01",
    endDate: null,
  });
  return { assignmentId, rateCard };
}

describe("shiftService — RateCard pinning", () => {
  it("createShift pins the effective RateCard for the shift's own date", async () => {
    const { db } = await createTestDb();
    const shift = await createShift(
      { workspaceId: "workspace-demo-agency", driverId: "person-demo", assignmentId: "assignment-demo-agency-client", date: SAFE_DATE, start: "08:00", end: "16:00", breakMinutes: 45, drivingHours: 6 },
      db
    );
    expect(shift.rateCardId).toBe("ratecard-demo-agency-client");
  });

  it("createShift leaves rateCardId null for an unassigned shift", async () => {
    const { db } = await createTestDb();
    const shift = await createShift(
      { workspaceId: "workspace-personal-demo", driverId: "person-demo", assignmentId: null, date: SAFE_DATE, start: "08:00", end: "12:00", breakMinutes: 0, drivingHours: 3 },
      db
    );
    expect(shift.rateCardId).toBeNull();
  });

  it("an ordinary edit (non-context field) leaves the pinned rateCardId byte-identical", async () => {
    const { db } = await createTestDb();
    const shift = await createShift(
      { workspaceId: "workspace-demo-agency", driverId: "person-demo", assignmentId: "assignment-demo-agency-client", date: SAFE_DATE, start: "08:00", end: "16:00", breakMinutes: 45, drivingHours: 6 },
      db
    );
    const updated = await updateShift(shift.id, { breakMinutes: 30, drivingHours: 5, notes: "traffic" }, db);
    expect(updated.rateCardId).toBe(shift.rateCardId);
  });

  it("changing the shift's date re-resolves and pins the version effective for the new date", async () => {
    const { db } = await createTestDb();
    // Add a second version to Alex's existing lineage, effective later.
    const original = await db.rateCards.getById("ratecard-demo-agency-client");
    const v2 = await reviseRateCard(original.lineageId, { effectiveFrom: SAFE_DATE_LATER, rates: original.rates }, db);

    const shift = await createShift(
      { workspaceId: "workspace-demo-agency", driverId: "person-demo", assignmentId: "assignment-demo-agency-client", date: SAFE_DATE, start: "08:00", end: "16:00", breakMinutes: 45, drivingHours: 6 },
      db
    );
    expect(shift.rateCardId).toBe(original.id);

    const updated = await updateShift(shift.id, { date: SAFE_DATE_LATEST }, db);
    expect(updated.rateCardId).toBe(v2.id);
  });

  it("changing the shift's assignment re-resolves and pins the new assignment's effective RateCard", async () => {
    const { db } = await createTestDb();
    const { assignmentId: secondAssignmentId, rateCard: secondRateCard } = await secondAssignment(db);

    const shift = await createShift(
      { workspaceId: "workspace-demo-agency", driverId: "person-demo", assignmentId: "assignment-demo-agency-client", date: SAFE_DATE, start: "08:00", end: "16:00", breakMinutes: 45, drivingHours: 6 },
      db
    );
    expect(shift.rateCardId).toBe("ratecard-demo-agency-client");

    const updated = await updateShift(shift.id, { assignmentId: secondAssignmentId }, db);
    expect(updated.rateCardId).toBe(secondRateCard.id);
  });

  it("clearing the assignment (unassigning) re-resolves to no rate card", async () => {
    const { db } = await createTestDb();
    const shift = await createShift(
      { workspaceId: "workspace-demo-agency", driverId: "person-demo", assignmentId: "assignment-demo-agency-client", date: SAFE_DATE, start: "08:00", end: "16:00", breakMinutes: 45, drivingHours: 6 },
      db
    );
    const updated = await updateShift(shift.id, { assignmentId: null, workspaceId: "workspace-personal-demo" }, db);
    expect(updated.rateCardId).toBeNull();
  });
});

describe("shiftService — Loads (Per-Load Pay Stage PL-2)", () => {
  it("createShift persists input.loads as real Load rows linked to the new shift", async () => {
    const { db } = await createTestDb();
    const shift = await createShift(
      {
        workspaceId: "workspace-demo-agency",
        driverId: "person-demo",
        assignmentId: null,
        date: SAFE_DATE,
        start: "08:00",
        end: "16:00",
        breakMinutes: 45,
        drivingHours: 6,
        loads: [{ amount: 120, reference: "REF-1", description: null, distanceMiles: null }],
      },
      db
    );
    const loads = await listLoadsForShift(shift.id, db);
    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({ workspaceId: shift.workspaceId, shiftId: shift.id, amount: 120, reference: "REF-1" });
  });

  it("createShift with loads omitted writes no Load rows at all", async () => {
    const { db } = await createTestDb();
    const shift = await createShift(
      { workspaceId: "workspace-demo-agency", driverId: "person-demo", assignmentId: null, date: SAFE_DATE, start: "08:00", end: "16:00", breakMinutes: 45, drivingHours: 6 },
      db
    );
    expect(await listLoadsForShift(shift.id, db)).toEqual([]);
  });

  it("updateShift with loads replaces the shift's existing Load rows entirely", async () => {
    const { db } = await createTestDb();
    const shift = await createShift(
      { workspaceId: "workspace-demo-agency", driverId: "person-demo", assignmentId: null, date: SAFE_DATE, start: "08:00", end: "16:00", breakMinutes: 45, drivingHours: 6, loads: [{ amount: 10 }, { amount: 20 }] },
      db
    );
    await updateShift(shift.id, { loads: [{ amount: 99 }] }, db);
    const loads = await listLoadsForShift(shift.id, db);
    expect(loads).toHaveLength(1);
    expect(loads[0].amount).toBe(99);
  });

  it("updateShift with loads omitted leaves existing Load rows untouched", async () => {
    const { db } = await createTestDb();
    const shift = await createShift(
      { workspaceId: "workspace-demo-agency", driverId: "person-demo", assignmentId: null, date: SAFE_DATE, start: "08:00", end: "16:00", breakMinutes: 45, drivingHours: 6, loads: [{ amount: 10 }] },
      db
    );
    await updateShift(shift.id, { breakMinutes: 30 }, db);
    const loads = await listLoadsForShift(shift.id, db);
    expect(loads).toHaveLength(1);
    expect(loads[0].amount).toBe(10);
  });

  it("updateShift never writes a stray 'loads' field onto the Shift row itself", async () => {
    const { db } = await createTestDb();
    const shift = await createShift(
      { workspaceId: "workspace-demo-agency", driverId: "person-demo", assignmentId: null, date: SAFE_DATE, start: "08:00", end: "16:00", breakMinutes: 45, drivingHours: 6 },
      db
    );
    const updated = await updateShift(shift.id, { loads: [{ amount: 5 }] }, db);
    expect(updated.loads).toBeUndefined();
  });

  it("deleteShift also removes every Load it owns", async () => {
    const { db } = await createTestDb();
    const shift = await createShift(
      { workspaceId: "workspace-demo-agency", driverId: "person-demo", assignmentId: null, date: SAFE_DATE, start: "08:00", end: "16:00", breakMinutes: 45, drivingHours: 6, loads: [{ amount: 10 }] },
      db
    );
    await deleteShift(shift.id, db);
    expect(await listLoadsForShift(shift.id, db)).toEqual([]);
  });
});
