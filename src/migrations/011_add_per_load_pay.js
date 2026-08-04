/**
 * Additive schema foundation for Per-Load Pay (Stage PL-1, see
 * decision-2026-08-03-working-time-per-load-pay-architecture). The
 * `loads` IndexedDB store is created by indexedDbClient.js's own
 * DB_VERSION bump (a separate, lower-level mechanism — see its
 * comment); this migration only backfills DATA: every existing
 * RateCardLineage predates the payType field, and every one of them
 * is unambiguously hourly (per-load didn't exist yet when they were
 * created) — including Alex's own real Apex Driving/Parcel Line lineage.
 * Guarded on "does this lineage already have a payType" so a retry
 * after a partial failure never double-writes — same restart-safety
 * pattern as prior migrations.
 * @param {ReturnType<typeof import('../storage/db.js').createIndexedDbDb>} db
 */
export async function migration011AddPerLoadPay(db) {
  const lineages = await db.rateCardLineages.getAll();
  for (const lineage of lineages) {
    if ("payType" in lineage) continue;
    await db.rateCardLineages.update(lineage.id, { payType: "hourly" });
  }
}
