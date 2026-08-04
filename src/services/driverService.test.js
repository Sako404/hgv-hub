import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import { createOrganisation } from "./organisationService.js";
import {
  archiveDriver,
  createDriver,
  createSoloWorkContext,
  ensurePersonalWorkspace,
  getDriver,
  listDriversForWorkspace,
  recordLastUsedAssignment,
  resolvePersonDisplayName,
  restoreDriver,
  setPreferredAssignment,
  updateDriver,
} from "./driverService.js";
import { createShift } from "./shiftService.js";
import { computeShiftBreakdown } from "./payEngine.js";
import { seedSecondCompany } from "./seed/seedSecondCompany.js";
import { resolveActiveAssignmentsForDriver } from "./assignmentService.js";

const RATES_FIXTURE = {
  MonThu: { Days: [15, 17], Lates: [15.5, 17.5], Nights: [16, 18] },
  Fri: { Days: [16, 18], Lates: [16.5, 18.5], Nights: [17, 19] },
  Sat: { Days: [17, 19], Lates: [17.5, 19.5], Nights: [18, 20] },
  Sun: { Days: [18, 20], Lates: [18.5, 20.5], Nights: [19, 21] },
};

describe("driverService — createSoloWorkContext", () => {
  it("creates a full working Engagement + Placement + Assignment (+ new Organisations/Site/RateCard) inside a personal workspace", async () => {
    const { db } = await createTestDb();
    const result = await createSoloWorkContext(
      {
        workspaceId: "workspace-personal-demo",
        driverId: "person-demo",
        startDate: "2099-01-01",
        relationshipType: "agency_worker",
        providerOrganisationName: "Solo Agency",
        clientOrganisationName: "Solo Client",
        siteName: "Solo Site",
        rateCardName: "Solo Rates",
        rates: RATES_FIXTURE,
      },
      db
    );

    const providerOrg = await db.organisations.getById(result.providerOrganisationId);
    expect(providerOrg.tradingName).toBe("Solo Agency");
    expect(providerOrg.workspaceId).toBe("workspace-personal-demo");

    const site = await db.sites.getById(result.siteId);
    expect(site.name).toBe("Solo Site");
    expect(site.organisationId).toBe(result.clientOrganisationId);

    const engagement = await db.engagements.getById(result.engagementId);
    expect(engagement.providerOrganisationId).toBe(result.providerOrganisationId);
    expect(engagement.driverId).toBe("person-demo");

    const placement = await db.placements.getById(result.placementId);
    expect(placement.siteId).toBe(result.siteId);
    expect(placement.rateCardLineageId).toBe(result.rateCardLineageId);

    const assignment = await db.assignments.getById(result.assignmentId);
    expect(assignment.engagementId).toBe(result.engagementId);
    expect(assignment.placementId).toBe(result.placementId);

    // No company workspace was created or required.
    expect((await db.workspaces.getById("workspace-personal-demo")).kind).toBe("personal");

    // End-to-end: Add Shift resolution works immediately.
    const resolved = await resolveActiveAssignmentsForDriver("person-demo", db);
    const soloResolved = resolved.find((r) => r.assignment.id === result.assignmentId);
    expect(soloResolved).toBeTruthy();
    expect(soloResolved.employerOrganisation.tradingName).toBe("Solo Agency");
    expect(soloResolved.site.name).toBe("Solo Site");
  });

  it("reuses an existing provider/client organisation instead of creating a new one when ids are passed", async () => {
    const { db } = await createTestDb();
    const result = await createSoloWorkContext(
      {
        workspaceId: "workspace-personal-demo",
        driverId: "person-demo",
        startDate: "2099-01-01",
        relationshipType: "agency_worker",
        providerOrganisationId: "org-demo-agency",
        clientOrganisationName: "Another Client",
        siteName: "Another Site",
        rateCardName: "Another Rates",
        rates: RATES_FIXTURE,
      },
      db
    );

    expect(result.providerOrganisationId).toBe("org-demo-agency");
    // No duplicate Apex Driving organisation was created.
    const demoOrgs = await db.organisations.query({ where: { id: "org-demo-agency" } });
    expect(demoOrgs).toHaveLength(1);
  });

  it("defaults payType to 'hourly' when omitted, storing the passed rates as-is", async () => {
    const { db } = await createTestDb();
    const result = await createSoloWorkContext(
      {
        workspaceId: "workspace-personal-demo",
        driverId: "person-demo",
        startDate: "2099-01-01",
        relationshipType: "agency_worker",
        providerOrganisationName: "Hourly Agency",
        clientOrganisationName: "Hourly Client",
        siteName: "Hourly Site",
        rateCardName: "Hourly Rates",
        rates: RATES_FIXTURE,
      },
      db
    );
    const lineage = await db.rateCardLineages.getById(result.rateCardLineageId);
    expect(lineage.payType).toBe("hourly");
    const rateCard = await db.rateCards.getById(result.rateCardLineageId);
    expect(rateCard.rates).toEqual(RATES_FIXTURE);
  });

  it("payType 'per_load' forces the RateCard's rates to {} regardless of what's passed (Stage PL-1)", async () => {
    const { db } = await createTestDb();
    const result = await createSoloWorkContext(
      {
        workspaceId: "workspace-personal-demo",
        driverId: "person-demo",
        startDate: "2099-01-01",
        relationshipType: "self_employed",
        providerOrganisationName: "Amazon Relay",
        clientOrganisationName: "Spot Load Client",
        siteName: "Spot Load Site",
        rateCardName: "Spot Loads",
        rates: RATES_FIXTURE,
        payType: "per_load",
      },
      db
    );
    const lineage = await db.rateCardLineages.getById(result.rateCardLineageId);
    expect(lineage.payType).toBe("per_load");
    const rateCard = await db.rateCards.getById(result.rateCardLineageId);
    expect(rateCard.rates).toEqual({});
  });

  it("property: a failed multi-record creation leaves zero of the rows persisted (atomic)", async () => {
    const { db } = await createTestDb();
    const flakyDb = {
      ...db,
      rateCards: {
        ...db.rateCards,
        insert: async () => {
          throw new Error("simulated write failure");
        },
      },
    };

    await expect(
      createSoloWorkContext(
        {
          workspaceId: "workspace-personal-demo",
          driverId: "person-demo",
          startDate: "2099-01-01",
          relationshipType: "agency_worker",
          providerOrganisationName: "Should Rollback Agency",
          clientOrganisationName: "Should Rollback Client",
          siteName: "Should Rollback Site",
          rateCardName: "Should Rollback Rates",
          rates: RATES_FIXTURE,
        },
        flakyDb
      )
    ).rejects.toThrow("simulated write failure");

    expect(await db.organisations.query({ where: { tradingName: "Should Rollback Agency" } })).toHaveLength(0);
    expect(await db.organisations.query({ where: { tradingName: "Should Rollback Client" } })).toHaveLength(0);
    expect(await db.sites.query({ where: { name: "Should Rollback Site" } })).toHaveLength(0);
    expect(await db.rateCardLineages.query({ where: { name: "Should Rollback Rates" } })).toHaveLength(0);
    expect(await db.engagements.query({ where: { driverId: "person-demo", startDate: "2099-01-01" } })).toHaveLength(0);
  });
});

