import { afterEach, afterAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/index.js";
import { db, pool } from "../src/db/pool.js";
import { people, accounts, sessions, memberships, workspaces } from "../src/db/schema.js";
import { SESSION_COOKIE_NAME } from "../src/config.js";
import { newId } from "../src/domain/ids.js";

async function registerAndGetCookie(app) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "update-tester@example.com", password: "correct-horse-battery-staple", name: "Update Tester" },
  });
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
  return { cookieHeader: `${cookie.name}=${cookie.value}`, personId: res.json().person.id };
}

async function grantOwnerRole(personId) {
  const workspaceId = newId("workspace");
  await db.insert(workspaces).values({ id: workspaceId, kind: "personal", name: "Test", ownerPersonId: personId, createdAt: new Date().toISOString() });
  await db.insert(memberships).values({ id: newId("membership"), workspaceId, personId, roles: ["driver", "owner"], archivedAt: null, createdAt: new Date().toISOString() });
}

function mockGithubRelease(tagName) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tag_name: tagName }) });
}

describe("updates routes — against a real local Postgres", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.delete(memberships);
    await db.delete(workspaces);
    await db.delete(sessions);
    await db.delete(accounts);
    await db.delete(people);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("401s an unauthenticated request", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/updates/status" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("403s an authenticated request with no owner/admin role anywhere", async () => {
    const app = await buildApp();
    const { cookieHeader } = await registerAndGetCookie(app);
    // Deliberately no membership granted at all — a bare account with
    // no workspace/role yet (never ran the client's ensurePersonalWorkspace).
    const res = await app.inject({ method: "GET", url: "/api/updates/status", headers: { cookie: cookieHeader } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("GET /api/updates/status reports the latest release for an owner", async () => {
    vi.stubGlobal("fetch", mockGithubRelease("v9.9.9"));
    const app = await buildApp();
    const { cookieHeader, personId } = await registerAndGetCookie(app);
    await grantOwnerRole(personId);

    const res = await app.inject({ method: "GET", url: "/api/updates/status", headers: { cookie: cookieHeader } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.latestVersion).toBe("9.9.9");
    expect(body.updateAvailable).toBe(true);
    expect(body.runningVersion).toBeTruthy();
    await app.close();
  });

  it("POST /api/updates/apply calls the updater and returns its response, once an update is known to be available", async () => {
    // Priming call: populates updateService's cache with updateAvailable:true.
    vi.stubGlobal("fetch", mockGithubRelease("v9.9.9"));
    const app = await buildApp();
    const { cookieHeader, personId } = await registerAndGetCookie(app);
    await grantOwnerRole(personId);
    await app.inject({ method: "GET", url: "/api/updates/status", headers: { cookie: cookieHeader } });

    // checkForUpdate() inside the /apply handler now hits its cache (no
    // new GitHub call), so this mock only needs to handle the updater call.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "updating" }) }));
    const res = await app.inject({ method: "POST", url: "/api/updates/apply", headers: { cookie: cookieHeader } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "updating" });
    await app.close();
  });
});
