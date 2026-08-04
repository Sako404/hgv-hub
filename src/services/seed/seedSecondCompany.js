import { newId } from "../../domain/ids.js";
import { createRateCard } from "../rateCardService.js";
import { createDriver } from "../driverService.js";
import { MANAGER_ROLES } from "../workspaceService.js";

const SEED_ORG_NAME = "Northline Transport Ltd";

const DRIVER_NAMES = ["Alicja Nowak", "Tomasz Kowalski", "Ben Carter"];

// Deliberately different numbers from the Apex Driving rate card, to
// prove property 8 (different drivers/orgs can have different rate cards).
const NORTHLINE_RATES = {
  MonThu: { Days: [15.5, 17.0], Lates: [16.0, 17.6], Nights: [17.0, 18.7] },
  Fri: { Days: [16.0, 17.6], Lates: [16.5, 18.15], Nights: [17.5, 19.25] },
  Sat: { Days: [17.0, 18.7], Lates: [17.5, 19.25], Nights: [19.5, 21.45] },
  Sun: { Days: [18.0, 19.8], Lates: [18.5, 20.35], Nights: [20.5, 22.55] },
};

/**
 * Ensures `personId` has a managerial Membership (a role recognised by
 * workspaceService's MANAGER_ROLES, so resolveSession/AppShell's
 * switcher actually surfaces this workspace) into `workspaceId`.
 * Idempotent: never inserts a second membership for the same
 * (workspaceId, personId) pair. Self-healing: if a membership already
 * exists but carries no managerial role (e.g. a stale "viewer"-only
 * row from before this function existed), it adds "owner" to that
 * membership's roles rather than leaving it non-managerial.
 * @param {ReturnType<typeof import('../../storage/db.js').createDb>} db
 * @param {string} workspaceId
 * @param {string} personId
 */
async function ensureManagerialMembership(db, workspaceId, personId) {
  const existing = (await db.memberships.query({ where: { workspaceId, personId } }))[0];

  if (!existing) {
    await db.memberships.insert({
      id: newId("membership"),
      workspaceId,
      personId,
      roles: ["owner"],
      archivedAt: null,
      createdAt: new Date().toISOString(),
    });
    return;
  }

  const hasManagerialRole = existing.roles.some((r) => MANAGER_ROLES.includes(r));
  if (!hasManagerialRole) {
    await db.memberships.update(existing.id, { roles: [...existing.roles, "owner"] });
  }
}

/**
 * The one-time creation of the "Northline Transport Ltd" workspace, its
 * organisation/site/RateCard, an owner persona, and several demo
 * drivers each with their own personal workspace plus a
 * membership/engagement/assignment into the company. Only ever runs
 * once — seedSecondCompany() guards this behind the existing-org
 * check and never calls it again on later calls.
 * @param {ReturnType<typeof import('../../storage/db.js').createDb>} db
 */