describe("driverService — createDriver", () => {
  it("property 1: creates the correct Person + workspace-scoped DriverProfile + driver Membership", async () => {
    const { db } = await createTestDb();
    const { personId, driverProfileId, membershipId } = await createDriver(
      { workspaceId: "workspace-demo-agency", firstName: "Test", lastName: "Driver", email: "test@example.com" },
      db
    );

    const person = await db.people.getById(personId);
    expect(person.firstName).toBe("Test");
    expect(person.lastName).toBe("Driver");
    expect(person.email).toBe("test@example.com");
    expect(person.archivedAt).toBeNull();

    const driverProfile = await db.driverProfiles.getById(driverProfileId);
    expect(driverProfile.personId).toBe(personId);
    expect(driverProfile.workspaceId).toBe("workspace-demo-agency");
    expect(driverProfile.archivedAt).toBeNull();

    const membership = await db.memberships.getById(membershipId);
    expect(membership.personId).toBe(personId);
    expect(membership.workspaceId).toBe("workspace-demo-agency");
    expect(membership.roles).toEqual(["driver"]);
  });

  it("property 2: creation is workspace-scoped — a driver created in one workspace doesn't appear in another's list", async () => {
    const { db } = await createTestDb();
    await createDriver({ workspaceId: "workspace-demo-agency", firstName: "Demo", lastName: "Driver" }, db);
    const otherOrg = await createOrganisation({ workspaceId: "workspace-personal-demo", legalName: "X", tradingName: "X", types: ["other"] }, db);
    void otherOrg;

    const demoDrivers = await listDriversForWorkspace("workspace-demo-agency", db);
    const personalDrivers = await listDriversForWorkspace("workspace-personal-demo", db);
    expect(demoDrivers.some((d) => d.person.firstName === "Demo")).toBe(true);
    expect(personalDrivers.some((d) => d.person.firstName === "Demo")).toBe(false);
  });

  it("property 3: exactly one Person and one DriverProfile are created — no duplicates", async () => {
    const { db } = await createTestDb();
    await createDriver({ workspaceId: "workspace-demo-agency", firstName: "Solo", lastName: "Driver" }, db);

    const people = await db.people.query({ where: { firstName: "Solo" } });
    expect(people).toHaveLength(1);
    const profiles = await db.driverProfiles.query({ where: { personId: people[0].id } });
    expect(profiles).toHaveLength(1);
    const memberships = await db.memberships.query({ where: { personId: people[0].id } });
    expect(memberships).toHaveLength(1);
  });

  it("rejects creation with a missing first or last name", async () => {
    const { db } = await createTestDb();
    await expect(createDriver({ workspaceId: "workspace-demo-agency", firstName: "", lastName: "X" }, db)).rejects.toThrow();
    await expect(createDriver({ workspaceId: "workspace-demo-agency", firstName: "X", lastName: "" }, db)).rejects.toThrow();
  });

  it("property 16: a failed multi-record creation leaves no half-created driver behind (compensating rollback)", async () => {
    const { db } = await createTestDb();

    // Wrap the real db so the driverProfiles write fails partway through
    // the batch -- mirrors migration 003's restart-safety test pattern.
    // db.insertAtomic's localStorage-backend implementation compensates
    // by removing everything already written in the SAME batch when a
    // later write throws (see storage/db.js's documented, weaker-than-
    // IndexedDB guarantee for this test double).
    const flakyDb = {
      ...db,
      driverProfiles: {
        ...db.driverProfiles,
        insert: async () => {
          throw new Error("simulated write failure");
        },
      },
    };

    await expect(
      createDriver({ workspaceId: "workspace-demo-agency", firstName: "Half", lastName: "Created" }, flakyDb)
    ).rejects.toThrow("simulated write failure");

    // The Person insert was part of the SAME atomic batch as the
    // failing DriverProfile insert -- it must not have survived either,
    // and no Membership was created for it.
    expect(await db.people.query({ where: { firstName: "Half" } })).toHaveLength(0);
    const membershipsAfter = await db.memberships.query({ where: { workspaceId: "workspace-demo-agency" } });
    expect(membershipsAfter.every((m) => m.personId !== "person-atomic-test")).toBe(true);
  });
});

