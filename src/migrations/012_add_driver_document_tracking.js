/**
 * Driver Document Expiry Tracking foundation (Stage DE-1, see
 * decision-2026-08-04-working-time-driver-document-expiry-architecture).
 * The `driverDocuments` IndexedDB store is created by
 * indexedDbClient.js's own DB_VERSION bump (a separate, lower-level
 * mechanism — see its comment). Unlike every prior store-adding
 * migration (005, 009, 011), there is no existing collection this
 * data was ever hiding in and nothing to backfill or seed — a
 * DriverDocument is a wholly new fact this app never captured before,
 * so a from-scratch install and an upgrading install start identical
 * (both simply have zero rows). This migration is registered purely
 * to keep the schema-version gate advancing in lockstep with every
 * other staged module addition, documenting the DB_VERSION bump the
 * same way 005/009/011 do.
 * @param {ReturnType<typeof import('../storage/db.js').createIndexedDbDb>} db
 */
export async function migration012AddDriverDocumentTracking(db) {
  // Intentionally empty — see doc comment above.
}
