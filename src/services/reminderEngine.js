import { resolveDocumentStatus } from "./documentExpiryEngine.js";

const DOCUMENT_ALERT_STATUSES = new Set(["expired", "expiring_soon"]);
const CPC_ALERT_STATUSES = new Set(["problem", "warning"]);

/**
 * Derives the driver Dashboard's reminder list — see
 * decision-2026-08-04-working-time-reminders-architecture. Pure and
 * untranslated (message text is built in the view layer, same split
 * every other engine in this app uses) — each entry carries just
 * enough raw data for the caller to render a message.
 * @param {import('../domain/types.js').DriverDocument[]} driverDocuments - active documents only
 * @param {{status: 'ok'|'warning'|'problem'|'unknown_cycle'}} cpcCycleStatus
 * @param {Date} today
 * @returns {Array<{kind: 'document', severity: 'warning'|'problem', document: import('../domain/types.js').DriverDocument} | {kind: 'cpc', severity: 'warning'|'problem'}>}
 */
export function resolveDriverReminders(driverDocuments, cpcCycleStatus, today) {
  const reminders = [];
  for (const document of driverDocuments) {
    const status = resolveDocumentStatus(document, today);
    if (DOCUMENT_ALERT_STATUSES.has(status)) {
      reminders.push({ kind: "document", severity: status === "expired" ? "problem" : "warning", document });
    }
  }
  if (CPC_ALERT_STATUSES.has(cpcCycleStatus.status)) {
    reminders.push({ kind: "cpc", severity: cpcCycleStatus.status });
  }
  return reminders;
}

/**
 * Derives the Transport Manager dashboard's unified reminder list —
 * folds the external-TM limit check into the same list as the
 * driver/vehicle roll-up reminders, rather than a second standalone
 * banner. See decision-2026-08-04-working-time-reminders-architecture.
 * @param {Array<{personId: string, displayName: string, hoursStatus: 'ok'|'problem', documentStatus: string, cpcCycleStatus: {status: string}}>} drivers
 * @param {Array<{vehicleId: string, registration: string, motStatus: string, insuranceStatus: string, hasDangerousDefect: boolean}>} vehicles
 * @param {{withinLimit: boolean}} externalTmLimitStatus
 */
export function resolveTransportManagerReminders(drivers, vehicles, externalTmLimitStatus) {
  const reminders = [];

  if (!externalTmLimitStatus.withinLimit) {
    reminders.push({ kind: "externalLimit", severity: "problem" });
  }

  for (const driver of drivers) {
    if (driver.hoursStatus === "problem") {
      reminders.push({ kind: "driverHours", severity: "problem", personId: driver.personId, displayName: driver.displayName });
    }
    if (DOCUMENT_ALERT_STATUSES.has(driver.documentStatus)) {
      reminders.push({
        kind: "driverDocument",
        severity: driver.documentStatus === "expired" ? "problem" : "warning",
        personId: driver.personId,
        displayName: driver.displayName,
      });
    }
    if (CPC_ALERT_STATUSES.has(driver.cpcCycleStatus.status)) {
      reminders.push({
        kind: "driverCpc",
        severity: driver.cpcCycleStatus.status,
        personId: driver.personId,
        displayName: driver.displayName,
      });
    }
  }

  for (const vehicle of vehicles) {
    if (DOCUMENT_ALERT_STATUSES.has(vehicle.motStatus)) {
      reminders.push({
        kind: "vehicleMot",
        severity: vehicle.motStatus === "expired" ? "problem" : "warning",
        vehicleId: vehicle.vehicleId,
        registration: vehicle.registration,
      });
    }
    if (DOCUMENT_ALERT_STATUSES.has(vehicle.insuranceStatus)) {
      reminders.push({
        kind: "vehicleInsurance",
        severity: vehicle.insuranceStatus === "expired" ? "problem" : "warning",
        vehicleId: vehicle.vehicleId,
        registration: vehicle.registration,
      });
    }
    if (vehicle.hasDangerousDefect) {
      reminders.push({ kind: "vehicleDefect", severity: "problem", vehicleId: vehicle.vehicleId, registration: vehicle.registration });
    }
  }

  return reminders;
}