describe("driverService — getDriver / updateDriver", () => {
  it("property 4: editing Person preserves IDs and relationships, never recreates DriverProfile", async () => {
    const { db } = await createTestDb();
    const { personId, driverProfileId } = await createDriver(
      { workspaceId: "workspace-demo-agency", firstName: "Before", lastName: "Name", referenceNumber: "REF-1" },
      db
    );

    await updateDriver(
      "workspace-demo-agency",
      personId,
      { person: { firstName: "After", lastName: "Name" } },
      db
    );

    const person = await db.people.getById(personId);
    expect(person.id).toBe(personId);
    expect(person.firstName).toBe("After");

    const profiles = await db.driverProfiles.query({ where: { personId } });
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe(driverProfileId);
    expect(profiles[0].referenceNumber).toBe("REF-1"); // untouched by the Person-only edit
  });

  it("editing DriverProfile fields never creates a second Person", async () => {
    const { db } = await createTestDb();
    const { personId } = await createDriver({ workspaceId: "workspace-demo-agency", firstName: "A", lastName: "B" }, db);

    await updateDriver("workspace-demo-agency", personId, { driverProfile: { referenceNumber: "REF-2" } }, db);

    expect(await db.people.query({ where: { firstName: "A" } })).toHaveLength(1);
    const profiles = await db.driverProfiles.query({ where: { personId } });
    expect(profiles).toHaveLength(1);
    expect(profiles[0].referenceNumber).toBe("REF-2");
  });

  it("property 8: another workspace cannot manage the driver (getDriver/updateDriver/archiveDriver all scoped)", async () => {
    const { db } = await createTestDb();
    const { personId } = await createDriver({ workspaceId: "workspace-demo-agency", firstName: "Scoped", lastName: "Driver" }, db);

    expect(await getDriver("workspace-personal-demo", personId, db)).toBeNull();
    await expect(updateDriver("workspace-personal-demo", personId, { person: { firstName: "Hacked" } }, db)).rejects.toThrow();
    expect((await db.people.getById(personId)).firstName).toBe("Scoped"); // unchanged

    // archiveDriver/restoreDriver lazily upsert scoped to workspaceId --
    // calling from the wrong workspace creates a profile for THAT
    // workspace, never touches the real one.
    await archiveDriver("workspace-personal-demo", personId, db);
    const realProfile = (await db.driverProfiles.query({ where: { personId, workspaceId: "workspace-demo-agency" } }))[0];
    expect(realProfile.archivedAt).toBeNull();
  });
});

