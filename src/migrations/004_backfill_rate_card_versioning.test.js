import { describe, expect, it } from "vitest";
import { createDb } from "../storage/db.js";
import { createInMemoryStorage } from "../../test/inMemoryStorage.js";
import { migration004BackfillRateCardVersioning } from "./004_backfill_rate_card_versioning.js";

/** Builds a db holding pre-Part-3 "old shape" data directly, bypassing
 * every migration/service that now only produces the new shape — this
 * is exactly what migration 002/003 would have left behind from an
 * earlier deployment of this app. */
async function seedOldShapeData() {
  const db = createDb(createInMemoryStorage());
  await db.rateCards.insert({
    id: "ratecard-old",
    workspaceId: "workspace-x",
    name: "Old shape rate card",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    rates: { MonThu: { Days: [10, 11], Lates: [10, 11], Nights: [10, 11] }, Fri: { Days: [10, 11], Lates: [10, 11], Nights: [10, 11] }, Sat: { Days: [10, 11], Lates: [10, 11], Nights: [10, 11] }, Sun: { Days: [10, 11], Lates: [10, 11], Nights: [10, 11] } },
  });
  await db.assignments.insert({
    id: "assignment-old",
    engagementId: "engagement-x",
    siteId: "site-x",
    rateCardId: "ratecard-old",
    startDate: "2026-01-01",
    endDate: null,
  });
  await db.shifts.insert({
    id: "shift-old-1",
    workspaceId: "workspace-x",
    driverId: "person-x",
    assignmentId: "assignment-old",
    date: "2026-07-10",
    start: "08:00",
    end: "16:00",
    breakMinutes: 45,
    drivingHours: 6,
    createdAt: "now",
    updatedAt: "now",
    source: "manual",
  });
  // An unassigned shift must stay untouched (genuinely unpriced, not "not yet backfilled").
  await db.shifts.insert({
    id: "shift-old-unassigned",
    workspaceId: "workspace-personal-x",
    driverId: "person-x",
    assignmentId: null,
    date: "2026-07-11",
    start: "08:00",
    end: "10:00",
    breakMinutes: 0,
    drivingHours: 2,
    createdAt: "now",
    updatedAt: "now",
    source: "manual",
  });
  return db;
}

describe("migration 004 — backfill RateCard versioning / Shift.rateCardId pinning", () => {
  it("upgrades RateCard, Assignment, and Shift rows from the old shape", async () => {
    const db = await seedOldShapeData();

    await migration004BackfillRateCardVersioning(db);

    const rateCard = await db.rateCards.getById("ratecard-old");
    expect(rateCard.lineageId).toBe("ratecard-old");
    expect(rateCard.version).toBe(1);
    expect(rateCard.supersedesId).toBeNull();

    const assignment = await db.assignments.getById("assignment-old");
    expect(assignment.rateCardLineageId).toBe("ratecard-old");

    const shift = await db.shifts.getById("shift-old-1");
    expect(shift.rateCardId).toBe("ratecard-old");

    const unassignedShift = await db.shifts.getById("shift-old-unassigned");
    expect(unassignedShift.rateCardId).toBeUndefined();
  });

  it("is idempotent — re-running after already-upgraded data is a no-op", async () => {
    const db = await seedOldShapeData();
    await migration004BackfillRateCardVersioning(db);
    const afterFirst = await db.shifts.getById("shift-old-1");

    await migration004BackfillRateCardVersioning(db);
    const afterSecond = await db.shifts.getById("shift-old-1");

    expect(afterSecond).toEqual(afterFirst);
  });

  it("does not touch RateCard/Assignment/Shift rows already in the new shape", async () => {
    const db = createDb(createInMemoryStorage());
    await db.rateCards.insert({ id: "rc-new", workspaceId: "w", lineageId: "rc-new", version: 1, supersedesId: null, name: "New shape", effectiveFrom: "2026-01-01", rates: {} });
    await db.assignments.insert({ id: "a-new", engagementId: "e", siteId: "s", rateCardLineageId: "rc-new", startDate: "2026-01-01", endDate: null });
    await db.shifts.insert({ id: "shift-new", workspaceId: "w", driverId: "p", assignmentId: "a-new", date: "2026-07-10", start: "08:00", end: "16:00", breakMinutes: 0, drivingHours: 8, rateCardId: "rc-new", createdAt: "now", updatedAt: "now", source: "manual" });

    await migration004BackfillRateCardVersioning(db);

    expect(await db.rateCards.getById("rc-new")).toEqual({ id: "rc-new", workspaceId: "w", lineageId: "rc-new", version: 1, supersedesId: null, name: "New shape", effectiveFrom: "2026-01-01", rates: {} });
    expect((await db.assignments.getById("a-new")).rateCardLineageId).toBe("rc-new");
    expect((await db.shifts.getById("shift-new")).rateCardId).toBe("rc-new");
  });
});
