import { STORAGE_KEYS } from "../storage/keys.js";

const COLLECTION_KEYS = {
  workspaces: STORAGE_KEYS.WORKSPACES,
  people: STORAGE_KEYS.PEOPLE,
  memberships: STORAGE_KEYS.MEMBERSHIPS,
  organisations: STORAGE_KEYS.ORGANISATIONS,
  sites: STORAGE_KEYS.SITES,
  driverProfiles: STORAGE_KEYS.DRIVER_PROFILES,
  engagements: STORAGE_KEYS.ENGAGEMENTS,
  assignments: STORAGE_KEYS.ASSIGNMENTS,
  shifts: STORAGE_KEYS.SHIFTS,
  rateCards: STORAGE_KEYS.RATE_CARDS,
  complianceProfiles: STORAGE_KEYS.COMPLIANCE_PROFILES,
};

function readLegacyCollection(storage, key) {
  try {
    const raw = storage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * One-time copy of every pre-IndexedDB `wt-*` localStorage collection
 * into the new IndexedDB-backed db (earlier sessions of this app wrote
 * domain data straight to localStorage; the IndexedDB store starts
 * empty and needs this backfill exactly once). Source `wt-*` keys are
 * never deleted — same convention as the permanently-preserved legacy
 * `hgv-shifts` key.
 *
 * Restart-safe by construction, not by an extra completion flag: every
 * write is an upsert-by-id (get-then-insert-or-update), so re-running
 * this whole function from scratch after a partial failure just
 * re-writes already-copied records with identical data — nothing
 * duplicates. runMigrations() in migrations/index.js only advances
 * SCHEMA_VERSION past this migration once `run()` resolves without
 * throwing, so an interrupted copy is automatically retried in full on
 * the next boot.
 * @param {ReturnType<typeof import('../storage/db.js').createIndexedDbDb>} db
 * @param {Storage} storage
 */
export async function migration003MigrateLocalStorageToIndexedDb(db, storage) {
  for (const [collection, key] of Object.entries(COLLECTION_KEYS)) {
    const items = readLegacyCollection(storage, key);
    for (const item of items) {
      const existing = await db[collection].getById(item.id);
      if (existing) {
        await db[collection].update(item.id, item);
      } else {
        await db[collection].insert(item);
      }
    }
  }
}
