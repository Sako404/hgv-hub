import { openHgvHoursDb } from "../src/storage/indexedDbClient.js";

/**
 * Clears every object store between tests, over the app's single
 * memoized connection (openHgvHoursDb() is memoized per test file — see
 * indexedDbClient.js). Domain data now lives in IndexedDB (not
 * localStorage), and fake-indexeddb persists across tests within the
 * same process unless explicitly cleared — this is the IndexedDB
 * equivalent of `window.localStorage.clear()`.
 *
 * Deliberately clears stores rather than deleting the whole database:
 * `indexedDB.deleteDatabase()` blocks until every open connection to
 * that database closes, which — given the connection is memoized and
 * shared — would hang indefinitely here. `clear()` needs no such
 * exclusivity and works fine on the still-open shared connection.
 */
export async function resetIndexedDb() {
  const db = await openHgvHoursDb();
  const storeNames = Array.from(db.objectStoreNames);
  const tx = db.transaction(storeNames, "readwrite");
  await Promise.all(storeNames.map((name) => tx.objectStore(name).clear()));
  await tx.done;
}
