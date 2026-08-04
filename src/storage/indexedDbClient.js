import { openDB } from "idb";
import { STORAGE_KEYS } from "./keys.js";

export const HGV_HOURS_DB_NAME = "hgv-hours";
// v2 (Part 4, Stage 4A): adds the rateCardLineages store.
// v3 (Part 4, Stage 4D): adds the placements store.
// v4 (Vehicle Check module, Stage VC-1): adds vehicles/checklistTemplates/
// vehicleChecks/defects stores — all four created together as schema
// foundation for the whole module (mirrors migration 005's approach for
// Part 4), even though vehicleChecks/defects stay unused until VC-2/VC-3.
// v5 (Per-Load Pay, Stage PL-1): adds the loads store.
// v6 (Driver Document Expiry Tracking, Stage DE-1): adds the
// driverDocuments store — the first store keyed by personId with no
// workspaceId field at all, see the DriverDocument typedef.
// v7 (CPC Training tracking, Stage CPC-1): adds the cpcTrainingRecords
// store — also personId-scoped, no workspaceId.
const DB_VERSION = 7;

// One object store per domain collection, keyPath "id" — mirrors the
// LocalStorageRepository shape exactly (one JSON array per collection)
// so both implementations satisfy the same Repository interface with
// identical semantics. No secondary indexes: collections are small
// (one driver/org's worth of data), so query() does getAll() + the
// same matchesCriteria() filter LocalStorageRepository uses, rather
// than introducing IDB indexes this app doesn't need yet.
const OBJECT_STORES = [
  STORAGE_KEYS.WORKSPACES,
  STORAGE_KEYS.PEOPLE,
  STORAGE_KEYS.MEMBERSHIPS,
  STORAGE_KEYS.ORGANISATIONS,
  STORAGE_KEYS.SITES,
  STORAGE_KEYS.DRIVER_PROFILES,
  STORAGE_KEYS.ENGAGEMENTS,
  STORAGE_KEYS.ASSIGNMENTS,
  STORAGE_KEYS.SHIFTS,
  STORAGE_KEYS.RATE_CARDS,
  STORAGE_KEYS.RATE_CARD_LINEAGES,
  STORAGE_KEYS.PLACEMENTS,
  STORAGE_KEYS.COMPLIANCE_PROFILES,
  STORAGE_KEYS.VEHICLES,
  STORAGE_KEYS.CHECKLIST_TEMPLATES,
  STORAGE_KEYS.VEHICLE_CHECKS,
  STORAGE_KEYS.DEFECTS,
  STORAGE_KEYS.LOADS,
  STORAGE_KEYS.DRIVER_DOCUMENTS,
  STORAGE_KEYS.CPC_TRAINING_RECORDS,
];

let dbPromise = null;

/**
 * Opens (creating/upgrading if needed) the app's single IndexedDB
 * database. Memoized: every caller in this module's lifetime (the
 * running app, or one test file) shares the same connection, rather
 * than each opening its own — the standard pattern for an IndexedDB-
 * backed SPA, and it also avoids two concurrent first-ever opens
 * racing on the same `upgradeneeded` transaction.
 */
export function openHgvHoursDb() {
  if (!dbPromise) {
    dbPromise = openDB(HGV_HOURS_DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const storeName of OBJECT_STORES) {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: "id" });
          }
        }
      },
    });
  }
  return dbPromise;
}