async function seedFreshCompany(db) {
  const now = new Date().toISOString();

  const companyWorkspaceId = newId("workspace");
  await db.workspaces.insert({
    id: companyWorkspaceId,
    kind: "transport_company",
    name: SEED_ORG_NAME,
    ownerPersonId: null,
    createdAt: now,
  });

  const orgId = newId("org");
  await db.organisations.insert({
    id: orgId,
    workspaceId: companyWorkspaceId,
    legalName: SEED_ORG_NAME,
    tradingName: "Northline Transport",
    types: ["transport_company"],
    archivedAt: null,
  });

  const siteId = newId("site");
  await db.sites.insert({
    id: siteId,
    organisationId: orgId,
    name: "Northline Transport – Fernhill Depot",
    kind: "depot",
    clientName: null,
    address: null,
    notes: null,
    archivedAt: null,
  });

  const rateCard = await createRateCard(
    { workspaceId: companyWorkspaceId, name: "Northline Transport Standard Rates", effectiveFrom: now.slice(0, 10), rates: NORTHLINE_RATES },
    db
  );
  const rateCardId = rateCard.id;

  const ownerPersonId = newId("person");
  // The owner is a Person only -- never a driver, so created directly
  // (not via createDriver, which always creates a DriverProfile + driver Membership).
  await db.people.insert({ id: ownerPersonId, firstName: "Riley", lastName: "Owner", displayName: null, email: null, archivedAt: null, createdAt: now });
  // Every person gets a personal workspace by default, same as a driver —
  // an org owner is still a person who could log independent work.
  const ownerPersonalWorkspaceId = newId("workspace");
  await db.workspaces.insert({
    id: ownerPersonalWorkspaceId,
    kind: "personal",
    name: "Riley Owner — Personal",
    ownerPersonId,
    createdAt: now,
  });
  await db.memberships.insert({
    id: newId("membership"),
    workspaceId: ownerPersonalWorkspaceId,
    personId: ownerPersonId,
    roles: ["driver", "owner"],
    archivedAt: null,
    createdAt: now,
  });
  await db.memberships.insert({
    id: newId("membership"),
    workspaceId: companyWorkspaceId,
    personId: ownerPersonId,
    roles: ["owner"],
    archivedAt: null,
    createdAt: now,
  });

  const driverStartDates = ["2026-06-01", "2026-06-15", "2026-07-01"];
  const demoShiftOffsets = [
    { date: "2026-07-14", start: "08:00", end: "16:00", drivingHours: 6 },
    { date: "2026-07-17", start: "14:00", end: "23:00", drivingHours: 7 },
  ];

  // ONE shared Placement for all three demo drivers -- proves the
  // Stage 4D sharing model on exactly the multi-driver data that
  // motivated it (three Engagements + three Assignments referencing
  // one Placement, instead of three duplicated site/rate configs).
  const placementId = newId("placement");
  await db.placements.insert({
    id: placementId,
    workspaceId: companyWorkspaceId,
    providerOrganisationId: orgId,
    siteId,
    rateCardLineageId: rateCardId,
    effectiveFrom: driverStartDates[0],
    effectiveTo: null,
    archivedAt: null,
    createdAt: now,
  });

  const seededDrivers = [];
  for (let i = 0; i < DRIVER_NAMES.length; i++) {
    const [firstName, ...lastParts] = DRIVER_NAMES[i].split(" ");
    const lastName = lastParts.join(" ");

    // createDriver() atomically creates the Person, this workspace's own
    // DriverProfile, and the driver Membership -- the same orchestration
    // a real "Add Driver" via the UI uses (driverService.js).
    const { personId: driverPersonId } = await createDriver(
      { workspaceId: companyWorkspaceId, firstName, lastName },
      db
    );

    // Every person also gets their own personal workspace, same as a
    // real driver signing up independently -- not part of createDriver()
    // itself, since that's specific to "this company's own driver
    // record," not identity bootstrapping.
    const personalWorkspaceId = newId("workspace");
    await db.workspaces.insert({
      id: personalWorkspaceId,
      kind: "personal",
      name: `${DRIVER_NAMES[i]} — Personal`,
      ownerPersonId: driverPersonId,
      createdAt: now,
    });
    await db.memberships.insert({
      id: newId("membership"),
      workspaceId: personalWorkspaceId,
      personId: driverPersonId,
      roles: ["driver", "owner"],
      archivedAt: null,
      createdAt: now,
    });

    const engagementId = newId("engagement");
    await db.engagements.insert({
      id: engagementId,
      providerOrganisationId: orgId,
      workspaceId: companyWorkspaceId,
      driverId: driverPersonId,
      relationshipType: "employee",
      startDate: driverStartDates[i],
      endDate: null,
      status: "active",
    });
    const assignmentId = newId("assignment");
    await db.assignments.insert({
      id: assignmentId,
      engagementId,
      placementId,
      startDate: driverStartDates[i],
      endDate: null,
    });

    // This seeder only ever creates a single RateCard version, so every
    // demo shift is trivially priced by it — pinned directly, same as
    // a live createShift() would resolve for any of these dates.
    for (const offset of demoShiftOffsets) {
      await db.shifts.insert({
        id: newId("shift"),
        workspaceId: companyWorkspaceId,
        driverId: driverPersonId,
        assignmentId,
        date: offset.date,
        start: offset.start,
        end: offset.end,
        breakMinutes: 45,
        drivingHours: offset.drivingHours,
        rateCardId,
        createdAt: now,
        updatedAt: now,
        source: "manual",
      });
    }

    seededDrivers.push({ personId: driverPersonId, engagementId, assignmentId });
  }

  return { companyWorkspaceId, orgId, siteId, rateCardId, ownerPersonId, drivers: seededDrivers };
}

/**
 * Dev/test-only seeder proving the multi-driver / multi-organisation
 * shape of the domain model: a second workspace ("Northline Transport Ltd")
 * with its own site, its own distinct RateCard, an owner persona, and
 * several drivers each with their own personal workspace plus a
 * membership/engagement/assignment into the company. Idempotent for
 * every record this creates (workspace/organisation/site/drivers/
 * assignments/rate cards/memberships) — a second call never
 * reseeds or duplicates any of it, it just returns the existing
 * organisation.
 *
 * `grantAccessToPersonId`, when given, ensures that person has a
 * managerial Membership into the company workspace (so it appears in
 * their workspace switcher) — this runs on EVERY call, including the
 * already-seeded idempotent path, not just the one-time fresh seed.
 * That's the whole point of taking this option: a dev inspecting an
 * already-seeded database can still request access without having to
 * delete and reseed anything.
 * @param {ReturnType<typeof import('../../storage/db.js').createDb>} db
 * @param {{grantAccessToPersonId?: string}} [options]
 */
export async function seedSecondCompany(db, { grantAccessToPersonId } = {}) {
  const existingOrg = (await db.organisations.query({ where: { legalName: SEED_ORG_NAME } }))[0];
  const result = existingOrg ?? (await seedFreshCompany(db));
  const companyWorkspaceId = existingOrg ? existingOrg.workspaceId : result.companyWorkspaceId;

  if (grantAccessToPersonId) {
    await ensureManagerialMembership(db, companyWorkspaceId, grantAccessToPersonId);
  }

  return result;
}
