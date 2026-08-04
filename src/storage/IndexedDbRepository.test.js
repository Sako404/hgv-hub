import { beforeEach, describe, expect, it } from "vitest";
import { IndexedDbRepository } from "./IndexedDbRepository.js";
import { openHgvHoursDb, HGV_HOURS_DB_NAME } from "./indexedDbClient.js";
import { createIndexedDbDb } from "./db.js";
import { resetIndexedDb } from "../../test/resetIndexedDb.js";

// Parity suite with LocalStorageRepository.test.js — both implementations
// satisfy the same Repository interface. fake-indexeddb (registered
// globally in test/setup.js) gives IndexedDbRepository a real IndexedDB
// engine to run against without a browser.

async function freshRepo(storeName = "wt-shifts") {
  await resetIndexedDb();
  const idbHandle = await openHgvHoursDb();
  return new IndexedDbRepository(idbHandle, storeName);
}

describe("IndexedDbRepository", () => {
  beforeEach(async () => {
    await resetIndexedDb();
  });

  it("supports full CRUD", async () => {
    const repo = await freshRepo();

    expect(await repo.getAll()).toEqual([]);

    await repo.insert({ id: "a", value: 1 });
    await repo.insert({ id: "b", value: 2 });
    expect(await repo.getAll()).toHaveLength(2);
    expect(await repo.getById("a")).toEqual({ id: "a", value: 1 });
    expect(await repo.query({ where: { value: 2 } })).toEqual([{ id: "b", value: 2 }]);
    expect(await repo.query()).toHaveLength(2);

    await repo.update("a", { value: 10 });
    expect((await repo.getById("a")).value).toBe(10);

    await repo.remove("b");
    expect(await repo.getAll()).toEqual([{ id: "a", value: 10 }]);

    await repo.replaceAll([{ id: "c", value: 99 }]);
    expect(await repo.getAll()).toEqual([{ id: "c", value: 99 }]);
  });

  it("throws when updating a missing id, and never partially applies the write", async () => {
    const repo = await freshRepo();
    await expect(repo.update("missing", { x: 1 })).rejects.toThrow();
    expect(await repo.getAll()).toEqual([]);
  });

  it("a rejected write propagates as a rejected promise (duplicate id via add())", async () => {
    const repo = await freshRepo();
    await repo.insert({ id: "a", value: 1 });
    // idb's shorthand add() uses IDBObjectStore.add, which rejects on a
    // duplicate key rather than silently overwriting — the write must
    // fail loudly, not report success while the second insert is lost.
    await expect(repo.insert({ id: "a", value: 2 })).rejects.toBeTruthy();
    expect(await repo.getById("a")).toEqual({ id: "a", value: 1 });
  });

  describe("query(criteria) — same semantics as LocalStorageRepository", () => {
    async function seeded() {
      const repo = await freshRepo();
      await repo.insert({ id: "a", workspaceId: "w1", endDate: null });
      await repo.insert({ id: "b", workspaceId: "w1", endDate: "2026-01-01" });
      await repo.insert({ id: "c", workspaceId: "w2", endDate: null });
      return repo;
    }

    it("filters by a single equality field", async () => {
      const repo = await seeded();
      expect((await repo.query({ where: { workspaceId: "w1" } })).map((x) => x.id).sort()).toEqual(["a", "b"]);
    });

    it("treats null as a real equality value (IS NULL), not 'field absent'", async () => {
      const repo = await seeded();
      expect((await repo.query({ where: { endDate: null } })).map((x) => x.id).sort()).toEqual(["a", "c"]);
    });

    it("ANDs multiple where keys", async () => {
      const repo = await seeded();
      expect(await repo.query({ where: { workspaceId: "w1", endDate: null } })).toEqual([
        { id: "a", workspaceId: "w1", endDate: null },
      ]);
    });

    it("supports {in: [...]} membership", async () => {
      const repo = await seeded();
      expect(await repo.query({ where: { workspaceId: { in: ["w1", "w2"] } } })).toHaveLength(3);
    });
  });

  it("HGV_HOURS_DB_NAME is the single shared database name", () => {
    expect(HGV_HOURS_DB_NAME).toBe("hgv-hours");
  });

  describe("db.insertAtomic — real IndexedDB transaction spanning multiple stores", () => {
    it("commits every row when every write succeeds", async () => {
      const db = await createIndexedDbDb();
      await db.insertAtomic([
        { collection: "people", item: { id: "p-1", firstName: "A", lastName: "B", displayName: null, email: null, archivedAt: null, createdAt: "now" } },
        { collection: "driverProfiles", item: { id: "dp-1", personId: "p-1", workspaceId: "w-1", referenceNumber: null, defaultBreakMinutes: 45, lastUsedAssignmentId: null, archivedAt: null, createdAt: "now" } },
        { collection: "memberships", item: { id: "m-1", workspaceId: "w-1", personId: "p-1", roles: ["driver"], archivedAt: null, createdAt: "now" } },
      ]);

      expect(await db.people.getById("p-1")).toBeTruthy();
      expect(await db.driverProfiles.getById("dp-1")).toBeTruthy();
      expect(await db.memberships.getById("m-1")).toBeTruthy();
    });

    it("a failure on ANY store's write aborts the WHOLE transaction — the other stores' writes are rolled back too, not just the failing one", async () => {
      const db = await createIndexedDbDb();
      // Pre-existing row makes the driverProfiles write collide (duplicate key).
      await db.driverProfiles.insert({ id: "dp-colliding", personId: "someone-else", workspaceId: "w-1", referenceNumber: null, defaultBreakMinutes: 45, lastUsedAssignmentId: null, archivedAt: null, createdAt: "now" });

      await expect(
        db.insertAtomic([
          { collection: "people", item: { id: "p-2", firstName: "Should", lastName: "Rollback", displayName: null, email: null, archivedAt: null, createdAt: "now" } },
          { collection: "driverProfiles", item: { id: "dp-colliding", personId: "p-2", workspaceId: "w-1", referenceNumber: null, defaultBreakMinutes: 45, lastUsedAssignmentId: null, archivedAt: null, createdAt: "now" } },
          { collection: "memberships", item: { id: "m-2", workspaceId: "w-1", personId: "p-2", roles: ["driver"], archivedAt: null, createdAt: "now" } },
        ])
      ).rejects.toBeTruthy();

      // The people and memberships stores are DIFFERENT stores from the
      // one that actually failed — a naive per-store-independent write
      // would have let them commit. A real transaction rolls back all
      // three together.
      expect(await db.people.getById("p-2")).toBeUndefined();
      expect(await db.memberships.getById("m-2")).toBeUndefined();
    });

    it("rolls back a longer, seven-store batch (the shape createSoloWorkContext uses) on a single failing write", async () => {
      const db = await createIndexedDbDb();
      // Pre-existing row makes the rateCards write collide.
      await db.rateCards.insert({ id: "rc-colliding", workspaceId: "w-1", lineageId: "rc-colliding", version: 1, supersedesId: null, effectiveFrom: "2026-01-01", rates: {} });

      await expect(
        db.insertAtomic([
          { collection: "organisations", item: { id: "org-solo", workspaceId: "w-1", legalName: "Solo", tradingName: "Solo", types: ["agency"], archivedAt: null } },
          { collection: "sites", item: { id: "site-solo", organisationId: "org-solo", name: "Solo Site", kind: "client_site", clientName: null, address: null, notes: null, archivedAt: null } },
          { collection: "rateCardLineages", item: { id: "rc-colliding", workspaceId: "w-1", name: "Solo Rates", archivedAt: null, createdAt: "now" } },
          { collection: "rateCards", item: { id: "rc-colliding", workspaceId: "w-1", lineageId: "rc-colliding", version: 1, supersedesId: null, effectiveFrom: "2026-01-01", rates: {} } },
          { collection: "engagements", item: { id: "eng-solo", providerOrganisationId: "org-solo", workspaceId: "w-1", driverId: "p-solo", relationshipType: "agency_worker", startDate: "2026-01-01", endDate: null, status: "active" } },
          { collection: "placements", item: { id: "placement-solo", workspaceId: "w-1", providerOrganisationId: "org-solo", siteId: "site-solo", rateCardLineageId: "rc-colliding", effectiveFrom: "2026-01-01", effectiveTo: null, archivedAt: null, createdAt: "now" } },
          { collection: "assignments", item: { id: "assign-solo", engagementId: "eng-solo", placementId: "placement-solo", startDate: "2026-01-01", endDate: null } },
        ])
      ).rejects.toBeTruthy();

      expect(await db.organisations.getById("org-solo")).toBeUndefined();
      expect(await db.sites.getById("site-solo")).toBeUndefined();
      expect(await db.rateCardLineages.getById("rc-colliding")).toBeUndefined();
      expect(await db.engagements.getById("eng-solo")).toBeUndefined();
      expect(await db.placements.getById("placement-solo")).toBeUndefined();
      expect(await db.assignments.getById("assign-solo")).toBeUndefined();
    });
  });
});
