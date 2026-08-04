import { describe, expect, it } from "vitest";
import { createDb } from "../storage/db.js";
import { createInMemoryStorage } from "../../test/inMemoryStorage.js";
import { runMigrations } from "./index.js";
import { migration007PersonAndDriverProfileRefinement } from "./007_person_and_driver_profile_refinement.js";
import { resolvePersonDisplayName } from "../services/driverService.js";
import { computeShiftBreakdown } from "../services/payEngine.js";

describe("migration 007 — Person/DriverProfile refinement", () => {
  it("backfills Person.archivedAt without touching the legacy name field", async () => {
    const db = createDb(createInMemoryStorage());
    await db.people.insert({ id: "person-legacy", name: "Legacy Name", email: null, createdAt: "now" });

    await migration007PersonAndDriverProfileRefinement(db);

    const person = await db.people.getById("person-legacy");
    expect(person.archivedAt).toBeNull();
    expect(person.name).toBe("Legacy Name"); // untouched, no lossy auto-split attempted
    expect(person.firstName).toBeUndefined();
    expect(resolvePersonDisplayName(person)).toBe("Legacy Name"); // resolver falls back correctly
  });

  it("backfills DriverProfile.workspaceId to the person's own personal workspace", async () => {
    const db = createDb(createInMemoryStorage());
    await db.people.insert({ id: "person-1", name: "Driver One", email: null, createdAt: "now" });
    await db.workspaces.insert({ id: "workspace-personal-1", kind: "personal", name: "Driver One — Personal", ownerPersonId: "person-1", createdAt: "now" });
    await db.driverProfiles.insert({ id: "dp-legacy", personId: "person-1", defaultBreakMinutes: 45, createdAt: "now" });

    await migration007PersonAndDriverProfileRefinement(db);

    const profile = await db.driverProfiles.getById("dp-legacy");
    expect(profile.workspaceId).toBe("workspace-personal-1");
    expect(profile.archivedAt).toBeNull();
  });

  it("is idempotent — a from-scratch re-run doesn't change already-migrated rows", async () => {
    const db = createDb(createInMemoryStorage());
    await db.people.insert({ id: "person-1", name: "X", email: null, createdAt: "now" });
    await db.workspaces.insert({ id: "workspace-personal-1", kind: "personal", name: "X — Personal", ownerPersonId: "person-1", createdAt: "now" });
    await db.driverProfiles.insert({ id: "dp-1", personId: "person-1", defaultBreakMinutes: 45, createdAt: "now" });

    await migration007PersonAndDriverProfileRefinement(db);
    const afterFirst = await db.driverProfiles.getById("dp-1");
    await migration007PersonAndDriverProfileRefinement(db);
    const afterSecond = await db.driverProfiles.getById("dp-1");

    expect(afterSecond).toEqual(afterFirst);
  });
});

describe("migration 007 — existing Alex data survives unchanged (properties 11-13)", () => {
  it("property 11: Alex's Person/DriverProfile are not duplicated, and remain reachable by the same ids", async () => {
    const storage = createInMemoryStorage();
    const db = createDb(storage);
    await runMigrations(db, storage);

    const people = await db.people.query({ where: { id: "person-demo" } });
    expect(people).toHaveLength(1);
    expect(resolvePersonDisplayName(people[0])).toBe("Alex");

    const profiles = await db.driverProfiles.query({ where: { personId: "person-demo" } });
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe("driverprofile-demo");
    expect(profiles[0].workspaceId).toBe("workspace-personal-demo");
  });

  it("property 12: existing Shift.driverId references survive migration unchanged", async () => {
    const LEGACY_SHIFTS = [
      { id: "legacy-1", date: "2026-07-14", start: "08:00", end: "16:00", drivingHours: 5, breakMinutes: 45 },
    ];
    const storage = createInMemoryStorage();
    storage.setItem("hgv-shifts", JSON.stringify(LEGACY_SHIFTS));
    const db = createDb(storage);
    await runMigrations(db, storage);

    const shift = await db.shifts.getById("legacy-1");
    expect(shift.driverId).toBe("person-demo");
  });

  it("property 13: expected pay for the real historical shift is unchanged after migration 007", async () => {
    const LEGACY_SHIFTS = [
      { id: "legacy-1", date: "2026-07-14", start: "08:00", end: "16:00", drivingHours: 5, breakMinutes: 45 },
    ];
    const storage = createInMemoryStorage();
    storage.setItem("hgv-shifts", JSON.stringify(LEGACY_SHIFTS));
    const db = createDb(storage);
    await runMigrations(db, storage);

    const shift = await db.shifts.getById("legacy-1");
    const rateCard = await db.rateCards.getById(shift.rateCardId);
    const breakdown = computeShiftBreakdown(shift, rateCard);

    // Hand-calculated: Tue 08:00-16:00, 45min break -> paid 08:00-15:15,
    // crossing the 14:00 Days/Lates boundary: 6h Days @12.00 + 1.25h Lates @12.50.
    const expectedBase = 6 * 12.00 + 1.25 * 12.50;
    expect(breakdown.totalBasePay).toBeCloseTo(expectedBase, 2);
    expect(breakdown.priced).toBe(true);
  });
});
