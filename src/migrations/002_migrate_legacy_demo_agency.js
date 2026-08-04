import { STORAGE_KEYS } from "../storage/keys.js";

// Copied verbatim from the pre-refactor App.jsx module-level RATES
// constant. Lives only here as static migration data — nothing else in
// the codebase imports a hardcoded rate table after this migration runs.
const LEGACY_RATES = {
  MonThu: { Days: [12.00, 14.00], Lates: [12.50, 14.50], Nights: [13.50, 15.50] },
  Fri: { Days: [12.75, 14.75], Lates: [13.25, 15.25], Nights: [14.25, 16.25] },
  Sat: { Days: [13.50, 15.50], Lates: [14.00, 16.00], Nights: [16.00, 18.00] },
  Sun: { Days: [14.00, 16.00], Lates: [14.50, 16.50], Nights: [17.00, 19.00] },
};

const PERSON_ID = "person-demo";
const PERSONAL_WORKSPACE_ID = "workspace-personal-demo";
const DRIVER_PROFILE_ID = "driverprofile-demo";
const AGENCY_WORKSPACE_ID = "workspace-demo-agency";
const ORG_ID = "org-demo-agency";
const SITE_ID = "site-demo-client";
const RATE_CARD_ID = "ratecard-demo-agency-client";
const ENGAGEMENT_ID = "engagement-demo-agency";
const PLACEMENT_ID = "placement-demo-agency-client";
const ASSIGNMENT_ID = "assignment-demo-agency-client";

/**
 * One-time migration of the legacy single-employer `hgv-shifts`
 * localStorage array into the new workspace/person/organisation model.
 * Read-only against the legacy key — it is NEVER deleted or modified.
 * Guarded by schema version in migrations/index.js so it never reruns.
 * @param {ReturnType<typeof import('../storage/db.js').createIndexedDbDb>} db
 * @param {Storage} storage
 */
export async function migration002MigrateLegacyDemoAgency(db, storage) {
  const raw = storage.getItem(STORAGE_KEYS.LEGACY_SHIFTS);
  let legacyShifts = [];
  try {
    legacyShifts = raw ? JSON.parse(raw) : [];
  } catch {
    legacyShifts = [];
  }

  const now = new Date().toISOString();
  const earliestLegacyDate =
    legacyShifts.length > 0
      ? legacyShifts.map((s) => s.date).sort()[0]
      : now.slice(0, 10);

  await db.people.insert({ id: PERSON_ID, firstName: "Alex", lastName: "", displayName: null, email: null, archivedAt: null, createdAt: now });

  await db.workspaces.insert({
    id: PERSONAL_WORKSPACE_ID,
    kind: "personal",
    name: "Alex — Personal",
    ownerPersonId: PERSON_ID,
    createdAt: now,
  });
  await db.memberships.insert({
    id: "membership-demo-personal",
    workspaceId: PERSONAL_WORKSPACE_ID,
    personId: PERSON_ID,
    roles: ["driver", "owner"],
    archivedAt: null,
    createdAt: now,
  });
  await db.driverProfiles.insert({
    id: DRIVER_PROFILE_ID,
    personId: PERSON_ID,
    workspaceId: PERSONAL_WORKSPACE_ID,
    referenceNumber: null,
    defaultBreakMinutes: 45,
    lastUsedAssignmentId: null,
    archivedAt: null,
    createdAt: now,
  });

  await db.workspaces.insert({
    id: AGENCY_WORKSPACE_ID,
    kind: "agency",
    name: "Example Driver Agency",
    ownerPersonId: null,
    createdAt: now,
  });
  await db.organisations.insert({
    id: ORG_ID,
    workspaceId: AGENCY_WORKSPACE_ID,
    legalName: "Example Driver Agency",
    tradingName: "Example Driver Agency",
    types: ["agency"],
    archivedAt: null,
  });
  await db.memberships.insert({
    id: "membership-demo-agency",
    workspaceId: AGENCY_WORKSPACE_ID,
    personId: PERSON_ID,
    roles: ["driver"],
    archivedAt: null,
    createdAt: now,
  });

  await db.sites.insert({
    id: SITE_ID,
    organisationId: ORG_ID,
    name: "Example Logistics Depot A",
    kind: "client_site",
    clientName: "Example Logistics",
    address: null,
    notes: null,
    archivedAt: null,
  });

  await db.rateCards.insert({
    id: RATE_CARD_ID,
    workspaceId: AGENCY_WORKSPACE_ID,
    lineageId: RATE_CARD_ID,
    version: 1,
    supersedesId: null,
    name: "Example Driver Agency – Example Logistics Depot A",
    effectiveFrom: earliestLegacyDate,
    rates: LEGACY_RATES,
  });

  await db.engagements.insert({
    id: ENGAGEMENT_ID,
    providerOrganisationId: ORG_ID,
    workspaceId: AGENCY_WORKSPACE_ID,
    driverId: PERSON_ID,
    relationshipType: "agency_worker",
    startDate: earliestLegacyDate,
    endDate: null,
    status: "active",
  });
  await db.placements.insert({
    id: PLACEMENT_ID,
    workspaceId: AGENCY_WORKSPACE_ID,
    providerOrganisationId: ORG_ID,
    siteId: SITE_ID,
    rateCardLineageId: RATE_CARD_ID,
    effectiveFrom: earliestLegacyDate,
    effectiveTo: null,
    archivedAt: null,
    createdAt: now,
  });
  await db.assignments.insert({
    id: ASSIGNMENT_ID,
    engagementId: ENGAGEMENT_ID,
    placementId: PLACEMENT_ID,
    startDate: earliestLegacyDate,
    endDate: null,
  });

  // This migration only ever creates a single RateCard version, so
  // every migrated shift is trivially priced by it — pinned directly,
  // same as a live createShift() would resolve for any of these dates.
  for (const legacy of legacyShifts) {
    await db.shifts.insert({
      id: legacy.id,
      workspaceId: AGENCY_WORKSPACE_ID,
      driverId: PERSON_ID,
      assignmentId: ASSIGNMENT_ID,
      date: legacy.date,
      start: legacy.start,
      end: legacy.end,
      breakMinutes: Number.isFinite(legacy.breakMinutes) ? legacy.breakMinutes : 45,
      drivingHours: Number(legacy.drivingHours) || 0,
      rateCardId: RATE_CARD_ID,
      createdAt: now,
      updatedAt: now,
      source: "migration",
    });
  }

  storage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, PERSON_ID);
}