describe("driverService — archive / restore", () => {
  it("property 5 & 7: archive removes the driver from active selection; restore returns it", async () => {
    const { db } = await createTestDb();
    const { personId } = await createDriver({ workspaceId: "workspace-demo-agency", firstName: "Archivable", lastName: "Driver" }, db);

    let driver = (await listDriversForWorkspace("workspace-demo-agency", db)).find((d) => d.person.id === personId);
    expect(driver.driverProfile.archivedAt).toBeNull();

    await archiveDriver("workspace-demo-agency", personId, db);
    driver = (await listDriversForWorkspace("workspace-demo-agency", db)).find((d) => d.person.id === personId);
    expect(driver.driverProfile.archivedAt).toBeTruthy();

    await restoreDriver("workspace-demo-agency", personId, db);
    driver = (await listDriversForWorkspace("workspace-demo-agency", db)).find((d) => d.person.id === personId);
    expect(driver.driverProfile.archivedAt).toBeNull();
  });

  it("archiveDriver lazily creates a DriverProfile if none exists yet for this workspace (e.g. Alex at Apex Driving)", async () => {
    const { db } = await createTestDb();
    // Alex's real DriverProfile is scoped to his PERSONAL workspace
    // (migration007) -- he has none for Apex Driving yet.
    expect(await db.driverProfiles.query({ where: { personId: "person-demo", workspaceId: "workspace-demo-agency" } })).toHaveLength(0);

    await archiveDriver("workspace-demo-agency", "person-demo", db);

    const profiles = await db.driverProfiles.query({ where: { personId: "person-demo", workspaceId: "workspace-demo-agency" } });
    expect(profiles).toHaveLength(1);
    expect(profiles[0].archivedAt).toBeTruthy();
    // His personal-workspace profile is completely untouched.
    const personalProfile = (await db.driverProfiles.query({ where: { personId: "person-demo", workspaceId: "workspace-personal-demo" } }))[0];
    expect(personalProfile.archivedAt).toBeNull();
  });

  it("property 6: archiving a driver does not remove historical Shift access — DriverDrilldown-style queries still resolve them", async () => {
    const { db } = await createTestDb();
    const { personId } = await createDriver({ workspaceId: "workspace-demo-agency", firstName: "History", lastName: "Preserved" }, db);
    const shift = await createShift(
      { workspaceId: "workspace-demo-agency", driverId: personId, assignmentId: null, date: "2099-01-01", start: "08:00", end: "12:00", breakMinutes: 0, drivingHours: 4 },
      db
    );

    await archiveDriver("workspace-demo-agency", personId, db);

    // Person still resolves, Shift still resolves, driverId is unchanged.
    expect(await db.people.getById(personId)).toBeTruthy();
    const shiftAfter = await db.shifts.getById(shift.id);
    expect(shiftAfter.driverId).toBe(personId);
    const driverShifts = await db.shifts.query({ where: { driverId: personId } });
    expect(driverShifts).toHaveLength(1);
  });
});

