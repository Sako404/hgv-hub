import { createDb } from "../src/storage/db.js";
import { runMigrations } from "../src/migrations/index.js";
import { createInMemoryStorage } from "./inMemoryStorage.js";

/**
 * Fresh in-memory db + storage pair, with migrations already run
 * (default ComplianceProfile seeded; optionally seeded from a fixture
 * legacy `hgv-shifts` payload). Uses the localStorage-backed
 * LocalStorageRepository double, not real IndexedDB — fast and
 * dependency-free for unit/service tests. Full-app renders (App.smoke,
 * App.i18n) exercise the real IndexedDbRepository instead, since they
 * mount <App/> which always boots against real IndexedDB.
 */
export async function createTestDb({ legacyShifts } = {}) {
  const storage = createInMemoryStorage();
  if (legacyShifts) {
    storage.setItem("hgv-shifts", JSON.stringify(legacyShifts));
  }
  const db = createDb(storage);
  await runMigrations(db, storage);
  return { db, storage };
}
