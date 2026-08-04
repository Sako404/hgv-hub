const HOURS_REQUIRED = 35;
const CYCLE_YEARS = 5;

function parseDateOnly(dateString) {
  return new Date(`${dateString}T00:00:00`);
}

// Formats a Date's LOCAL calendar date as "YYYY-MM-DD" — deliberately
// not `toISOString().slice(0, 10)`, which converts to UTC first and so
// silently shifts a local midnight to the previous day in any
// timezone ahead of UTC (this app runs client-side, in whatever
// timezone the driver's own device is set to).
function formatDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Derives a driver's CPC training cycle status — never stored, always
 * recomputed, same "recompute from source" reasoning
 * `documentExpiryEngine`/`complianceEngine` already use. The cycle is
 * NOT tracked as its own field anywhere: `cycleEndDate` is the
 * driver's active `cpc_card` DriverDocument's own `expiryDate` (a real
 * Driver Qualification Card's expiry IS the end of the current 5-year
 * training cycle under the DVSA rule), and `cycleStartDate` is simply
 * 5 years before that — see
 * decision-2026-08-04-working-time-cpc-training-architecture for why
 * this avoids a separate "cycle start date" setup field entirely.
 * @param {import('../domain/types.js').DriverDocument|null} cpcCardDocument - the driver's active (non-archived) 'cpc_card' DriverDocument, or null if they don't have one yet
 * @param {import('../domain/types.js').CpcTrainingRecord[]} trainingRecords - every training record for this driver; records outside the resolved cycle are simply not counted, so callers may pass the full history
 * @param {Date} today
 * @returns {{cycleStartDate: string|null, cycleEndDate: string|null, hoursCompleted: number, hoursRequired: number, status: 'ok'|'warning'|'problem'|'unknown_cycle'}}
 */
export function resolveCpcCycleStatus(cpcCardDocument, trainingRecords, today) {
  if (!cpcCardDocument || !cpcCardDocument.expiryDate) {
    return { cycleStartDate: null, cycleEndDate: null, hoursCompleted: 0, hoursRequired: HOURS_REQUIRED, status: "unknown_cycle" };
  }

  const cycleEnd = parseDateOnly(cpcCardDocument.expiryDate);
  const cycleStart = new Date(cycleEnd);
  cycleStart.setFullYear(cycleStart.getFullYear() - CYCLE_YEARS);

  const hoursCompleted = trainingRecords
    .filter((record) => {
      const recordDate = parseDateOnly(record.date);
      return recordDate >= cycleStart && recordDate <= cycleEnd;
    })
    .reduce((sum, record) => sum + (Number(record.hours) || 0), 0);

  const status = hoursCompleted >= HOURS_REQUIRED ? "ok" : today <= cycleEnd ? "warning" : "problem";

  return {
    cycleStartDate: formatDateOnly(cycleStart),
    cycleEndDate: cpcCardDocument.expiryDate,
    hoursCompleted,
    hoursRequired: HOURS_REQUIRED,
    status,
  };
}
