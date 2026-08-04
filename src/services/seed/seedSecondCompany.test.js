import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../test/testDb.js";
import { seedSecondCompany } from "./seedSecondCompany.js";
import { resolveSession } from "../workspaceService.js";

const DEMO_PERSON_ID = "person-demo";

describe("seedSecondCompany — grantAccessToPersonId", () => {
  it("a. seeding without grantAccessToPersonId creates no membership for that person", async () => {
    const { db } = await createTestDb();
    const seed = await seedSecondCompany(db);
    const memberships = await db.memberships.query({
      where: { workspaceId: seed.companyWorkspaceId, personId: DEMO_PERSON_ID },
    });
    expect(memberships).toHaveLength(0);
  });

  it("b/c. calling seed again later with grantAccessToPersonId creates the membership on the already-seeded path", async () => {
    const { db } = await createTestDb();
    const seed = await seedSecondCompany(db);

    // Second call, company already exists (idempotent path) -- this is
    // exactly the bug scenario: grant requested after the org was
    // already seeded by an earlier call with no grant.
    const seedAgain = await seedSecondCompany(db, { grantAccessToPersonId: DEMO_PERSON_ID });
    expect(seedAgain.workspaceId).toBe(seed.companyWorkspaceId);

    const memberships = await db.memberships.query({
      where: { workspaceId: seed.companyWorkspaceId, personId: DEMO_PERSON_ID },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].roles).toContain("owner");
  });

  it("d. repeated calls with grantAccessToPersonId create exactly one membership, never a duplicate", async () => {
    const { db } = await createTestDb();
    const seed = await seedSecondCompany(db, { grantAccessToPersonId: DEMO_PERSON_ID });
    await seedSecondCompany(db, { grantAccessToPersonId: DEMO_PERSON_ID });
    await seedSecondCompany(db, { grantAccessToPersonId: DEMO_PERSON_ID });

    const memberships = await db.memberships.query({
      where: { workspaceId: seed.companyWorkspaceId, personId: DEMO_PERSON_ID },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].roles).toContain("owner");
  });

  it("grant works identically on a completely fresh seed (grant passed on the first call)", async () => {
    const { db } = await createTestDb();
    const seed = await seedSecondCompany(db, { grantAccessToPersonId: DEMO_PERSON_ID });

    const memberships = await db.memberships.query({
      where: { workspaceId: seed.companyWorkspaceId, personId: DEMO_PERSON_ID },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].roles).toContain("owner");
  });

  it("self-heals a pre-existing non-managerial membership instead of leaving it stuck", async () => {
    const { db } = await createTestDb();
    const seed = await seedSecondCompany(db);
    // Simulate the old buggy behaviour's leftover row: a membership that
    // exists but carries only a non-managerial role.
    await db.memberships.insert({
      id: "membership-stale-viewer",
      workspaceId: seed.companyWorkspaceId,
      personId: DEMO_PERSON_ID,
      roles: ["viewer"],
      archivedAt: null,
      createdAt: new Date().toISOString(),
    });

    await seedSecondCompany(db, { grantAccessToPersonId: DEMO_PERSON_ID });

    const memberships = await db.memberships.query({
      where: { workspaceId: seed.companyWorkspaceId, personId: DEMO_PERSON_ID },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].roles).toEqual(expect.arrayContaining(["viewer", "owner"]));
  });

  it("e. resolveSession(person-demo) exposes the seeded company as a managerial workspace", async () => {
    const { db } = await createTestDb();
    const seed = await seedSecondCompany(db, { grantAccessToPersonId: DEMO_PERSON_ID });

    const session = await resolveSession(DEMO_PERSON_ID, db);
    expect(session.needsSwitcher).toBe(true);
    const managerialWorkspaceIds = session.managerialMemberships.map((m) => m.workspace.id);
    expect(managerialWorkspaceIds).toContain(seed.companyWorkspaceId);
  });

  it("remains idempotent for workspace/organisation/sites/drivers/assignments/rate cards across repeated calls", async () => {
    const { db } = await createTestDb();
    // Capture ids from the first (fresh-seed) call -- the idempotent-path
    // return value is the raw Organisation row (`.workspaceId`/`.id`),
    // not the fresh-seed shape (`.companyWorkspaceId`/`.orgId`); that
    // inconsistency predates and is out of scope for this fix.
    const seed = await seedSecondCompany(db);
    await seedSecondCompany(db, { grantAccessToPersonId: DEMO_PERSON_ID });
    await seedSecondCompany(db, { grantAccessToPersonId: DEMO_PERSON_ID });

    expect(await db.organisations.query({ where: { legalName: "Northline Transport Ltd" } })).toHaveLength(1);
    expect(await db.workspaces.query({ where: { id: seed.companyWorkspaceId } })).toHaveLength(1);
    expect(await db.sites.query({ where: { organisationId: seed.orgId } })).toHaveLength(1);
    const driverMemberships = (
      await db.memberships.query({ where: { workspaceId: seed.companyWorkspaceId } })
    ).filter((m) => m.roles.includes("driver"));
    expect(driverMemberships).toHaveLength(3);
    const engagements = await db.engagements.query({ where: { workspaceId: seed.companyWorkspaceId } });
    expect(engagements).toHaveLength(3);
    const engagementIds = new Set(engagements.map((e) => e.id));
    const assignments = (await db.assignments.query({})).filter((a) => engagementIds.has(a.engagementId));
    expect(assignments).toHaveLength(3);
    expect(await db.rateCards.query({ where: { workspaceId: seed.companyWorkspaceId } })).toHaveLength(1);
  });
});
