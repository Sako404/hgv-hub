/**
 * CPC Training tracking foundation (Stage CPC-1, see
 * decision-2026-08-04-working-time-cpc-training-architecture). The
 * `cpcTrainingRecords` IndexedDB store is created by
 * indexedDbClient.js's own DB_VERSION bump (a separate, lower-level
 * mechanism — see its comment). Nothing to backfill or seed — no
 * prior collection ever captured training-session data, same as
 * migration 012 for `driverDocuments`. Registered purely to keep the
 * schema-version gate advancing in lockstep with the DB_VERSION bump.
 * @param {ReturnType<typeof import('../storage/db.js').createIndexedDbDb>} db
 */
export async function migration013AddCpcTraining(db) {
  // Intentionally empty — see doc comment above.
}