describe("driverService — recordLastUsedAssignment (Stage 4E)", () => {
  it("sets lastUsedAssignmentId on this workspace's DriverProfile, lazily creating it if none exists yet", async () => {
    const { db } = await createTestDb();
    const { personId } = await createDriver({ workspaceId: "workspace-demo-agency", firstName: "Pick", lastName: "Er" }, db);

    await recordLastUsedAssignment("workspace-demo-agency", personId, "assignment-xyz", db);

    const profile = (await db.driverProfiles.query({ where: { personId, workspaceId: "workspace-demo-agency" } }))[0];
    expect(profile.lastUsedAssignmentId).toBe("assignment-xyz");
  });

  it("overwrites a previously recorded assignment rather than accumulating", async () => {
    const { db } = await createTestDb();
    const { personId } = await createDriver({ workspaceId: "workspace-demo-agency", firstName: "Pick", lastName: "Er" }, db);

    await recordLastUsedAssignment("workspace-demo-agency", personId, "assignment-one", db);
    await recordLastUsedAssignment("workspace-demo-agency", personId, "assignment-two", db);

    const profile = (await db.driverProfiles.query({ where: { personId, workspaceId: "workspace-demo-agency" } }))[0];
    expect(profile.lastUsedAssignmentId).toBe("assignment-two");
  });

  it("no-ops on a null assignmentId — an unassigned shift must not blank out an existing default", async () => {
    const { db } = await createTestDb();
    const { personId } = await createDriver({ workspaceId: "workspace-demo-agency", firstName: "Pick", lastName: "Er" }, db);
    await recordLastUsedAssignment("workspace-demo-agency", personId, "assignment-keep-me", db);

    await recordLastUsedAssignment("workspace-demo-agency", personId, null, db);

    const profile = (await db.driverProfiles.query({ where: { personId, workspaceId: "workspace-demo-agency" } }))[0];
    expect(profile.lastUsedAssignmentId).toBe("assignment-keep-me");
  });

  it("is scoped per workspace — recording it for one workspace never touches the driver's DriverProfile in another", async () => {
    const { db } = await createTestDb();

    await recordLastUsedAssignment("workspace-demo-agency", "person-demo", "assignment-demo-agency-side", db);

    const demoProfile = (
      await db.driverProfiles.query({ where: { personId: "person-demo", workspaceId: "workspace-demo-agency" } })
    )[0];
    expect(demoProfile.lastUsedAssignmentId).toBe("assignment-demo-agency-side");

    const personalProfile = (
      await db.driverProfiles.query({ where: { personId: "person-demo", workspaceId: "workspace-personal-demo" } })
    )[0];
    expect(personalProfile.lastUsedAssignmentId).toBeNull();
  });
});

