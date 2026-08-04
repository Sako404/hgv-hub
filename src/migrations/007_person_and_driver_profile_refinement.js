/**
 * Additive schema refinement for Part 4 Stage 4C (People/Drivers
 * management). Every step is guarded on "does this row already have
 * the new shape" — a from-scratch retry after a partial failure is
 * harmless, same restart-safety pattern as migrations 003-006.
 *
 * Person: only `archivedAt` is backfilled. firstName/lastName/
 * displayName are deliberately left UNSET on existing rows — auto-
 * splitting the legacy `name` field (e.g. "Alex") into first/last
 * would be a lossy guess for names that aren't "first last" (single
 * names, multi-part surnames, etc). resolvePersonDisplayName()
 * (driverService.js) already falls back to the legacy `name` field, so
 * every existing person keeps displaying correctly without a guess.
 *
 * DriverProfile: `workspaceId` is backfilled to the person's own
 * personal workspace — the only unambiguous choice for a profile that
 * predates workspace-scoping (DriverProfile used to be a single global
 * row per person). This does not change what Alex's dashboard shows
 * (defaultBreakMinutes/lastUsedAssignmentId aren't read from any
 * workspace-specific context today) and does not affect any company
 * workspace's driver roster, which is Membership-based, not
 * DriverProfile-based.
 * @param {ReturnType<typeof import('../storage/db.js').createIndexedDbDb>} db
 */
export async function migration007PersonAndDriverProfileRefinement(db) {
  const people = await db.people.getAll();
  for (const person of people) {
    if ("archivedAt" in person) continue;
    await db.people.update(person.id, { archivedAt: null });
  }

  const driverProfiles = await db.driverProfiles.getAll();
  for (const driverProfile of driverProfiles) {
    if (driverProfile.workspaceId) continue;
    const personalWorkspaces = await db.workspaces.query({
      where: { kind: "personal", ownerPersonId: driverProfile.personId },
    });
    const personalWorkspace = personalWorkspaces[0];
    if (!personalWorkspace) continue; // defensive: every person is expected to have one
    await db.driverProfiles.update(driverProfile.id, {
      workspaceId: personalWorkspace.id,
      archivedAt: null,
    });
  }
}
