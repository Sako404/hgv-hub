import { createIndexedDbDb, createApiDb } from "./db.js";
import { runMigrations } from "../migrations/index.js";

/**
 * Set at build time (VITE_API_BASE_URL) to switch the whole app into
 * server (API) mode — a self-hosted deployment pointed at a real
 * Fastify+Postgres backend instead of the browser's own IndexedDB. A
 * solo-driver PWA build simply never sets this, so that mode is
 * unaffected (see the backend/auth architecture decision).
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export function isServerMode() {
  return Boolean(API_BASE_URL);
}

let bootPromise = null;

/**
 * Server mode: the server's own Postgres schema is already current
 * (drizzle-kit migrations, applied at deploy time) — client migrations
 * are an IndexedDB-schema-versioning concern only, so they don't run
 * here at all.
 *
 * Local mode: opens the app's IndexedDB store and runs any pending
 * migrations against it — the one place both concerns are sequenced
 * for a fresh boot. See src/views/shell/AppBootstrap.jsx, which
 * renders a loading state while this resolves.
 *
 * Memoized: React 18 StrictMode (dev only — see main.jsx) intentionally
 * double-invokes effects, so AppBootstrap's effect can call this twice
 * back-to-back before either call resolves. Without memoization, two
 * concurrent `runMigrations()` calls both see an empty db and race on
 * migration 001's check-then-insert of the default ComplianceProfile,
 * and the loser's write fails as a duplicate key.
 * @param {Storage} [storage]
 */
export function bootstrapDb(storage = globalThis.localStorage) {
  if (!bootPromise) {
    bootPromise = API_BASE_URL
      ? Promise.resolve(createApiDb(API_BASE_URL))
      : (async () => {
          const db = await createIndexedDbDb();
          await runMigrations(db, storage);
          return db;
        })();
  }
  return bootPromise;
}
