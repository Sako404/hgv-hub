import * as schema from "./schema.js";

// Collection name -> Drizzle table export. Mirrors the client's own
// db.js COLLECTION_KEYS map so drizzleRepository / the generic
// /api/:collection routes can stay uniform across all 20 collections.
export const COLLECTIONS = {
  workspaces: schema.workspaces,
  people: schema.people,
  memberships: schema.memberships,
  organisations: schema.organisations,
  sites: schema.sites,
  driverProfiles: schema.driverProfiles,
  engagements: schema.engagements,
  placements: schema.placements,
  assignments: schema.assignments,
  shifts: schema.shifts,
  rateCardLineages: schema.rateCardLineages,
  rateCards: schema.rateCards,
  loads: schema.loads,
  complianceProfiles: schema.complianceProfiles,
  vehicles: schema.vehicles,
  checklistTemplates: schema.checklistTemplates,
  vehicleChecks: schema.vehicleChecks,
  defects: schema.defects,
  driverDocuments: schema.driverDocuments,
  cpcTrainingRecords: schema.cpcTrainingRecords,
};

export function resolveCollectionTable(collectionName) {
  const table = COLLECTIONS[collectionName];
  if (!table) {
    return null;
  }
  return table;
}
