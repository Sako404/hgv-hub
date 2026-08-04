import { newId } from "../domain/ids.js";

/**
 * Data-correctness fixes, run after migration 005's schema foundation:
 *
 * 1. Backfills Engagement.employerOrganisationId from the old
 *    `organisationId` field (straight copy, old field left in place —
 *    same convention as Assignment.rateCardLineageId in migration 004).
 * 2. Corrects Sites whose `organisationId` still points at their own
 *    workspace's self-organisation even though they represent a client
 *    site (a legacy free-text `clientName`, e.g. migration 002's real
 *    Example Logistics Depot A site): creates a proper `type: 'client'`
 *    Organisation from that name and re-points the Site at it.
 *    `seedSecondCompany`'s depot site is untouched (clientName is null
 *    there — it's correctly self-owned already).
 *
 * Both steps are guarded per-row (idempotent) and only ever insert or
 * patch-update — restart-safe via the existing SCHEMA_VERSION gate.
 * @param {ReturnType<typeof import('../storage/db.js').createIndexedDbDb>} db
 */
export async function migration006FixEmployerAndClientOrganisations(db) {
  const engagements = await db.engagements.getAll();
  for (const engagement of engagements) {
    if (engagement.employerOrganisationId) continue;
    await db.engagements.update(engagement.id, { employerOrganisationId: engagement.organisationId });
  }

  const sites = await db.sites.getAll();
  for (const site of sites) {
    if (!site.clientName) continue;
    const currentOrg = await db.organisations.getById(site.organisationId);
    if (!currentOrg) continue;
    const isSelfOrg = (currentOrg.types ?? []).some((t) => t === "agency" || t === "transport_company");
    if (!isSelfOrg) continue; // already corrected on a previous (possibly interrupted) run

    const existingClientOrg = (
      await db.organisations.query({ where: { workspaceId: currentOrg.workspaceId, tradingName: site.clientName } })
    )[0];
    const clientOrg =
      existingClientOrg ??
      (await db.organisations.insert({
        id: newId("org"),
        workspaceId: currentOrg.workspaceId,
        legalName: site.clientName,
        tradingName: site.clientName,
        types: ["client"],
        archivedAt: null,
      }));
    await db.sites.update(site.id, { organisationId: clientOrg.id });
  }
}
