const SCHEMA_VERSION = 1;

/**
 * JSON bundle of everything a workspace OWNS as source of truth. Does
 * NOT include shifts a driver merely sees via a cross-workspace query —
 * only shifts whose `workspaceId` is this workspace — preserving the
 * ownership rule end to end (see docs/ARCHITECTURE.md).
 * @param {string} workspaceId
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function exportWorkspace(workspaceId, db) {
  const workspace = await db.workspaces.getById(workspaceId);
  const organisation = (await db.organisations.query({ where: { workspaceId } }))[0] ?? null;
  const engagements = await db.engagements.query({ where: { workspaceId } });
  const engagementIds = engagements.map((e) => e.id);

  const [sites, assignments, rateCards, shifts, memberships] = await Promise.all([
    organisation ? db.sites.query({ where: { organisationId: organisation.id } }) : Promise.resolve([]),
    db.assignments.query({ where: { engagementId: { in: engagementIds } } }),
    db.rateCards.query({ where: { workspaceId } }),
    db.shifts.query({ where: { workspaceId } }),
    db.memberships.query({ where: { workspaceId } }),
  ]);

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    workspace,
    organisation,
    sites,
    engagements,
    assignments,
    rateCards,
    shifts,
    memberships,
  };
}

async function upsertAll(repository, items) {
  for (const item of items ?? []) {
    const existing = await repository.getById(item.id);
    if (existing) {
      await repository.update(item.id, item);
    } else {
      await repository.insert(item);
    }
  }
}

/**
 * Upserts an exported bundle back into a db by id. Used for backup/
 * restore and for moving a workspace's data between browsers/devices.
 * @param {ReturnType<typeof exportWorkspace>} payload
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function importWorkspace(payload, db) {
  if (payload.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported export schemaVersion: ${payload.schemaVersion}`);
  }
  if (payload.workspace) await upsertAll(db.workspaces, [payload.workspace]);
  if (payload.organisation) await upsertAll(db.organisations, [payload.organisation]);
  await upsertAll(db.sites, payload.sites);
  await upsertAll(db.engagements, payload.engagements);
  await upsertAll(db.assignments, payload.assignments);
  await upsertAll(db.rateCards, payload.rateCards);
  await upsertAll(db.shifts, payload.shifts);
  await upsertAll(db.memberships, payload.memberships);
}
