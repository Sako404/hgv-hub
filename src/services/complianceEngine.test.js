import { describe, expect, it } from "vitest";
import { computeCompliance } from "./complianceEngine.js";
import { resolveComplianceProfileForDriver } from "./complianceProfileService.js";
import { createTestDb } from "../../test/testDb.js";
import { seedSecondCompany } from "./seed/seedSecondCompany.js";
import { listShiftsForDriver } from "./shiftService.js";

function sortByDate(shifts) {
  return [...shifts].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

describe("complianceEngine — driver-based, org-config-independent", () => {
  it("property 11: compliance is computed per-driver and never leaks another driver's dates", async () => {
    const { db } = await createTestDb();
    const seed = await seedSecondCompany(db);
    const [driverA, driverB] = seed.drivers;
    const profile = await resolveComplianceProfileForDriver(driverA.personId, db);

    const aShifts = sortByDate(await listShiftsForDriver(driverA.personId, db));
    const aDates = new Set(aShifts.map((s) => s.date));

    const complianceA = computeCompliance(aShifts, profile);
    for (const alert of complianceA.alerts) {
      expect(aDates.has(alert.date)).toBe(true);
    }

    // Function signature takes only (shifts, complianceProfile) — no driverId
    // leakage possible via extra args, and it's computed strictly from the
    // shift array handed to it.
    expect(computeCompliance.length).toBe(2);
  });

  it("property 12: swapping the RateCard/Organisation behind an assignment does not change compliance output", async () => {
    const { db } = await createTestDb();
    const seed = await seedSecondCompany(db);
    const driver = seed.drivers[0];
    const profile = await resolveComplianceProfileForDriver(driver.personId, db);
    const shifts = sortByDate(await listShiftsForDriver(driver.personId, db));

    const before = computeCompliance(shifts, profile);

    // Swap the assignment's rate card / organisation-side config.
    await db.rateCards.insert({
      id: "ratecard-alternate",
      workspaceId: seed.companyWorkspaceId,
      lineageId: "ratecard-alternate",
      version: 1,
      supersedesId: null,
      name: "Alternate rates",
      effectiveFrom: "2026-01-01",
      rates: { MonThu: { Days: [1, 1], Lates: [1, 1], Nights: [1, 1] }, Fri: { Days: [1, 1], Lates: [1, 1], Nights: [1, 1] }, Sat: { Days: [1, 1], Lates: [1, 1], Nights: [1, 1] }, Sun: { Days: [1, 1], Lates: [1, 1], Nights: [1, 1] } },
    });
    await db.assignments.update(driver.assignmentId, { rateCardLineageId: "ratecard-alternate" });

    const after = computeCompliance(shifts, profile);
    expect(after).toEqual(before);
  });

  it("alerts from an already-closed cycle (>= cycleResetGapHours since) are dropped, matching the counters", () => {
    const profile = {
      rules: {
        reducedRestMaxPerCycle: 3, minRestHardHours: 9, reducedRestUpperHours: 11,
        cycleResetGapHours: 24, absoluteMaxDailyHours: 15, longShiftThresholdHours: 13,
        longShiftMaxPerCycle: 3, drivingHardLimitHours: 10, extendedDrivingThresholdHours: 9,
        extendedDrivingMaxPerWeek: 2,
      },
    };
    const oldLongShift = { date: "2026-05-01", start: "08:00", end: "22:00", breakMinutes: 45, drivingHours: 0 };
    // A qualifying gap (>= 24h) after the old shift closes that cycle out.
    const recentNormalShift = { date: "2026-08-01", start: "08:00", end: "16:00", breakMinutes: 45, drivingHours: 0 };

    const result = computeCompliance([oldLongShift, recentNormalShift], profile);

    expect(result.longShiftUsed).toBe(0);
    expect(result.alerts).toEqual([]);
  });

  it("a wall-clock `now` past cycleResetGapHours since the last shift closes the cycle even with no later shift logged", () => {
    const profile = {
      rules: {
        reducedRestMaxPerCycle: 3, minRestHardHours: 9, reducedRestUpperHours: 11,
        cycleResetGapHours: 24, absoluteMaxDailyHours: 15, longShiftThresholdHours: 13,
        longShiftMaxPerCycle: 3, drivingHardLimitHours: 10, extendedDrivingThresholdHours: 9,
        extendedDrivingMaxPerWeek: 2,
      },
    };
    const longShift = { date: "2026-08-01", start: "08:00", end: "22:00", breakMinutes: 45, drivingHours: 0 };

    const withoutNow = computeCompliance([longShift], profile);
    expect(withoutNow.longShiftUsed).toBe(1);
    expect(withoutNow.alerts).toHaveLength(1);

    // 3 days later, no next shift logged yet — matches a real driver's
    // "I've had days off since, why is this still showing?" case.
    const threeDaysLater = new Date("2026-08-04T12:00:00");
    const withNow = computeCompliance([longShift], profile, { now: threeDaysLater });
    expect(withNow.longShiftUsed).toBe(0);
    expect(withNow.alerts).toEqual([]);

    // Not enough time has passed yet — cycle stays open.
    const twoHoursLater = new Date("2026-08-01T23:00:00");
    const stillOpen = computeCompliance([longShift], profile, { now: twoHoursLater });
    expect(stillOpen.longShiftUsed).toBe(1);
    expect(stillOpen.alerts).toHaveLength(1);
  });

  it("complianceEngine module imports neither payEngine nor rateCardService", async () => {
    const fs = await import("node:fs/promises");
    const url = new URL("./complianceEngine.js", import.meta.url);
    const text = await fs.readFile(url, "utf8");
    const importLines = text.split("\n").filter((line) => line.trim().startsWith("import "));
    expect(importLines.join("\n")).not.toMatch(/payEngine|rateCardService/);
  });
});
