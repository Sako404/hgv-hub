export const MANAGER_ROLES = ["owner", "admin", "manager", "dispatcher", "payroll", "transport_manager"];

/**
 * @param {string} personId
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 * @returns {Promise<{workspace: import('../domain/types.js').Workspace, roles: import('../domain/types.js').Role[]}[]>}
 */
export async function listWorkspacesForPerson(personId, db) {
  const memberships = await db.memberships.query({ where: { personId } });
  const resolved = await Promise.all(
    memberships.map(async (m) => ({ workspace: await db.workspaces.getById(m.workspaceId), roles: m.roles }))
  );
  return resolved.filter((entry) => entry.workspace);
}

/**
 * Resolves what a person should see on boot. `needsSwitcher` is true only
 * if the person holds a manager-tier role somewhere — a driver-only
 * membership in an agency/company workspace does NOT trigger it, so a
 * solo driver (or a driver-only agency worker) boots straight into
 * DriverApp with zero workspace-switcher chrome.
 * @param {string} personId
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function resolveSession(personId, db) {
  const memberships = await listWorkspacesForPerson(personId, db);
  const personalWorkspace =
    memberships.find((m) => m.workspace.kind === "personal")?.workspace ?? null;
  const orgMemberships = memberships.filter((m) => m.workspace.kind !== "personal");
  const managerialMemberships = orgMemberships.filter((m) =>
    m.roles.some((r) => MANAGER_ROLES.includes(r))
  );
  return {
    personId,
    personalWorkspace,
    orgMemberships,
    managerialMemberships,
    needsSwitcher: managerialMemberships.length > 0,
  };
}
