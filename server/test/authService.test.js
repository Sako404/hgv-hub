import { afterEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db/pool.js";
import { people, accounts, sessions } from "../src/db/schema.js";
import * as authService from "../src/services/authService.js";

describe("authService — against a real local Postgres", () => {
  afterEach(async () => {
    await db.delete(sessions);
    await db.delete(accounts);
    await db.delete(people);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("register creates a Person + Account + Session, and hashes the password (never stores it in plain text)", async () => {
    const { person, account, session } = await authService.register(db, {
      email: "janek@example.com",
      password: "correct-horse-battery-staple",
      name: "Janek",
    });

    expect(person.id).toBeTruthy();
    expect(account.personId).toBe(person.id);
    expect(account.passwordHash).not.toBe("correct-horse-battery-staple");
    expect(account.passwordHash).toMatch(/^\$argon2id\$/);
    expect(session.accountId).toBe(account.id);
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("register rejects a duplicate email", async () => {
    await authService.register(db, { email: "janek@example.com", password: "pw-one-two-three", name: "Janek" });
    await expect(
      authService.register(db, { email: "janek@example.com", password: "different-password", name: "Someone else" })
    ).rejects.toThrow(authService.AuthError);
  });

  it("login succeeds with the right password and creates a fresh session", async () => {
    await authService.register(db, { email: "janek@example.com", password: "correct-horse-battery-staple", name: "Janek" });
    const { session, account } = await authService.login(db, { email: "janek@example.com", password: "correct-horse-battery-staple" });
    expect(session.accountId).toBe(account.id);
  });

  it("login rejects a wrong password", async () => {
    await authService.register(db, { email: "janek@example.com", password: "correct-horse-battery-staple", name: "Janek" });
    await expect(
      authService.login(db, { email: "janek@example.com", password: "wrong-password" })
    ).rejects.toThrow(authService.AuthError);
  });

  it("login rejects an unknown email", async () => {
    await expect(
      authService.login(db, { email: "nobody@example.com", password: "whatever" })
    ).rejects.toThrow(authService.AuthError);
  });

  it("resolveSession returns the account for a live session, null once logged out", async () => {
    const { session } = await authService.register(db, { email: "janek@example.com", password: "correct-horse-battery-staple", name: "Janek" });

    const resolved = await authService.resolveSession(db, session.id);
    expect(resolved.account.email).toBe("janek@example.com");

    await authService.logout(db, session.id);
    expect(await authService.resolveSession(db, session.id)).toBeNull();
  });

  it("resolveSession returns null for an expired session", async () => {
    const { session } = await authService.register(db, { email: "janek@example.com", password: "correct-horse-battery-staple", name: "Janek" });
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, session.id));

    expect(await authService.resolveSession(db, session.id)).toBeNull();
  });

  it("resolveSession returns null for a missing/undefined session id", async () => {
    expect(await authService.resolveSession(db, undefined)).toBeNull();
    expect(await authService.resolveSession(db, "does-not-exist")).toBeNull();
  });
});
