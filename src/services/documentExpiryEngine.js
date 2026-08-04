const DEFAULT_WARNING_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Derives a single DriverDocument's expiry status — never stored on the
 * row (see the DriverDocument typedef), always recomputed from
 * `expiryDate` and "today," the same reasoning complianceEngine already
 * applies to compliance alerts: a status must never go stale just
 * because nobody happened to re-save the row on the day it tipped over
 * a threshold.
 * @param {import('../domain/types.js').DriverDocument} document
 * @param {Date} today
 * @param {number} [warningWindowDays]
 * @returns {'ok'|'expiring_soon'|'expired'|'unknown'}
 */
export function resolveDocumentStatus(document, today, warningWindowDays = DEFAULT_WARNING_WINDOW_DAYS) {
  if (!document.expiryDate) return "unknown";
  const expiry = new Date(`${document.expiryDate}T00:00:00`);
  const daysUntilExpiry = Math.floor((expiry.getTime() - today.getTime()) / MS_PER_DAY);
  if (daysUntilExpiry < 0) return "expired";
  if (daysUntilExpiry <= warningWindowDays) return "expiring_soon";
  return "ok";
}

const STATUS_SEVERITY = { expired: 3, expiring_soon: 2, unknown: 1, ok: 0 };

/**
 * Rolls a driver's active DriverDocuments into one glanceable status —
 * the worst status across all of them, feeding the Dashboard tile and
 * (DE-2) the company drilldown badge, the same "roll several data
 * points into one status" shape the Dashboard's existing compliance
 * cards already use. Callers must pass only ACTIVE (non-archived)
 * documents — this function does not filter `archivedAt` itself,
 * mirroring how complianceEngine takes already-scoped shifts rather
 * than re-deriving scope. An empty list resolves to 'ok' (nothing
 * tracked yet = nothing to warn about), the same "no data yet, no
 * problem yet" convention the compliance cards already use before any
 * shift has been logged.
 * @param {import('../domain/types.js').DriverDocument[]} documents
 * @param {Date} today
 * @param {number} [warningWindowDays]
 * @returns {'ok'|'expiring_soon'|'expired'|'unknown'}
 */
export function resolveDriverDocumentSummary(documents, today, warningWindowDays = DEFAULT_WARNING_WINDOW_DAYS) {
  let worst = "ok";
  for (const document of documents) {
    const status = resolveDocumentStatus(document, today, warningWindowDays);
    if (STATUS_SEVERITY[status] > STATUS_SEVERITY[worst]) worst = status;
  }
  return worst;
}
