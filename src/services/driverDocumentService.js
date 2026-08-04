import { newId } from "../domain/ids.js";

/**
 * All of a driver's DriverDocuments. Includes archived rows by
 * default so the driver's own screen can show renewal history — pass
 * `{activeOnly: true}` for read paths that only care about current
 * status (the Dashboard tile, DE-2's company drilldown).
 * @param {string} personId
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 * @param {{activeOnly?: boolean}} [options]
 */
export async function listDriverDocuments(personId, db, options = {}) {
  const all = await db.driverDocuments.query({ where: { personId } });
  return options.activeOnly ? all.filter((d) => !d.archivedAt) : all;
}

/**
 * @param {{personId: string, documentType: import('../domain/types.js').DriverDocumentType, label?: string|null, referenceNumber?: string|null, expiryDate?: string|null, notes?: string|null}} input
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function createDriverDocument(input, db) {
  if (input.documentType === "other" && !input.label) {
    throw new Error("A label is required for an 'other' document type");
  }
  const now = new Date().toISOString();
  return db.driverDocuments.insert({
    id: newId("driverdocument"),
    personId: input.personId,
    documentType: input.documentType,
    label: input.documentType === "other" ? input.label : null,
    referenceNumber: input.referenceNumber || null,
    expiryDate: input.expiryDate || null,
    notes: input.notes || null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

/** `documentType` is immutable once created — same "locked once meaningful" spirit as RateCardLineage.payType. */
export async function updateDriverDocument(id, patch, db) {
  if ("documentType" in patch) {
    throw new Error("documentType cannot be changed after creation");
  }
  return db.driverDocuments.update(id, { ...patch, updatedAt: new Date().toISOString() });
}

export async function archiveDriverDocument(id, db) {
  return db.driverDocuments.update(id, { archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}

export async function restoreDriverDocument(id, db) {
  return db.driverDocuments.update(id, { archivedAt: null, updatedAt: new Date().toISOString() });
}

/**
 * Renewal — archives the existing row and inserts a fresh one carrying
 * the new expiry date, never an in-place date edit (see the
 * DriverDocument typedef and the architecture proposal's §6.4): a
 * driver's document history should show every past validity period,
 * not just the current one. Not a single atomic transaction — this
 * app's `db.insertAtomic` helper only spans multi-row INSERTs, not an
 * update+insert pair — so the archive is applied first: a failure
 * partway through at worst leaves the old row archived with no active
 * replacement yet, never two simultaneously-active rows for the same
 * physical document.
 * @param {string} oldDocumentId
 * @param {{expiryDate: string|null, referenceNumber?: string|null, notes?: string|null}} patch
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function renewDriverDocument(oldDocumentId, patch, db) {
  const old = await db.driverDocuments.getById(oldDocumentId);
  if (!old) throw new Error("Document not found");
  await archiveDriverDocument(oldDocumentId, db);
  return createDriverDocument(
    {
      personId: old.personId,
      documentType: old.documentType,
      label: old.label,
      referenceNumber: "referenceNumber" in patch ? patch.referenceNumber : old.referenceNumber,
      expiryDate: patch.expiryDate,
      notes: "notes" in patch ? patch.notes : old.notes,
    },
    db
  );
}
