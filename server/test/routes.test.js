import { afterEach, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.js";
import { db, pool } from "../src/db/pool.js";
import { workspaces, people, accounts, sessions } from "../src/db/schema.js";
import { SESSION_COOKIE_NAME } from "../src/config.js";

async function authenticatedCookie(app) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "route-tester@example.com", password: "correct-horse-battery-staple", name: "Route Tester" },
  });
  const cookieHeader = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
  return `${cookieHeader.name}=${cookieHeader.value}`;
}

describe("generic collection + atomic routes — against a real local Postgres", () => {
  afterEach(async () => {
    await db.delete(workspaces);
    await db.delete(sessions);
    await db.delete(accounts);
    await db.delete(people);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("GET /api/health responds ok without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, version: expect.any(String) });
    await app.close();
  });

  it("401s an unauthenticated request to a collection route", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/workspaces" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("404s for an unknown collection, once authenticated", async () => {
    const app = await buildApp();
    const cookie = await authenticatedCookie(app);
    const res = await app.inject({ method: "GET", url: "/api/nonsense", headers: { cookie } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("POST inserts, GET by id retrieves, GET lists, PATCH updates, DELETE removes", async () => {
    const app = await buildApp();
    const cookie = await authenticatedCookie(app);
    const item = { id: "ws-route-1", kind: "personal", name: "Solo", ownerPersonId: null, createdAt: "2026-01-01T00:00:00.000Z" };

    const created = await app.inject({ method: "POST", url: "/api/workspaces", payload: item, headers: { cookie } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual(item);

    const fetched = await app.inject({ method: "GET", url: "/api/workspaces/ws-route-1", headers: { cookie } });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toEqual(item);

    const listed = await app.inject({ method: "GET", url: "/api/workspaces", headers: { cookie } });
    expect(listed.json()).toEqual([item]);

    const patched = await app.inject({ method: "PATCH", url: "/api/workspaces/ws-route-1", payload: { name: "Renamed" }, headers: { cookie } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().name).toBe("Renamed");

    const deleted = await app.inject({ method: "DELETE", url: "/api/workspaces/ws-route-1", headers: { cookie } });
    expect(deleted.statusCode).toBe(204);

    const missing = await app.inject({ method: "GET", url: "/api/workspaces/ws-route-1", headers: { cookie } });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });

  it("GET /api/:collection?where=... filters via the criteria query param", async () => {
    const app = await buildApp();
    const cookie = await authenticatedCookie(app);
    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      payload: { id: "ws-a", kind: "personal", name: "A", ownerPersonId: null, createdAt: "2026-01-01T00:00:00.000Z" },
      headers: { cookie },
    });
    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      payload: { id: "ws-b", kind: "company", name: "B", ownerPersonId: null, createdAt: "2026-01-01T00:00:00.000Z" },
      headers: { cookie },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces?where=${encodeURIComponent(JSON.stringify({ kind: "company" }))}`,
      headers: { cookie },
    });
    expect(res.json()).toEqual([
      expect.objectContaining({ id: "ws-b" }),
    ]);

    await app.close();
  });

  it("PATCH on a missing id 404s", async () => {
    const app = await buildApp();
    const cookie = await authenticatedCookie(app);
    const res = await app.inject({ method: "PATCH", url: "/api/workspaces/nope", payload: { name: "X" }, headers: { cookie } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("401s an unauthenticated request to /api/atomic", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/atomic", payload: [] });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("POST /api/atomic inserts across multiple collections in one transaction", async () => {
    const app = await buildApp();
    const cookie = await authenticatedCookie(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/atomic",
      headers: { cookie },
      payload: [
        { collection: "people", item: { id: "person-1", name: "Janek", firstName: null, lastName: null, displayName: null, email: null, archivedAt: null, createdAt: "2026-01-01T00:00:00.000Z" } },
        { collection: "workspaces", item: { id: "ws-atomic-1", kind: "personal", name: "Janek's workspace", ownerPersonId: "person-1", createdAt: "2026-01-01T00:00:00.000Z" } },
      ],
    });
    expect(res.statusCode).toBe(204);

    expect((await app.inject({ method: "GET", url: "/api/people/person-1", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/workspaces/ws-atomic-1", headers: { cookie } })).statusCode).toBe(200);

    await app.close();
  });

  it("POST /api/atomic rolls back every write if one fails", async () => {
    const app = await buildApp();
    const cookie = await authenticatedCookie(app);

    // Pre-existing row so the second write in the batch collides on a
    // duplicate primary key and the whole transaction must abort.
    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      payload: { id: "ws-dup", kind: "personal", name: "Existing", ownerPersonId: null, createdAt: "2026-01-01T00:00:00.000Z" },
      headers: { cookie },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/atomic",
      headers: { cookie },
      payload: [
        { collection: "people", item: { id: "person-rollback", name: "X", firstName: null, lastName: null, displayName: null, email: null, archivedAt: null, createdAt: "2026-01-01T00:00:00.000Z" } },
        { collection: "workspaces", item: { id: "ws-dup", kind: "personal", name: "Colliding", ownerPersonId: null, createdAt: "2026-01-01T00:00:00.000Z" } },
      ],
    });
    expect(res.statusCode).toBe(400);

    const person = await app.inject({ method: "GET", url: "/api/people/person-rollback", headers: { cookie } });
    expect(person.statusCode).toBe(404);

    await app.close();
  });
});
