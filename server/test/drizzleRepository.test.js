import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/pool.js";
import { workspaces } from "../src/db/schema.js";
import { DrizzleRepository } from "../src/repository/drizzleRepository.js";

describe("DrizzleRepository — against a real local Postgres", () => {
  const repo = new DrizzleRepository(db, workspaces);

  afterEach(async () => {
    await db.delete(workspaces);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("insert + getById round-trips a row", async () => {
    const item = { id: "ws-1", kind: "personal", name: "Solo", ownerPersonId: "p-1", createdAt: "2026-01-01T00:00:00.000Z" };
    await repo.insert(item);
    const found = await repo.getById("ws-1");
    expect(found).toEqual(item);
  });

  it("getById returns undefined for a missing id", async () => {
    expect(await repo.getById("nope")).toBeUndefined();
  });

  it("getAll returns every row", async () => {
    await repo.insert({ id: "ws-1", kind: "personal", name: "A", ownerPersonId: null, createdAt: "2026-01-01T00:00:00.000Z" });
    await repo.insert({ id: "ws-2", kind: "company", name: "B", ownerPersonId: null, createdAt: "2026-01-01T00:00:00.000Z" });
    const all = await repo.getAll();
    expect(all.map((w) => w.id).sort()).toEqual(["ws-1", "ws-2"]);
  });

  it("query({where: {field: value}}) filters by equality, including null", async () => {
    await repo.insert({ id: "ws-1", kind: "personal", name: "A", ownerPersonId: "p-1", createdAt: "2026-01-01T00:00:00.000Z" });
    await repo.insert({ id: "ws-2", kind: "company", name: "B", ownerPersonId: null, createdAt: "2026-01-01T00:00:00.000Z" });

    expect(await repo.query({ where: { kind: "personal" } })).toEqual([
      expect.objectContaining({ id: "ws-1" }),
    ]);
    expect(await repo.query({ where: { ownerPersonId: null } })).toEqual([
      expect.objectContaining({ id: "ws-2" }),
    ]);
  });

  it("query({where: {field: {in: [...]}}}) filters by membership", async () => {
    await repo.insert({ id: "ws-1", kind: "personal", name: "A", ownerPersonId: null, createdAt: "2026-01-01T00:00:00.000Z" });
    await repo.insert({ id: "ws-2", kind: "company", name: "B", ownerPersonId: null, createdAt: "2026-01-01T00:00:00.000Z" });
    await repo.insert({ id: "ws-3", kind: "company", name: "C", ownerPersonId: null, createdAt: "2026-01-01T00:00:00.000Z" });

    const found = await repo.query({ where: { id: { in: ["ws-1", "ws-3"] } } });
    expect(found.map((w) => w.id).sort()).toEqual(["ws-1", "ws-3"]);
  });

  it("query with no criteria behaves like getAll", async () => {
    await repo.insert({ id: "ws-1", kind: "personal", name: "A", ownerPersonId: null, createdAt: "2026-01-01T00:00:00.000Z" });
    expect(await repo.query()).toHaveLength(1);
  });

  it("update patches a row and returns the merged result", async () => {
    await repo.insert({ id: "ws-1", kind: "personal", name: "A", ownerPersonId: null, createdAt: "2026-01-01T00:00:00.000Z" });
    const updated = await repo.update("ws-1", { name: "Renamed" });
    expect(updated.name).toBe("Renamed");
    expect((await repo.getById("ws-1")).name).toBe("Renamed");
  });

  it("update throws for a missing id", async () => {
    await expect(repo.update("nope", { name: "X" })).rejects.toThrow("not found");
  });

  it("remove deletes a row", async () => {
    await repo.insert({ id: "ws-1", kind: "personal", name: "A", ownerPersonId: null, createdAt: "2026-01-01T00:00:00.000Z" });
    await repo.remove("ws-1");
    expect(await repo.getById("ws-1")).toBeUndefined();
  });

  it("replaceAll clears the table and inserts the given items atomically", async () => {
    await repo.insert({ id: "ws-old", kind: "personal", name: "Old", ownerPersonId: null, createdAt: "2026-01-01T00:00:00.000Z" });
    await repo.replaceAll([
      { id: "ws-new-1", kind: "personal", name: "New 1", ownerPersonId: null, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "ws-new-2", kind: "company", name: "New 2", ownerPersonId: null, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const all = await repo.getAll();
    expect(all.map((w) => w.id).sort()).toEqual(["ws-new-1", "ws-new-2"]);
  });
});
