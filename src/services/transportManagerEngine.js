/**
 * Senior Traffic Commissioner Statutory Document No. 3 (Transport
 * Managers, revised guidance and directions, 9 January 2024) publishes
 * a starting-point table of minimum weekly hours a Transport Manager
 * should dedicate, scaled by fleet size — see
 * docs/TRANSPORT_MANAGER_ARCHITECTURE_PROPOSAL.md's Sources. Bands are
 * inclusive of their upper bound; `maxHours: null` means "full time,"
 * an open-ended upper bound the source table itself doesn't put a
 * number on.
 */
const HOURS_BANDS = [
  { maxVehicles: 2, minHours: 2, maxHours: 4 },
  { maxVehicles: 5, minHours: 4, maxHours: 8 },
  { maxVehicles: 10, minHours: 8, maxHours: 12 },
  { maxVehicles: 14, minHours: 12, maxHours: 20 },
  { maxVehicles: 29, minHours: 20, maxHours: 30 },
  { maxVehicles: 50, minHours: 30, maxHours: null, fullTimeRequired: true },
];

/**
 * Purely informational — this app captures no Transport Manager
 * working hours and enforces nothing here. See the statutory
 * document's own caveat, reproduced in the UI: "a starting point only,"
 * not a fixed rule.
 * @param {number} vehicleCount
 * @returns {{minHours: number|null, maxHours: number|null, fullTimeRequired: boolean, additionalAssistanceRecommended: boolean}}
 */
export function resolveRecommendedHours(vehicleCount) {
  const band = HOURS_BANDS.find((b) => vehicleCount <= b.maxVehicles);
  if (!band) {
    return { minHours: null, maxHours: null, fullTimeRequired: true, additionalAssistanceRecommended: true };
  }
  return { minHours: band.minHours, maxHours: band.maxHours, fullTimeRequired: Boolean(band.fullTimeRequired), additionalAssistanceRecommended: false };
}

const EXTERNAL_TM_OPERATOR_LIMIT = 4;
const EXTERNAL_TM_VEHICLE_LIMIT = 50;

/**
 * An external Transport Manager may act for no more than 4 operators,
 * with a combined fleet of no more than 50 vehicles — see the
 * architecture proposal's Sources. This app has no employment-type
 * field distinguishing "internal" from "external" TMs, so this check
 * is computed for every `transport_manager`-role holder regardless;
 * an internal TM with only one workspace will simply never trip it.
 * @param {{workspaceId: string, vehicleCount: number}[]} workspaceSummaries - every workspace this person holds the transport_manager role in
 * @returns {{operatorCount: number, totalVehicleCount: number, operatorLimit: number, vehicleLimit: number, withinLimit: boolean}}
 */
export function resolveExternalTmLimitStatus(workspaceSummaries) {
  const operatorCount = workspaceSummaries.length;
  const totalVehicleCount = workspaceSummaries.reduce((sum, w) => sum + w.vehicleCount, 0);
  const withinLimit = operatorCount <= EXTERNAL_TM_OPERATOR_LIMIT && totalVehicleCount <= EXTERNAL_TM_VEHICLE_LIMIT;
  return { operatorCount, totalVehicleCount, operatorLimit: EXTERNAL_TM_OPERATOR_LIMIT, vehicleLimit: EXTERNAL_TM_VEHICLE_LIMIT, withinLimit };
}
