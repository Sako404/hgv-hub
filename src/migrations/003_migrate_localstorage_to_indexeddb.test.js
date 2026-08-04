import { describe, expect, it } from "vitest";
import { createIndexedDbDb } from "../storage/db.js";
import { runMigrations } from "./index.js";
import { STORAGE_KEYS } from "../storage/keys.js";
import { createInMemoryStorage } from "../../test/inMemoryStorage.js";
import { resetIndexedDb } from "../../test/resetIndexedDb.js";

function seedLegacyWtStorage(storage) {
  // SCHEMA_VERSION "2" simulates a browser that already ran migrations
  // 1+2 in an earlier, localStorage-only version of this app — domain
  // data is sitting in wt-* localStorage keys with nothing in IndexedDB yet.
  storage.setItem(STORAGE_KEYS.SCHEMA_VERSION, "2");
  storage.setItem(
    STORAGE_KEYS.PEOPLE,
    JSON.stringify([{ id: "person-x", name: "X", email: null, createdAt: "now" }])
  );
  storage.setItem(
    STORAGE_KEYS.WORKSPACES,
    JSON.stringify([{ id: "workspace-x", kind: "personal", name: "X — Personal", ownerPersonId: "person-x", createdAt: "now" }])
  );
  storage.setItem(
    STORAGE_KEYS.SHIFTS,
    JSON.stringify([
      {
        id: "shift-x",
        workspaceId: "workspace-x",
        driverId: "person-x",
        assignmentId: null,
        date: "2026-07-01",
        start: "08:00",
        end: "16:00",
        breakMinutes: 45,
        drivingHours: 6,
        createdAt: "now",
        updatedAt: "now",
        source: "manual",
      },
    ])
  );
}

describe("migration 003 — localStorage -> IndexedDB backfill", () => {
  it("copies every wt-* collection into IndexedDB and advances SCHEMA_VERSION past this migration", async () => {
    await resetIndexedDb();
    const storage = createInMemoryStorage();
    seedLegacyWtStorage(storage);
    const db = await createIndexedDbDb();

    await runMigrations(db, storage);

    expect(await db.people.getById("person-x")).toBeTruthy();
    expect(await db.workspaces.getById("workspace-x")).toBeTruthy();
    expect(await db.shifts.getById("shift-x")).toBeTruthy();
    // "14", not "3" — runMigrations also runs migrations 004-014 in the
    // same pass, since they're version-gated the same way. This
    // fixture has no organisations/sites/engagements/rate cards/driver
    // profiles/vehicles, so 004-006, 008, 010, 011, 012, 013, and 014
    // are all no-ops and 007 only backfills person-x's archivedAt (no
    // driverProfiles to touch); 009 DOES seed a default
    // ChecklistTemplate for workspace-x (it seeds every existing
    // workspace, not gated on any other collection existing).
    expect(storage.getItem(STORAGE_KEYS.SCHEMA_VERSION)).toBe("14");
    // Source localStorage keys are never deleted.
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.PEOPLE))).toHaveLength(1);
  });

  it("is restart-safe: a mid-copy failure leaves SCHEMA_VERSION unset, and retrying completes cleanly with no duplicates", async () => {
    await resetIndexedDb();
    const storage = createInMemoryStorage();
    seedLegacyWtStorage(storage);
    const realDb = await createIndexedDbDb();

    let shiftsInsertCalls = 0;
    // Wraps the real db, but makes the FIRST write to the "shifts"
    // collection fail — simulating a tab closing / a rejected
    // transaction partway through the copy. Methods are bound
    // explicitly (not object-spread) since Repository methods live on
    // the class prototype, not as own properties.
    const flakyDb = {
      ...realDb,
      shifts: {
        getById: (id) => realDb.shifts.getById(id),
        getAll: () => realDb.shifts.getAll(),
        query: (criteria) => realDb.shifts.query(criteria),
        update: (id, patch) => realDb.shifts.update(id, patch),
        remove: (id) => realDb.shifts.remove(id),
        replaceAll: (items) => realDb.shifts.replaceAll(items),
        insert: async (item) => {
          shiftsInsertCalls += 1;
          if (shiftsInsertCalls === 1) throw new Error("simulated write failure");
          return realDb.shifts.insert(item);
        },
      },
    };

    await expect(runMigrations(flakyDb, storage)).rejects.toThrow("simulated write failure");
    // The migration never completed, so SCHEMA_VERSION was never advanced.
    expect(storage.getItem(STORAGE_KEYS.SCHEMA_VERSION)).toBe("2");
    // Collections copied before the failure (workspaces, people) already
    // landed — harmless partial state, not corrupted.
    expect(await realDb.people.getById("person-x")).toBeTruthy();
    expect(await realDb.workspaces.getById("workspace-x")).toBeTruthy();
    expect(await realDb.shifts.getById("shift-x")).toBeUndefined();

    // Retry against the real db, exactly as a fresh boot would (same
    // SCHEMA_VERSION gate) — upsert-by-id means the already-copied
    // collections re-write harmlessly rather than erroring or duplicating.
    await runMigrations(realDb, storage);
    expect(storage.getItem(STORAGE_KEYS.SCHEMA_VERSION)).toBe("14");
    expect(await realDb.shifts.getById("shift-x")).toBeTruthy();
    expect(await realDb.people.getAll()).toHaveLength(1);
    expect(await realDb.shifts.getAll()).toHaveLength(1);
  });
});
