import { LocalStorageRepository } from "./LocalStorageRepository.js";
import { IndexedDbRepository } from "./IndexedDbRepository.js";
import { ApiRepository } from "./ApiRepository.js";
import { openHgvHoursDb } from "./indexedDbClient.js";
import { STORAGE_KEYS } from "./keys.js";

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
  rateCardLineages: STORAGE_KEYS.RATE_CARD_LINEAGES,
  placements: STORAGE_KEYS.PLACEMENTS,
  complianceProfiles: STORAGE_KEYS.COMPLIANCE_PROFILES,
  vehicles: STORAGE_KEYS.VEHICLES,
  checklistTemplates: STORAGE_KEYS.CHECKLIST_TEMPLATES,
  vehicleChecks: STORAGE_KEYS.VEHICLE_CHECKS,
  defects: STORAGE_KEYS.DEFECTS,
  loads: STORAGE_KEYS.LOADS,
  driverDocuments: STORAGE_KEYS.DRIVER_DOCUMENTS,
  cpcTrainingRecords: STORAGE_KEYS.CPC_TRAINING_RECORDS,
};

/**
 * Best-effort multi-collection atomic insert for the localStorage test
 * double: no native transaction primitive exists, so this inserts
 * sequentially and compensates (removes) everything already written in
 * this batch if a later write fails — a test/dev run never observes a
 * half-created multi-record write. This is NOT truly atomic (a crash
 * between two of these calls could still leave partial state); that
 * weaker guarantee is acceptable for this synchronous, single-threaded
 * test double. The real backend (below) uses a genuine IndexedDB
 * transaction instead of pretending independent writes are atomic.
 */
async function insertAtomicLocalStorage(db, writes) {
  const written = [];
  try {
    for (const write of writes) {
      await db[write.collection].insert(write.item);
      written.push(write);
    }
  } catch (err) {
    for (const write of written) {
      await db[write.collection].remove(write.item.id).catch(() => {});
    }
    throw err;
  }
}

/**
 * Genuinely atomic multi-collection insert for the real backend: one
 * IndexedDB transaction spanning every store involved. If any insert
 * fails (e.g. a duplicate id), the platform aborts the whole
 * transaction and rolls back every store's writes within it — not just
 * the one that failed. This is the smallest transaction boundary this
 * app needs today (insert-only, a fixed array of {collection, item});
 * it is deliberately not a generic multi-operation transaction API.
 *
 * Uses Promise.allSettled (not Promise.all) for the individual writes:
 * Promise.all rejects as soon as the FIRST write rejects, but doesn't
 * cancel the others — when the transaction then aborts, those other
 * still-pending request promises also reject, with nothing left
 * listening, which Node/the browser reports as an unhandled rejection.
 * allSettled waits for every one of them to actually settle instead.
 * tx.done gets its own settle-and-capture handler attached immediately
 * (synchronously) for the same reason — it must never be the one
 * unhandled promise in the failure path.
 */
async function insertAtomicIndexedDb(idbHandle, writes) {
  const storeNames = [...new Set(writes.map((write) => COLLECTION_KEYS[write.collection]))];
  const tx = idbHandle.transaction(storeNames, "readwrite");
  const txSettled = tx.done.then(
    () => ({ ok: true }),
    (err) => ({ ok: false, err })
  );

  const writeResults = await Promise.allSettled(
    writes.map((write) => tx.objectStore(COLLECTION_KEYS[write.collection]).add(write.item))
  );
  const failedWrite = writeResults.find((r) => r.status === "rejected");
  const txResult = await txSettled;

  if (failedWrite) throw failedWrite.reason;
  if (!txResult.ok) throw txResult.err;
}

/**
 * localStorage-backed db — a fast, dependency-free double used by
 * tests (see test/testDb.js). The real application's persistence is
 * createIndexedDbDb(); this is kept alive for test parity, not as the
 * primary backend.
 * @param {Storage} [storage]
 */
export function createDb(storage = globalThis.localStorage) {
  const db = {};
  for (const [collection, key] of Object.entries(COLLECTION_KEYS)) {
    db[collection] = new LocalStorageRepository(key, storage);
  }
  // A regular function (not an arrow) so `this` dispatches dynamically
  // to whatever object it's actually called on — tests that wrap/
  // override one collection (e.g. { ...db, driverProfiles: flaky })
  // must have insertAtomic honour that override, not silently use the
  // original db captured at construction time.
  db.insertAtomic = function (writes) {
    return insertAtomicLocalStorage(this, writes);
  };
  return db;
}

/**
 * IndexedDB-backed db — the application's real persistence. Opens (or
 * creates) the single shared browser database and wires one
 * IndexedDbRepository per collection over it.
 */
export async function createIndexedDbDb() {
  const idbHandle = await openHgvHoursDb();
  const db = {};
  for (const [collection, storeName] of Object.entries(COLLECTION_KEYS)) {
    db[collection] = new IndexedDbRepository(idbHandle, storeName);
  }
  db.insertAtomic = (writes) => insertAtomicIndexedDb(idbHandle, writes);
  return db;
}

/**
 * API-backed db — a self-hosted deployment's real persistence. One
 * ApiRepository per collection over the server's generic REST routes;
 * insertAtomic posts the same {collection, item}[] shape straight to
 * the server's /api/atomic route, which runs it as one real Postgres
 * transaction (server/src/routes/atomic.js).
 */
export function createApiDb(baseUrl) {
  const db = {};
  for (const collection of Object.keys(COLLECTION_KEYS)) {
    db[collection] = new ApiRepository(baseUrl, collection);
  }
  db.insertAtomic = async (writes) => {
    const res = await fetch(`${baseUrl}/api/atomic`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(writes),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `insertAtomic: request failed (${res.status})`);
    }
  };
  return db;
}