describe("driverService — setPreferredAssignment (Workplaces feature)", () => {
  it("sets preferredAssignmentId, independent of lastUsedAssignmentId", async () => {
    const { db } = await createTestDb();
    const { personId } = await createDriver({ workspaceId: "workspace-demo-agency", firstName: "Pick", lastName: "Er" }, db);

    await recordLastUsedAssignment("workspace-demo-agency", personId, "assignment-last-used", db);
    await setPreferredAssignment("workspace-demo-agency", personId, "assignment-preferred", db);

    const profile = (await db.driverProfiles.query({ where: { personId, workspaceId: "workspace-demo-agency" } }))[0];
    expect(profile.preferredAssignmentId).toBe("assignment-preferred");
    expect(profile.lastUsedAssignmentId).toBe("assignment-last-used"); // untouched by setPreferredAssignment
  });

  it("a later recordLastUsedAssignment call never overwrites preferredAssignmentId", async () => {
    const { db } = await createTestDb();
    const { personId } = await createDriver({ workspaceId: "workspace-demo-agency", firstName: "Pick", lastName: "Er" }, db);

    await setPreferredAssignment("workspace-demo-agency", personId, "assignment-preferred", db);
    await recordLastUsedAssignment("workspace-demo-agency", personId, "assignment-something-else", db);

    const profile = (await db.driverProfiles.query({ where: { personId, workspaceId: "workspace-demo-agency" } }))[0];
    expect(profile.preferredAssignmentId).toBe("assignment-preferred");
    expect(profile.lastUsedAssignmentId).toBe("assignment-something-else");
  });

  it("an explicit null clears the preference (unlike recordLastUsedAssignment's no-op on null)", async () => {
    const { db } = await createTestDb();
    const { personId } = await createDriver({ workspaceId: "workspace-demo-agency", firstName: "Pick", lastName: "Er" }, db);
    await setPreferredAssignment("workspace-demo-agency", personId, "assignment-preferred", db);

    await setPreferredAssignment("workspace-demo-agency", personId, null, db);

    const profile = (await db.driverProfiles.query({ where: { personId, workspaceId: "workspace-demo-agency" } }))[0];
    expect(profile.preferredAssignmentId).toBeNull();
  });

  it("is scoped per workspace, lazily creating the DriverProfile if none exists yet", async () => {
    const { db } = await createTestDb();
    expect(await db.driverProfiles.query({ where: { personId: "person-demo", workspaceId: "workspace-demo-agency" } })).toHaveLength(0);

    await setPreferredAssignment("workspace-demo-agency", "person-demo", "assignment-demo-side", db);

    const demoProfile = (
      await db.driverProfiles.query({ where: { personId: "person-demo", workspaceId: "workspace-demo-agency" } })
    )[0];
    expect(demoProfile.preferredAssignmentId).toBe("assignment-demo-side");
    const personalProfile = (
      await db.driverProfiles.query({ where: { personId: "person-demo", workspaceId: "workspace-personal-demo" } })
    )[0];
    expect(personalProfile.preferredAssignmentId).toBeNull();
  });
});

describe("driverService — resolvePersonDisplayName", () => {
  it("prefers displayName, then firstName+lastName, then legacy name, then empty string", () => {
    expect(resolvePersonDisplayName({ displayName: "Nickname", firstName: "A", lastName: "B", name: "C" })).toBe("Nickname");
    expect(resolvePersonDisplayName({ firstName: "A", lastName: "B", name: "C" })).toBe("A B");
    expect(resolvePersonDisplayName({ name: "Legacy Name" })).toBe("Legacy Name");
    expect(resolvePersonDisplayName({})).toBe("");
    expect(resolvePersonDisplayName(null)).toBe("");
  });
});

