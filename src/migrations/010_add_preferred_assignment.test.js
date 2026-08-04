import { describe, expect, it } from "vitest";
import { createDb } from "../storage/db.js";
import { createInMemoryStorage } from "../../test/inMemoryStorage.js";
import { migration010AddPreferredAssignment } from "./010_add_preferred_assignment.js";

describe("migration 010 — preferredAssignmentId backfill", () => {
  it("backfills preferredAssignmentId: null onto an existing DriverProfile that predates it", async () => {
    const db = createDb(createInMemoryStorage());
    await db.driverProfiles.insert({
      id: "dp-1",
      personId: "person-1",
      workspaceId: "ws-1",
      referenceNumber: null,
      defaultBreakMinutes: 45,
      lastUsedAssignmentId: null,
      archivedAt: null,
      createdAt: "now",
    });

    await migration010AddPreferredAssignment(db);

    const profile = await db.driverProfiles.getById("dp-1");
    expect(profile.preferredAssignmentId).toBeNull();
  });

  it("is idempotent — a from-scratch re-run doesn't error or change an already-set value", async () => {
    const db = createDb(createInMemoryStorage());
    await db.driverProfiles.insert({
      id: "dp-1",
      personId: "person-1",
      workspaceId: "ws-1",
      referenceNumber: null,
      defaultBreakMinutes: 45,
      lastUsedAssignmentId: null,
      preferredAssignmentId: "assignment-already-chosen",
      archivedAt: null,
      createdAt: "now",
    });

    await migration010AddPreferredAssignment(db);
    await migration010AddPreferredAssignment(db);

    const profile = await db.driverProfiles.getById("dp-1");
    expect(profile.preferredAssignmentId).toBe("assignment-already-chosen");
  });
});
