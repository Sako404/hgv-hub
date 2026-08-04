import { newId } from "../domain/ids.js";

/** @param {string} workspaceId */
export async function listOrganisationsForWorkspace(workspaceId, db) {
  return db.organisations.query({ where: { workspaceId } });
}

/**
 * @param {{workspaceId: string, legalName: string, tradingName: string, types: import('../domain/types.js').OrganisationType[]}} input
 */
export async function createOrganisation(input, db) {
  if (!input.types || input.types.length === 0) {
    throw new Error("Organisation must have at least one type");
  }
  return db.organisations.insert({
    id: newId("org"),
    workspaceId: input.workspaceId,
    legalName: input.legalName,
    tradingName: input.tradingName,
    types: input.types,
    archivedAt: null,
  });
}

/** legalName/tradingName/types only — workspaceId is immutable once created. */
export async function updateOrganisation(id, patch, db) {
  if ("types" in patch && (!patch.types || patch.types.length === 0)) {
    throw new Error("Organisation must have at least one type");
  }
  return db.organisations.update(id, patch);
}

export async function archiveOrganisation(id, db) {
  return db.organisations.update(id, { archivedAt: new Date().toISOString() });
}

export async function restoreOrganisation(id, db) {
  return db.organisations.update(id, { archivedAt: null });
}
