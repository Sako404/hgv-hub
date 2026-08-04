import { newId } from "../domain/ids.js";
import { listDriverDocuments } from "./driverDocumentService.js";
import { resolveCpcCycleStatus } from "./cpcTrainingEngine.js";

/** All of a driver's logged CPC training sessions. */
export async function listCpcTrainingRecords(personId, db) {
  return db.cpcTrainingRecords.query({ where: { personId } });
}

/**
 * @param {{personId: string, date: string, hours: number, provider?: string|null, notes?: string|null}} input
 */
export async function logCpcTraining(input, db) {
  if (!input.date || !input.hours || Number(input.hours) <= 0) {
    throw new Error("A training session needs a date and a positive number of hours");
  }
  return db.cpcTrainingRecords.insert({
    id: newId("cpctraining"),
    personId: input.personId,
    date: input.date,
    hours: Number(input.hours),
    provider: input.provider || null,
    notes: input.notes || null,
    createdAt: new Date().toISOString(),
  });
}

/** Plain delete — a mis-logged session carries no historical-pinning concern (see the CpcTrainingRecord typedef). */
export async function deleteCpcTrainingRecord(id, db) {
  return db.cpcTrainingRecords.remove(id);
}

/**
 * Composes the driver's active `cpc_card` DriverDocument with their
 * training records into one cycle status — the single read path both
 * the driver's own Dashboard tile and the company-side DriverDrilldown
 * (CPC-2) call, so "which cpc_card counts" is decided in exactly one
 * place. If more than one active cpc_card row somehow exists, the one
 * with the latest expiryDate is used (the most current card).
 * @param {string} personId
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 * @param {Date} [today]
 */
export async function resolveCpcCycleStatusForDriver(personId, db, today = new Date()) {
  const [documents, trainingRecords] = await Promise.all([
    listDriverDocuments(personId, db, { activeOnly: true }),
    listCpcTrainingRecords(personId, db),
  ]);
  const cpcCardDocuments = documents
    .filter((d) => d.documentType === "cpc_card" && d.expiryDate)
    .sort((a, b) => b.expiryDate.localeCompare(a.expiryDate));
  const activeCpcCard = cpcCardDocuments[0] ?? null;
  return resolveCpcCycleStatus(activeCpcCard, trainingRecords, today);
}
