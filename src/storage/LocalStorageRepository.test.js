import { describe, expect, it } from "vitest";
import { LocalStorageRepository } from "./LocalStorageRepository.js";
import { createInMemoryStorage } from "../../test/inMemoryStorage.js";

describe("LocalStorageRepository", () => {
  it("supports full CRUD over an injected storage backend", async () => {
    const storage = createInMemoryStorage();
    const repo = new LocalStorageRepository("test-key", storage);

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

  it("persists via the raw storage backend under its key", async () => {
    const storage = createInMemoryStorage();
    const repo = new LocalStorageRepository("test-key", storage);
    await repo.insert({ id: "a" });
    expect(JSON.parse(storage.getItem("test-key"))).toEqual([{ id: "a" }]);
  });

  it("throws when updating a missing id", async () => {
    const repo = new LocalStorageRepository("test-key", createInMemoryStorage());
    await expect(repo.update("missing", { x: 1 })).rejects.toThrow();
  });

  describe("query(criteria) — the serialisable criteria language", () => {
    function seeded() {
      const repo = new LocalStorageRepository("test-key", createInMemoryStorage());
      repo.insert({ id: "a", workspaceId: "w1", endDate: null });
      repo.insert({ id: "b", workspaceId: "w1", endDate: "2026-01-01" });
      repo.insert({ id: "c", workspaceId: "w2", endDate: null });
      return repo;
    }

    it("filters by a single equality field", async () => {
      const repo = seeded();
      expect((await repo.query({ where: { workspaceId: "w1" } })).map((x) => x.id).sort()).toEqual(["a", "b"]);
    });

    it("treats null as a real equality value (IS NULL), not 'field absent'", async () => {
      const repo = seeded();
      expect((await repo.query({ where: { endDate: null } })).map((x) => x.id).sort()).toEqual(["a", "c"]);
    });

    it("ANDs multiple where keys", async () => {
      const repo = seeded();
      expect(await repo.query({ where: { workspaceId: "w1", endDate: null } })).toEqual([
        { id: "a", workspaceId: "w1", endDate: null },
      ]);
    });

    it("supports {in: [...]} membership", async () => {
      const repo = seeded();
      expect(await repo.query({ where: { workspaceId: { in: ["w1", "w2"] } } })).toHaveLength(3);
      expect((await repo.query({ where: { id: { in: ["a", "c"] } } })).map((x) => x.id).sort()).toEqual(["a", "c"]);
    });
  });
});
