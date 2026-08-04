import { newId } from "../domain/ids.js";

const DEFAULT_BREAK_MINUTES = 45;

/**
 * "What should we show for this person's name" — the one place that
 * understands both the legacy single `name` field and the structured
 * firstName/lastName/displayName shape. Never read Person.name (or
 * firstName/lastName) directly for display; call this instead.
 * @param {import('../domain/types.js').Person|null|undefined} person
 */
export function resolvePersonDisplayName(person) {
  if (!person) return "";
  if (person.displayName) return person.displayName;
  const full = [person.firstName, person.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  return person.name ?? "";
}

/**
 * Every driver-role Membership in this workspace, each paired with its
 * Person and (if one exists) this workspace's own DriverProfile for
 * them. Membership is the roster source — a person with no
 * DriverProfile row here yet is still listed, treated as active by
 * default (absence of a profile is not the same as an archived one).
 * @param {string} workspaceId
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function listDriversForWorkspace(workspaceId, db) {
  const memberships = await db.memberships.query({ where: { workspaceId } });
  const driverMemberships = memberships.filter((m) => m.roles.includes("driver"));
  const results = await Promise.all(
    driverMemberships.map(async (membership) => {
      const [person, driverProfiles] = await Promise.all([
        db.people.getById(membership.personId),
        db.driverProfiles.query({ where: { personId: membership.personId, workspaceId } }),
      ]);
      return { person, membership, driverProfile: driverProfiles[0] ?? null };
    })
  );
  return results.filter((r) => r.person);
}

/**
 * One driver's full detail, scoped to this workspace — returns null if
 * the person isn't actually a driver-role member of THIS workspace
 * (this is the cross-workspace guard: a manager in workspace A cannot
 * fetch a driver who only belongs to workspace B).
 * @param {string} workspaceId
 * @param {string} personId
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function getDriver(workspaceId, personId, db) {
  const memberships = await db.memberships.query({ where: { workspaceId, personId } });
  const membership = memberships[0] ?? null;
  if (!membership || !membership.roles.includes("driver")) return null;
  const [person, driverProfiles] = await Promise.all([
    db.people.getById(personId),
    db.driverProfiles.query({ where: { personId, workspaceId } }),
  ]);
  if (!person) return null;
  return { person, membership, driverProfile: driverProfiles[0] ?? null };
}

/**
 * Creates a Person + a workspace-scoped DriverProfile + a driver
 * Membership as ONE atomic operation (db.insertAtomic) — either all
 * three rows exist or none do. UI code must call this rather than
 * coordinating db.people/driverProfiles/memberships writes directly,
 * both for the atomicity guarantee and because "what does creating a
 * driver mean" is a domain rule, not a generic repository concern.
 * @param {{workspaceId: string, firstName: string, lastName: string, displayName?: string, email?: string, referenceNumber?: string}} input
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function createDriver(input, db) {
  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  if (!firstName || !lastName) {
    throw new Error("First name and last name are required");
  }

  const personId = newId("person");
  const driverProfileId = newId("driverprofile");
  const membershipId = newId("membership");
  const now = new Date().toISOString();

  await db.insertAtomic([
    {
      collection: "people",
      item: {
        id: personId,
        firstName,
        lastName,
        displayName: input.displayName?.trim() || null,
        email: input.email?.trim() || null,
        archivedAt: null,
        createdAt: now,
      },
    },
    {
      collection: "driverProfiles",
      item: {
        id: driverProfileId,
        personId,
        workspaceId: input.workspaceId,
        referenceNumber: input.referenceNumber?.trim() || null,
        defaultBreakMinutes: DEFAULT_BREAK_MINUTES,
        lastUsedAssignmentId: null,
        preferredAssignmentId: null,
        archivedAt: null,
        createdAt: now,
      },
    },
    {
      collection: "memberships",
      item: {
        id: membershipId,
        workspaceId: input.workspaceId,
        personId,
        roles: ["driver"],
        archivedAt: null,
        createdAt: now,
      },
    },
  ]);

  return { personId, driverProfileId, membershipId };
}

/**
 * Provisions a personal Workspace + Membership + DriverProfile for a
 * person with none yet — every local install has had this "for free"
 * via migration 002's hardcoded data (the one real pre-existing user),
 * so this gap was never exercised until server-mode registration
 * created a genuinely first-run person with zero pre-existing rows.
 * Idempotent: no-ops if the person already belongs to a personal
 * workspace. Same atomic insertAtomic pattern as createDriver.
 * @param {{id: string, name?: string|null, firstName?: string, lastName?: string, displayName?: string|null}} person
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function ensurePersonalWorkspace(person, db) {
  const memberships = await db.memberships.query({ where: { personId: person.id } });
  const workspaces = await Promise.all(memberships.map((m) => db.workspaces.getById(m.workspaceId)));
  if (workspaces.some((w) => w?.kind === "personal")) {
    return null;
  }

  const workspaceId = newId("workspace");
  const now = new Date().toISOString();
  const displayName = resolvePersonDisplayName(person) || "Personal";

  await db.insertAtomic([
    {
      collection: "workspaces",
      item: { id: workspaceId, kind: "personal", name: `${displayName} — Personal`, ownerPersonId: person.id, createdAt: now },
    },
    {
      collection: "memberships",
      item: { id: newId("membership"), workspaceId, personId: person.id, roles: ["driver", "owner"], archivedAt: null, createdAt: now },
    },
    {
      collection: "driverProfiles",
      item: {
        id: newId("driverprofile"),
        personId: person.id,
        workspaceId,
        referenceNumber: null,
        defaultBreakMinutes: DEFAULT_BREAK_MINUTES,
        lastUsedAssignmentId: null,
        preferredAssignmentId: null,
        archivedAt: null,
        createdAt: now,
      },
    },
  ]);

  return workspaceId;
}

/**
 * Upserts this workspace's DriverProfile for a person — most driver
 * edits touch a profile that was lazily never created (see
 * DriverProfile's doc comment), so this creates one on first write
 * rather than requiring a separate "set up the profile" step.
 */
async function upsertDriverProfile(workspaceId, personId, patch, db) {
  const existing = (await db.driverProfiles.query({ where: { personId, workspaceId } }))[0];
  if (existing) {
    return db.driverProfiles.update(existing.id, patch);
  }
  return db.driverProfiles.insert({
    id: newId("driverprofile"),
    personId,
    workspaceId,
    referenceNumber: null,
    defaultBreakMinutes: DEFAULT_BREAK_MINUTES,
    lastUsedAssignmentId: null,
    preferredAssignmentId: null,
    archivedAt: null,
    createdAt: new Date().toISOString(),
    ...patch,
  });
}

/**
 * Edits Person-level and/or DriverProfile-level fields for one driver —
 * two independent patches to EXISTING rows, never inserts a second
 * Person or recreates the DriverProfile's identity. Workspace-scoped:
 * verifies the person is actually a member of this workspace before
 * touching Person at all (closes the cross-workspace edit gap — a
 * manager in workspace A must not be able to rename a person whose only
 * relationship is with workspace B).
 * @param {string} workspaceId
 * @param {string} personId
 * @param {{person?: object, driverProfile?: object}} patch
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function updateDriver(workspaceId, personId, patch, db) {
  const memberships = await db.memberships.query({ where: { workspaceId, personId } });
  if (memberships.length === 0) {
    throw new Error("This person is not a member of this workspace");
  }
  if (patch.person) {
    await db.people.update(personId, patch.person);
  }
  if (patch.driverProfile) {
    await upsertDriverProfile(workspaceId, personId, patch.driverProfile, db);
  }
}

/**
 * "No longer an active driver for this workspace" — archives (lazily
 * creating first, if needed) THIS workspace's DriverProfile only. Does
 * not touch Membership (broader workspace access stays intact) or
 * Person (global identity, unaffected). Historical Shifts/Assignments/
 * Engagements referencing this personId are completely unaffected —
 * they resolve by id, not by "is this driver currently active."
 */
export async function archiveDriver(workspaceId, personId, db) {
  return upsertDriverProfile(workspaceId, personId, { archivedAt: new Date().toISOString() }, db);
}

export async function restoreDriver(workspaceId, personId, db) {
  return upsertDriverProfile(workspaceId, personId, { archivedAt: null }, db);
}

/**
 * Records which Assignment the driver used on their most recent
 * successful createShift/updateShift — scoped to the driver's OWN
 * workspace (where the Add Shift picker lives), never to the Shift's
 * own workspaceId, which may belong to an employer/agency workspace
 * instead (see docs/ARCHITECTURE.md's ownership rule). No-ops on a
 * null assignmentId: logging one unassigned/unpriced shift must never
 * blank out an existing "what did I use last" default.
 * @param {string} workspaceId
 * @param {string} personId
 * @param {string|null} assignmentId
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function recordLastUsedAssignment(workspaceId, personId, assignmentId, db) {
  if (!assignmentId) return null;
  return upsertDriverProfile(workspaceId, personId, { lastUsedAssignmentId: assignmentId }, db);
}

/**
 * The OPPOSITE of recordLastUsedAssignment: an explicit, driver-chosen
 * default (from the Workplaces screen), not an automatic "what did I
 * use last" — never overwritten by a shift save. Takes priority over
 * lastUsedAssignmentId when DriverApp resolves the Add Shift picker's
 * default. Passing `null` explicitly clears the preference (falls back
 * to lastUsedAssignmentId / first active assignment again) — unlike
 * recordLastUsedAssignment, a null here is a real, intentional choice,
 * not "nothing happened."
 * @param {string} workspaceId
 * @param {string} personId
 * @param {string|null} assignmentId
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function setPreferredAssignment(workspaceId, personId, assignmentId, db) {
  return upsertDriverProfile(workspaceId, personId, { preferredAssignmentId: assignmentId }, db);
}

/**
 * The solo-driver "set up my work" guided flow (Stage 4D): from the
 * user's perspective, one operation — "Example Driver Agency -> Example Logistics ->
 * Depot A, £X/hr" — that behind the scenes creates an Organisation
 * (provider) + optionally a second Organisation (client, if not
 * reusing an existing one) + Site + RateCardLineage + first RateCard
 * version + Engagement + Placement + Assignment. Uses db.insertAtomic
 * (the same mechanism createDriver already uses) so this either
 * completes consistently or rolls back consistently — never leaves a
 * half-created Organisation/Site/Engagement behind. Pass an existing
 * `providerOrganisationId`/`clientOrganisationId` to reuse an
 * already-created organisation instead of creating a new one (e.g. a
 * second placement with the same agency).
 * @param {{
 *   workspaceId: string,
 *   driverId: string,
 *   startDate: string,
 *   relationshipType: import('../domain/types.js').RelationshipType,
 *   providerOrganisationId?: string,
 *   providerOrganisationName?: string,
 *   clientOrganisationId?: string,
 *   clientOrganisationName?: string,
 *   siteName: string,
 *   rateCardName: string,
 *   rates: object,
 *   payType?: import('../domain/types.js').PayType,
 * }} input
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function createSoloWorkContext(input, db) {
  const now = new Date().toISOString();
  const payType = input.payType ?? "hourly";
  const writes = [];

  let providerOrganisationId = input.providerOrganisationId;
  if (!providerOrganisationId) {
    providerOrganisationId = newId("org");
    writes.push({
      collection: "organisations",
      item: {
        id: providerOrganisationId,
        workspaceId: input.workspaceId,
        legalName: input.providerOrganisationName,
        tradingName: input.providerOrganisationName,
        types: ["agency"],
        archivedAt: null,
      },
    });
  }

  let clientOrganisationId = input.clientOrganisationId;
  if (!clientOrganisationId) {
    clientOrganisationId = newId("org");
    writes.push({
      collection: "organisations",
      item: {
        id: clientOrganisationId,
        workspaceId: input.workspaceId,
        legalName: input.clientOrganisationName,
        tradingName: input.clientOrganisationName,
        types: ["client"],
        archivedAt: null,
      },
    });
  }

  const siteId = newId("site");
  writes.push({
    collection: "sites",
    item: {
      id: siteId,
      organisationId: clientOrganisationId,
      name: input.siteName,
      kind: "client_site",
      clientName: null,
      address: null,
      notes: null,
      archivedAt: null,
    },
  });

  const rateCardId = newId("ratecard");
  writes.push({
    collection: "rateCardLineages",
    item: { id: rateCardId, workspaceId: input.workspaceId, name: input.rateCardName, payType, archivedAt: null, createdAt: now },
  });
  writes.push({
    collection: "rateCards",
    item: {
      id: rateCardId,
      workspaceId: input.workspaceId,
      lineageId: rateCardId,
      version: 1,
      supersedesId: null,
      effectiveFrom: input.startDate,
      // Nothing to configure at the rate-card level for per-load pay
      // (see the architecture proposal §2.2) — the caller's `rates` is
      // ignored rather than trusted to already be empty, same as
      // rateCardService.createRateCard.
      rates: payType === "per_load" ? {} : input.rates,
    },
  });

  const engagementId = newId("engagement");
  writes.push({
    collection: "engagements",
    item: {
      id: engagementId,
      providerOrganisationId,
      workspaceId: input.workspaceId,
      driverId: input.driverId,
      relationshipType: input.relationshipType,
      startDate: input.startDate,
      endDate: null,
      status: "active",
    },
  });

  const placementId = newId("placement");
  writes.push({
    collection: "placements",
    item: {
      id: placementId,
      workspaceId: input.workspaceId,
      providerOrganisationId,
      siteId,
      rateCardLineageId: rateCardId,
      effectiveFrom: input.startDate,
      effectiveTo: null,
      archivedAt: null,
      createdAt: now,
    },
  });

  const assignmentId = newId("assignment");
  writes.push({
    collection: "assignments",
    item: { id: assignmentId, engagementId, placementId, startDate: input.startDate, endDate: null },
  });

  await db.insertAtomic(writes);

  return { providerOrganisationId, clientOrganisationId, siteId, rateCardLineageId: rateCardId, engagementId, placementId, assignmentId };
}
