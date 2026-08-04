import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import { createShift, listShiftsForDriver, listShiftsForWorkspace } from "./shiftService.js";

describe("shift visibility — no duplication across driver/company views", () => {
  it("properties 5, 6, 7: driver and company see the identical Shift row, never a copy", async () => {
    const { db } = await createTestDb();
    const agencyWorkspaceId = "workspace-demo-agency";
    const driverId = "person-demo";
    const assignmentId = "assignment-demo-agency-client";

    const shift = await createShift(
      {
        workspaceId: agencyWorkspaceId,
        driverId,
        assignmentId,
        date: "2026-07-20",
        start: "08:00",
        end: "16:00",
        breakMinutes: 45,
        drivingHours: 6,
      },
      db
    );

    const driverView = await listShiftsForDriver(driverId, db);
    const companyView = await listShiftsForWorkspace(agencyWorkspaceId, db);

    const driverRow = driverView.find((s) => s.id === shift.id);
    const companyRow = companyView.find((s) => s.id === shift.id);

    expect(driverRow).toBeTruthy();
    expect(companyRow).toBeTruthy();
    expect(driverRow).toEqual(companyRow); // same fields, same object shape
    expect(driverRow).toEqual(shift);

    // No duplicate row anywhere in the shared collection.
    expect((await db.shifts.getAll()).filter((s) => s.id === shift.id)).toHaveLength(1);
  });

  it("a shift with no assignment is still visible to its driver, unpriced", async () => {
    const { db } = await createTestDb();
    const shift = await createShift(
      {
        workspaceId: "workspace-personal-demo",
        driverId: "person-demo",
        assignmentId: null,
        date: "2026-07-21",
        start: "08:00",
        end: "12:00",
        breakMinutes: 0,
        drivingHours: 2,
      },
      db
    );
    expect((await listShiftsForDriver("person-demo", db)).some((s) => s.id === shift.id)).toBe(true);
  });
});
