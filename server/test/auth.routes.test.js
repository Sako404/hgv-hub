import { afterEach, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.js";
import { db, pool } from "../src/db/pool.js";
import { people, accounts, sessions } from "../src/db/schema.js";
import { SESSION_COOKIE_NAME } from "../src/config.js";

describe("auth routes — against a real local Postgres", () => {
  afterEach(async () => {
    await db.delete(sessions);
    await db.delete(accounts);
    await db.delete(people);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("register sets a session cookie and returns the person + account (no password hash)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "janek@example.com", password: "correct-horse-battery-staple", name: "Janek" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().account).toEqual({ id: expect.any(String), email: "janek@example.com" });
    expect(res.json().person.displayName).toBe("Janek");

    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(cookie).toBeTruthy();
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");

    await app.close();
  });

  it("register rejects a duplicate email with 409", async () => {
    const app = await buildApp();
    const payload = { email: "janek@example.com", password: "correct-horse-battery-staple", name: "Janek" };
    await app.inject({ method: "POST", url: "/api/auth/register", payload });
    const res = await app.inject({ method: "POST", url: "/api/auth/register", payload });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it("register 400s when email or password is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "janek@example.com" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("login with the right credentials sets a session cookie usable on /api/auth/me", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "janek@example.com", password: "correct-horse-battery-staple", name: "Janek" },
    });

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "janek@example.com", password: "correct-horse-battery-staple" },
    });
    expect(loginRes.statusCode).toBe(200);
    const cookie = loginRes.cookies.find((c) => c.name === SESSION_COOKIE_NAME);

    const meRes = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: `${cookie.name}=${cookie.value}` },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().personId).toBe(loginRes.json().person.id);

    await app.close();
  });

  it("login with a wrong password 401s", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "janek@example.com", password: "correct-horse-battery-staple", name: "Janek" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "janek@example.com", password: "wrong-password" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /api/auth/me without a session cookie 401s", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("logout clears the cookie and invalidates the session for subsequent requests", async () => {
    const app = await buildApp();
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "janek@example.com", password: "correct-horse-battery-staple", name: "Janek" },
    });
    const cookie = registerRes.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    const cookieHeader = `${cookie.name}=${cookie.value}`;

    const logoutRes = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: cookieHeader } });
    expect(logoutRes.statusCode).toBe(204);

    const meRes = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: cookieHeader } });
    expect(meRes.statusCode).toBe(401);

    await app.close();
  });
});
