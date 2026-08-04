import argon2 from "argon2";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { accounts, sessions, people } from "../db/schema.js";
import { newId } from "../domain/ids.js";
import { SESSION_TTL_MS } from "../config.js";

class AuthError extends Error {}

async function findAccountByEmail(db, email) {
  const rows = await db.select().from(accounts).where(eq(accounts.email, email)).limit(1);
  return rows[0];
}

async function createSession(db, accountId) {
  const session = {
    id: crypto.randomBytes(32).toString("hex"),
    accountId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  };
  await db.insert(sessions).values(session);
  return session;
}

/**
 * Creates a Person + Account + Session as one transaction — the
 * server-side analogue of driverService.js's atomic Person+Membership
 * insert, since a registered user must always have both rows or
 * neither.
 */
export async function register(db, { email, password, name }) {
  const existing = await findAccountByEmail(db, email);
  if (existing) {
    throw new AuthError("An account with this email already exists");
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const now = new Date().toISOString();
  const person = {
    id: newId("person"),
    name: name ?? null,
    firstName: null,
    lastName: null,
    displayName: name ?? null,
    email,
    archivedAt: null,
    createdAt: now,
  };
  const account = {
    id: newId("account"),
    personId: person.id,
    email,
    passwordHash,
    createdAt: now,
  };

  let session;
  await db.transaction(async (tx) => {
    await tx.insert(people).values(person);
    await tx.insert(accounts).values(account);
    session = await createSession(tx, account.id);
  });

  return { person, account, session };
}

export async function login(db, { email, password }) {
  const account = await findAccountByEmail(db, email);
  if (!account) {
    throw new AuthError("Invalid email or password");
  }
  const valid = await argon2.verify(account.passwordHash, password);
  if (!valid) {
    throw new AuthError("Invalid email or password");
  }

  const session = await createSession(db, account.id);
  const personRows = await db.select().from(people).where(eq(people.id, account.personId)).limit(1);
  return { person: personRows[0], account, session };
}

export async function logout(db, sessionId) {
  if (!sessionId) return;
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/**
 * Resolves a session cookie value to its account + person, or null if
 * the session doesn't exist or has expired. Used by the session
 * middleware ahead of every non-auth route.
 */
export async function resolveSession(db, sessionId) {
  if (!sessionId) return null;

  const sessionRows = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  const session = sessionRows[0];
  if (!session || session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  const accountRows = await db.select().from(accounts).where(eq(accounts.id, session.accountId)).limit(1);
  const account = accountRows[0];
  if (!account) return null;

  return { account, session };
}

export { AuthError };