describe("driverService — demo data isolation (property 17)", () => {
  it("seedSecondCompany's demo drivers never appear in Alex's real workspaces, and vice versa", async () => {
    const { db } = await createTestDb();
    const seed = await seedSecondCompany(db);

    const demoDrivers = await listDriversForWorkspace("workspace-demo-agency", db);
    expect(demoDrivers.some((d) => seed.drivers.some((sd) => sd.personId === d.person.id))).toBe(false);

    const demoCompanyDrivers = await listDriversForWorkspace(seed.companyWorkspaceId, db);
    expect(demoCompanyDrivers.some((d) => d.person.id === "person-demo")).toBe(false);

    // Archiving a real demo driver never touches Alex's own DriverProfile.
    await archiveDriver(seed.companyWorkspaceId, seed.drivers[0].personId, db);
    const demoProfile = (await db.driverProfiles.query({ where: { personId: "person-demo" } }))[0];
    expect(demoProfile.archivedAt).toBeNull();
  });
});

describe("driverService — historical pay stability (property 13)", () => {
  it("archiving a driver never changes an already-pinned Shift's computed pay", async () => {
    const { db } = await createTestDb();

    const shift = await createShift(
      { workspaceId: "workspace-demo-agency", driverId: "person-demo", assignmentId: "assignment-demo-agency-client", date: "2099-02-01", start: "08:00", end: "16:00", breakMinutes: 45, drivingHours: 6 },
      db
    );
    const rateCard = await db.rateCards.getById(shift.rateCardId);
    const payBefore = computeShiftBreakdown(shift, rateCard);

    await archiveDriver("workspace-demo-agency", "person-demo", db);
    await updateDriver("workspace-demo-agency", "person-demo", { person: { firstName: "Renamed" } }, db);

    const shiftAfter = await db.shifts.getById(shift.id);
    const rateCardAfter = await db.rateCards.getById(shiftAfter.rateCardId);
    const payAfter = computeShiftBreakdown(shiftAfter, rateCardAfter);
    expect(payAfter).toEqual(payBefore);
    expect(shiftAfter.rateCardId).toBe(shift.rateCardId);
    expect(shiftAfter.driverId).toBe("person-demo"); // property 12: driver reference survives
  });
});

describe("driverService — ensurePersonalWorkspace", () => {
  it("provisions a personal Workspace + Membership + DriverProfile for a person with none yet", async () => {
    const { db } = await createTestDb();
    const person = { id: "person-new-registration", firstName: "Janek", lastName: "Nowak", displayName: null, email: null, archivedAt: null, createdAt: "2026-08-04T00:00:00.000Z" };
    await db.people.insert(person);

    const workspaceId = await ensurePersonalWorkspace(person, db);
    expect(workspaceId).toBeTruthy();

    const workspace = await db.workspaces.getById(workspaceId);
    expect(workspace.kind).toBe("personal");
    expect(workspace.ownerPersonId).toBe(person.id);

    const membership = (await db.memberships.query({ where: { personId: person.id, workspaceId } }))[0];
    expect(membership.roles).toEqual(["driver", "owner"]);

    const driverProfile = (await db.driverProfiles.query({ where: { personId: person.id, workspaceId } }))[0];
    expect(driverProfile.defaultBreakMinutes).toBe(45);
    expect(driverProfile.archivedAt).toBeNull();
  });

  it("is a no-op for a person who already has a personal workspace (Alex's seeded data)", async () => {
    const { db } = await createTestDb();
    const person = await db.people.getById("person-demo");

    const result = await ensurePersonalWorkspace(person, db);
    expect(result).toBeNull();

    const memberships = await db.memberships.query({ where: { personId: "person-demo" } });
    const personalMemberships = memberships.filter((m) => m.workspaceId === "workspace-personal-demo");
    expect(personalMemberships).toHaveLength(1);
  });
});
