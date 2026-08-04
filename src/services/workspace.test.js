import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import { newId } from "../domain/ids.js";
import { resolveSession } from "./workspaceService.js";

describe("workspaceService — solo driver and company membership", () => {
  it("property 1: a solo driver can use the system without belonging to a company", async () => {
    // Migration always gives Alex a personal workspace + a Example Driver Agency
    // membership; simulate a *true* solo driver by building a fresh person
    // with only a personal workspace.
    const { db } = await createTestDb();
    const personId = newId("person");
    await db.people.insert({ id: personId, name: "Solo Driver", email: null, createdAt: "now" });
    const workspaceId = newId("workspace");
    await db.workspaces.insert({ id: workspaceId, kind: "personal", name: "Solo — Personal", ownerPersonId: personId, createdAt: "now" });
    await db.memberships.insert({ id: newId("membership"), workspaceId, personId, roles: ["driver", "owner"], createdAt: "now" });

    const session = await resolveSession(personId, db);
    expect(session.personalWorkspace.id).toBe(workspaceId);
    expect(session.orgMemberships).toHaveLength(0);
    expect(session.needsSwitcher).toBe(false);
  });

  it("property 2: a driver can belong to a company workspace", async () => {
    const { db } = await createTestDb();
    // Alex (from migration) already has a driver membership in the
    // Example Driver Agency agency workspace alongside his personal one.
    const session = await resolveSession("person-demo", db);
    expect(session.personalWorkspace).toBeTruthy();
    expect(session.orgMemberships.length).toBeGreaterThanOrEqual(1);
    expect(session.orgMemberships[0].workspace.kind).toBe("agency");
  });

  it("driver-only company membership does not trigger the workspace switcher", async () => {
    const { db } = await createTestDb();
    const session = await resolveSession("person-demo", db);
    // Alex's Example Driver Agency role is "driver" only, no manager-tier role.
    expect(session.needsSwitcher).toBe(false);
  });

  it("a manager-tier role does trigger the workspace switcher", async () => {
    const { db } = await createTestDb();
    const ownerId = newId("person");
    await db.people.insert({ id: ownerId, name: "Owner", email: null, createdAt: "now" });
    const workspaceId = newId("workspace");
    await db.workspaces.insert({ id: workspaceId, kind: "transport_company", name: "Some Co", ownerPersonId: null, createdAt: "now" });
    await db.memberships.insert({ id: newId("membership"), workspaceId, personId: ownerId, roles: ["owner"], createdAt: "now" });

    const session = await resolveSession(ownerId, db);
    expect(session.needsSwitcher).toBe(true);
  });

  it("property 10: personal and company workspace data are distinguishable", async () => {
    const { db } = await createTestDb();
    const personalKinds = await db.workspaces.query({ where: { kind: "personal" } });
    const orgKinds = await db.workspaces.query({ where: { kind: { in: ["agency", "transport_company"] } } });
    expect(personalKinds.length).toBeGreaterThan(0);
    expect(orgKinds.length).toBeGreaterThan(0);
    const personalIds = new Set(personalKinds.map((w) => w.id));
    const orgIds = new Set(orgKinds.map((w) => w.id));
    for (const id of personalIds) expect(orgIds.has(id)).toBe(false);
  });
});
