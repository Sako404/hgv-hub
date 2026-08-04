import { newId } from "../domain/ids.js";

function isValidDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * Normal-path lookup only — every Shift has its exact `rateCardId`
 * pinned at creation/context-change time (see shiftService.js). There
 * is deliberately NO live-assignment-chain fallback here; that exists
 * exactly once, inside the one-time backfill migration
 * (004_backfill_rate_card_versioning.js), for shifts that predate
 * pinning. Historical pay must never depend on resolving the
 * currently active assignment/rate.
 * @param {import('../domain/types.js').Shift} shift
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 * @returns {Promise<import('../domain/types.js').RateCard|null>}
 */
export async function resolveRateCardForShift(shift, db) {
  return shift.rateCardId ? (await db.rateCards.getById(shift.rateCardId)) ?? null : null;
}

/**
 * Pure resolver, never writes: the RateCard version effective on
 * `asOfDate` within `lineageId` — the latest version whose
 * effectiveFrom is <= asOfDate. Used to PIN a Shift's exact
 * `rateCardId` at creation/context-change time (shiftService.js), and
 * to show "the currently effective rate" for an active assignment.
 *
 * The returned object has the lineage's `payType` denormalized onto
 * it — `RateCard` rows themselves carry no `payType` field (it lives
 * only on `RateCardLineage`, see types.js), but every caller that
 * needs to price a shift (payEngine.computeShiftBreakdown) or decide
 * which Add Shift UI to render needs it right alongside the rates, so
 * it's joined in here once rather than at every call site.
 * @param {string} lineageId
 * @param {string} asOfDate - "YYYY-MM-DD"
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 * @returns {Promise<(import('../domain/types.js').RateCard & {payType: import('../domain/types.js').PayType})|null>}
 */
export async function resolveEffectiveRateCard(lineageId, asOfDate, db) {
  if (!lineageId) return null;
  const versions = await db.rateCards.query({ where: { lineageId } });
  const effective = versions
    .filter((v) => v.effectiveFrom <= asOfDate)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
  if (!effective) return null;
  const lineage = await db.rateCardLineages.getById(lineageId);
  return { ...effective, payType: lineage?.payType ?? "hourly" };
}

/**
 * Resolves the exact RateCard version that should price a shift given
 * its assignment and date. Used to pin Shift.rateCardId at creation or
 * on a context-changing edit — never for live/render-time lookup of an
 * already-pinned historical Shift (see resolveRateCardForShift).
 * Resolves the rate lineage via the assignment's shared Placement
 * (Stage 4D) — an Assignment no longer carries rateCardLineageId
 * directly.
 * @param {string|null} assignmentId
 * @param {string} date
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 * @returns {Promise<string|null>}
 */
export async function resolveRateCardIdForContext(assignmentId, date, db) {
  if (!assignmentId) return null;
  const assignment = await db.assignments.getById(assignmentId);
  if (!assignment?.placementId) return null;
  const placement = await db.placements.getById(assignment.placementId);
  if (!placement?.rateCardLineageId) return null;
  const rateCard = await resolveEffectiveRateCard(placement.rateCardLineageId, date, db);
  return rateCard?.id ?? null;
}

/**
 * Batch-resolves every RateCard needed to price a set of already-
 * pinned shifts, then returns a plain synchronous lookup function.
 * Lets screens render a shift breakdown per row via
 * computeShiftBreakdown without an async call per row. Same `payType`
 * denormalization as resolveEffectiveRateCard, batched here instead
 * of per-row.
 * @param {import('../domain/types.js').Shift[]} shifts
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 * @returns {Promise<(shift: import('../domain/types.js').Shift) => (import('../domain/types.js').RateCard & {payType: import('../domain/types.js').PayType})|null>}
 */
export async function buildRateCardResolver(shifts, db) {
  const rateCardIds = [...new Set(shifts.map((s) => s.rateCardId).filter(Boolean))];
  const rateCards = (await Promise.all(rateCardIds.map((id) => db.rateCards.getById(id)))).filter(Boolean);
  const lineageIds = [...new Set(rateCards.map((r) => r.lineageId))];
  const lineages = (await Promise.all(lineageIds.map((id) => db.rateCardLineages.getById(id)))).filter(Boolean);
  const lineageById = new Map(lineages.map((l) => [l.id, l]));
  const rateCardById = new Map(
    rateCards.map((r) => [r.id, { ...r, payType: lineageById.get(r.lineageId)?.payType ?? "hourly" }])
  );
  return (shift) => (shift.rateCardId ? rateCardById.get(shift.rateCardId) ?? null : null);
}

/**
 * Starts a brand-new RateCard lineage (version 1) — creates both the
 * RateCardLineage metadata row (name/archived/payType, mutable except
 * payType — see the PayType typedef) and the first immutable RateCard
 * version. The write entry point for "this workspace now has a new
 * rate scheme" — UI/service code must never call
 * db.rateCards.insert()/update() directly for pricing content; only
 * createRateCard/reviseRateCard mutate rates.
 *
 * `payType` defaults to 'hourly' (the only kind that existed before
 * Per-Load Pay) when omitted, so every pre-existing caller keeps
 * working unchanged. A 'per_load' lineage's `rates` is forced to `{}`
 * regardless of what's passed — there is nothing to configure at the
 * rate-card level for per-load pay (see the architecture proposal
 * §2.2); the caller's `rates` argument is simply ignored in that case
 * rather than trusted to already be empty.
 * @param {{workspaceId: string, name: string, effectiveFrom: string, rates: object, payType?: import('../domain/types.js').PayType}} input
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function createRateCard(input, db) {
  if (!isValidDateString(input.effectiveFrom)) throw new Error("Invalid effectiveFrom");
  const payType = input.payType ?? "hourly";
  const id = newId("ratecard");
  const now = new Date().toISOString();
  await db.rateCardLineages.insert({
    id,
    workspaceId: input.workspaceId,
    name: input.name,
    payType,
    archivedAt: null,
    createdAt: now,
  });
  return db.rateCards.insert({
    id,
    workspaceId: input.workspaceId,
    lineageId: id,
    version: 1,
    supersedesId: null,
    effectiveFrom: input.effectiveFrom,
    rates: payType === "per_load" ? {} : input.rates,
  });
}

/**
 * Appends a new version to an existing lineage — purely append-only,
 * the version it supersedes is never touched. `effectiveFrom` must
 * move strictly forward: it cannot duplicate or predate the lineage's
 * latest existing version, keeping the version history unambiguously
 * ordered. Correcting a wrongly-entered HISTORICAL rate is a separate,
 * explicitly audited operation to design later — not this function.
 * Renaming a lineage is a separate, unrelated operation (see
 * renameRateCardLineage) — this function only ever changes rates.
 * `rates` is forced to `{}` when the lineage's own `payType` is
 * 'per_load' (looked up here, never passed in — payType is locked
 * per lineage, this function has no way to change it).
 * @param {string} lineageId
 * @param {{effectiveFrom: string, rates: object}} input
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function reviseRateCard(lineageId, input, db) {
  if (!isValidDateString(input.effectiveFrom)) throw new Error("Invalid effectiveFrom");
  const [versions, lineage] = await Promise.all([
    db.rateCards.query({ where: { lineageId } }),
    db.rateCardLineages.getById(lineageId),
  ]);
  if (versions.length === 0) throw new Error(`No existing RateCard lineage: ${lineageId}`);
  const latest = versions.reduce((a, b) => (a.effectiveFrom > b.effectiveFrom ? a : b));
  if (input.effectiveFrom <= latest.effectiveFrom) {
    throw new Error(
      "effectiveFrom must be after the lineage's latest existing version — use a dedicated historical-correction operation for backdated fixes, not reviseRateCard()"
    );
  }
  return db.rateCards.insert({
    id: newId("ratecard"),
    workspaceId: latest.workspaceId,
    lineageId,
    version: latest.version + 1,
    supersedesId: latest.id,
    effectiveFrom: input.effectiveFrom,
    rates: lineage?.payType === "per_load" ? {} : input.rates,
  });
}

/**
 * Every RateCardLineage for a workspace, each paired with its current
 * (latest-effective) version and total version count — everything the
 * list screen needs in one call, without an N+1 fetch per lineage.
 * @param {string} workspaceId
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 * @returns {Promise<{lineage: import('../domain/types.js').RateCardLineage, currentVersion: import('../domain/types.js').RateCard|null, versionCount: number}[]>}
 */
export async function listRateCardLineagesForWorkspace(workspaceId, db) {
  const [lineages, allVersions] = await Promise.all([
    db.rateCardLineages.query({ where: { workspaceId } }),
    db.rateCards.query({ where: { workspaceId } }),
  ]);
  const versionsByLineage = new Map();
  for (const version of allVersions) {
    const versions = versionsByLineage.get(version.lineageId) ?? [];
    versions.push(version);
    versionsByLineage.set(version.lineageId, versions);
  }
  return lineages.map((lineage) => {
    const versions = (versionsByLineage.get(lineage.id) ?? []).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
    return { lineage, currentVersion: versions[0] ?? null, versionCount: versions.length };
  });
}

/**
 * Full detail for one lineage: the lineage metadata plus every version,
 * newest first — for the "Current rate" / "Previous rates" detail screen.
 * @param {string} lineageId
 * @param {ReturnType<typeof import('../storage/db.js').createDb>} db
 */
export async function getRateCardLineageSummary(lineageId, db) {
  const [lineage, versions] = await Promise.all([
    db.rateCardLineages.getById(lineageId),
    db.rateCards.query({ where: { lineageId } }),
  ]);
  if (!lineage) return null;
  const sortedVersions = [...versions].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return { lineage, versions: sortedVersions, currentVersion: sortedVersions[0] ?? null };
}

/**
 * Renames the lineage's display label — metadata only, never touches
 * rate history. A separate, unrelated operation from reviseRateCard().
 */
export async function renameRateCardLineage(lineageId, name, db) {
  if (!name || !name.trim()) throw new Error("Name is required");
  return db.rateCardLineages.update(lineageId, { name });
}

/**
 * Hides the lineage from future selection (e.g. an Assignment's rate
 * picker) without touching any version row or any Shift/Assignment that
 * already references it — archiving is purely a "don't offer this for
 * new work" signal, never a historical-integrity concern.
 */
export async function archiveRateCardLineage(lineageId, db) {
  return db.rateCardLineages.update(lineageId, { archivedAt: new Date().toISOString() });
}

export async function restoreRateCardLineage(lineageId, db) {
  return db.rateCardLineages.update(lineageId, { archivedAt: null });
}
