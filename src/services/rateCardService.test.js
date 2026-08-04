import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/testDb.js";
import {
  archiveRateCardLineage,
  buildRateCardResolver,
  createRateCard,
  getRateCardLineageSummary,
  listRateCardLineagesForWorkspace,
  renameRateCardLineage,
  resolveEffectiveRateCard,
  resolveRateCardForShift,
  restoreRateCardLineage,
  reviseRateCard,
} from "./rateCardService.js";
import { createShift } from "./shiftService.js";
import { computeShiftBreakdown } from "./payEngine.js";

const RATES_V1 = { MonThu: { Days: [10, 11], Lates: [10, 11], Nights: [10, 11] }, Fri: { Days: [10, 11], Lates: [10, 11], Nights: [10, 11] }, Sat: { Days: [10, 11], Lates: [10, 11], Nights: [10, 11] }, Sun: { Days: [10, 11], Lates: [10, 11], Nights: [10, 11] } };
const RATES_V2 = { MonThu: { Days: [20, 21], Lates: [20, 21], Nights: [20, 21] }, Fri: { Days: [20, 21], Lates: [20, 21], Nights: [20, 21] }, Sat: { Days: [20, 21], Lates: [20, 21], Nights: [20, 21] }, Sun: { Days: [20, 21], Lates: [20, 21], Nights: [20, 21] } };

describe("rateCardService — append-only versioning", () => {
  it("createRateCard starts a new lineage at version 1", async () => {
    const { db } = await createTestDb();
    const rc = await createRateCard({ workspaceId: "workspace-demo-agency", name: "Test", effectiveFrom: "2026-01-01", rates: RATES_V1 }, db);
    expect(rc.lineageId).toBe(rc.id);
    expect(rc.version).toBe(1);
    expect(rc.supersedesId).toBeNull();
  });

  it("createRateCard rejects an invalid effectiveFrom", async () => {
    const { db } = await createTestDb();
    await expect(
      createRateCard({ workspaceId: "workspace-demo-agency", name: "Test", effectiveFrom: "not-a-date", rates: RATES_V1 }, db)
    ).rejects.toThrow();
  });

  it("reviseRateCard appends a new version without mutating the old one", async () => {
    const { db } = await createTestDb();
    const v1 = await createRateCard({ workspaceId: "workspace-demo-agency", name: "Test", effectiveFrom: "2026-01-01", rates: RATES_V1 }, db);
    const v2 = await reviseRateCard(v1.lineageId, { effectiveFrom: "2026-06-01", rates: RATES_V2 }, db);

    expect(v2.lineageId).toBe(v1.lineageId);
    expect(v2.version).toBe(2);
    expect(v2.supersedesId).toBe(v1.id);
    expect(v2.id).not.toBe(v1.id);

    // The old version is byte-identical — never mutated, not even to backfill an end date.
    const v1Reloaded = await db.rateCards.getById(v1.id);
    expect(v1Reloaded).toEqual(v1);
  });

  it("reviseRateCard rejects an effectiveFrom that duplicates the latest version's date", async () => {
    const { db } = await createTestDb();
    const v1 = await createRateCard({ workspaceId: "workspace-demo-agency", name: "Test", effectiveFrom: "2026-01-01", rates: RATES_V1 }, db);
    await expect(reviseRateCard(v1.lineageId, { effectiveFrom: "2026-01-01", rates: RATES_V2 }, db)).rejects.toThrow();
  });

  it("reviseRateCard rejects an effectiveFrom that predates the latest version", async () => {
    const { db } = await createTestDb();
    const v1 = await createRateCard({ workspaceId: "workspace-demo-agency", name: "Test", effectiveFrom: "2026-06-01", rates: RATES_V1 }, db);
    await expect(reviseRateCard(v1.lineageId, { effectiveFrom: "2026-01-01", rates: RATES_V2 }, db)).rejects.toThrow();
  });

  it("reviseRateCard rejects an invalid effectiveFrom", async () => {
    const { db } = await createTestDb();
    const v1 = await createRateCard({ workspaceId: "workspace-demo-agency", name: "Test", effectiveFrom: "2026-01-01", rates: RATES_V1 }, db);
    await expect(reviseRateCard(v1.lineageId, { effectiveFrom: "not-a-date", rates: RATES_V2 }, db)).rejects.toThrow();
  });

  it("resolveEffectiveRateCard picks the latest version effective on or before the given date", async () => {
    const { db } = await createTestDb();
    const v1 = await createRateCard({ workspaceId: "workspace-demo-agency", name: "Test", effectiveFrom: "2026-01-01", rates: RATES_V1 }, db);
    const v2 = await reviseRateCard(v1.lineageId, { effectiveFrom: "2026-06-01", rates: RATES_V2 }, db);

    expect((await resolveEffectiveRateCard(v1.lineageId, "2026-03-15", db)).id).toBe(v1.id);
    // Boundary: exactly on v2's effectiveFrom already uses v2.
    expect((await resolveEffectiveRateCard(v1.lineageId, "2026-06-01", db)).id).toBe(v2.id);
    expect((await resolveEffectiveRateCard(v1.lineageId, "2026-05-31", db)).id).toBe(v1.id);
    expect((await resolveEffectiveRateCard(v1.lineageId, "2026-12-31", db)).id).toBe(v2.id);
  });

  it("resolveEffectiveRateCard returns null for a date before any version existed", async () => {
    const { db } = await createTestDb();
    const v1 = await createRateCard({ workspaceId: "workspace-demo-agency", name: "Test", effectiveFrom: "2026-06-01", rates: RATES_V1 }, db);
    expect(await resolveEffectiveRateCard(v1.lineageId, "2026-01-01", db)).toBeNull();
  });

  it("resolveRateCardForShift is a pinned-id lookup only — no live resolution", async () => {
    const { db } = await createTestDb();
    const v1 = await createRateCard({ workspaceId: "workspace-demo-agency", name: "Test", effectiveFrom: "2026-01-01", rates: RATES_V1 }, db);
    await reviseRateCard(v1.lineageId, { effectiveFrom: "2026-06-01", rates: RATES_V2 }, db);

    // A shift pinned to v1 keeps resolving to v1 even though v2 is now
    // the "current" version for the lineage.
    const shift = { rateCardId: v1.id };
    expect((await resolveRateCardForShift(shift, db)).id).toBe(v1.id);
    expect(await resolveRateCardForShift({ rateCardId: null }, db)).toBeNull();
  });

  it("buildRateCardResolver resolves each shift's own pinned version, not a shared 'current' one", async () => {
    const { db } = await createTestDb();
    const v1 = await createRateCard({ workspaceId: "workspace-demo-agency", name: "Test", effectiveFrom: "2026-01-01", rates: RATES_V1 }, db);
    const v2 = await reviseRateCard(v1.lineageId, { effectiveFrom: "2026-06-01", rates: RATES_V2 }, db);

    const shifts = [{ id: "a", rateCardId: v1.id }, { id: "b", rateCardId: v2.id }];
    const resolve = await buildRateCardResolver(shifts, db);
    expect(resolve(shifts[0]).id).toBe(v1.id);
    expect(resolve(shifts[1]).id).toBe(v2.id);
  });

  it("resolveRateCardForShift's normal-path implementation contains no live-assignment fallback branch", async () => {
    const fs = await import("node:fs/promises");
    const url = new URL("./rateCardService.js", import.meta.url);
    const text = await fs.readFile(url, "utf8");
    const fnBody = text.slice(text.indexOf("export async function resolveRateCardForShift"), text.indexOf("export async function resolveEffectiveRateCard"));
    expect(fnBody).not.toMatch(/assignmentId|assignments\.getById/);
  });
});

describe("rateCardService — RateCardLineage management", () => {
  it("createRateCard also creates a RateCardLineage row, and the RateCard version carries no name", async () => {
    const { db } = await createTestDb();
    const rc = await createRateCard({ workspaceId: "workspace-demo-agency", name: "Test", effectiveFrom: "2026-01-01", rates: RATES_V1 }, db);

    const lineage = await db.rateCardLineages.getById(rc.lineageId);
    expect(lineage.name).toBe("Test");
    expect(lineage.workspaceId).toBe("workspace-demo-agency");
    expect(lineage.archivedAt).toBeNull();
    expect(rc.name).toBeUndefined();
  });

  it("listRateCardLineagesForWorkspace returns each lineage with its current version and version count", async () => {
    const { db } = await createTestDb();
    const v1 = await createRateCard({ workspaceId: "workspace-demo-agency", name: "Test Lineage", effectiveFrom: "2026-01-01", rates: RATES_V1 }, db);
    const v2 = await reviseRateCard(v1.lineageId, { effectiveFrom: "2026-06-01", rates: RATES_V2 }, db);

    const summaries = await listRateCardLineagesForWorkspace("workspace-demo-agency", db);
    const testLineageSummary = summaries.find((s) => s.lineage.id === v1.lineageId);
    expect(testLineageSummary.currentVersion.id).toBe(v2.id);
    expect(testLineageSummary.versionCount).toBe(2);
  });

  it("listRateCardLineagesForWorkspace is workspace-scoped (no cross-workspace leak)", async () => {
    const { db } = await createTestDb();
    await createRateCard({ workspaceId: "workspace-personal-demo", name: "Personal Rate", effectiveFrom: "2026-01-01", rates: RATES_V1 }, db);

    const demoSummaries = await listRateCardLineagesForWorkspace("workspace-demo-agency", db);
    expect(demoSummaries.some((s) => s.lineage.name === "Personal Rate")).toBe(false);

    const personalSummaries = await listRateCardLineagesForWorkspace("workspace-personal-demo", db);
    expect(personalSummaries.some((s) => s.lineage.name === "Personal Rate")).toBe(true);
  });

  it("getRateCardLineageSummary returns every version, newest first", async () => {
    const { db } = await createTestDb();
    const v1 = await createRateCard({ workspaceId: "workspace-demo-agency", name: "Test", effectiveFrom: "2026-01-01", rates: RATES_V1 }, db);
    const v2 = await reviseRateCard(v1.lineageId, { effectiveFrom: "2026-06-01", rates: RATES_V2 }, db);

    const summary = await getRateCardLineageSummary(v1.lineageId, db);
    expect(summary.versions.map((v) => v.id)).toEqual([v2.id, v1.id]);
    expect(summary.currentVersion.id).toBe(v2.id);
  });

  it("renameRateCardLineage changes only the lineage's name — never creates a new version or touches rates", async () => {
    const { db } = await createTestDb();
    const v1 = await createRateCard({ workspaceId: "workspace-demo-agency", name: "Old Name", effectiveFrom: "2026-01-01", rates: RATES_V1 }, db);

    await renameRateCardLineage(v1.lineageId, "New Name", db);

    expect((await db.rateCardLineages.getById(v1.lineageId)).name).toBe("New Name");
    expect(await db.rateCards.query({ where: { lineageId: v1.lineageId } })).toHaveLength(1);
    expect(await db.rateCards.getById(v1.id)).toEqual(v1);
  });

  it("renameRateCardLineage rejects an empty name", async () => {
    const { db } = await createTestDb();
    const v1 = await createRateCard({ workspaceId: "workspace-demo-agency", name: "Test", effectiveFrom: "2026-01-01", rates: RATES_V1 }, db);
    await expect(renameRateCardLineage(v1.lineageId, "  ", db)).rejects.toThrow();
  });

  it("archive/restore round-trip", async () => {
    const { db } = await createTestDb();
    const v1 = await createRateCard({ workspaceId: "workspace-demo-agency", name: "Test", effectiveFrom: "2026-01-01", rates: RATES_V1 }, db);

    await archiveRateCardLineage(v1.lineageId, db);
    expect((await db.rateCardLineages.getById(v1.lineageId)).archivedAt).toBeTruthy();

    await restoreRateCardLineage(v1.lineageId, db);
    expect((await db.rateCardLineages.getById(v1.lineageId)).archivedAt).toBeNull();
  });

  it("archiving or reviewing a lineage never alters an already-pinned Shift's historical pay", async () => {
    const { db } = await createTestDb();

    // Pin a real shift against Alex's real Example Driver Agency/Example Logistics rate card lineage.
    const shift = await createShift(
      { workspaceId: "workspace-demo-agency", driverId: "person-demo", assignmentId: "assignment-demo-agency-client", date: "2099-01-01", start: "08:00", end: "16:00", breakMinutes: 45, drivingHours: 6 },
      db
    );
    const pinnedRateCard = await db.rateCards.getById(shift.rateCardId);
    const payBefore = computeShiftBreakdown(shift, pinnedRateCard);

    // Archive the lineage, then add a brand-new version far in the future.
    const lineageId = pinnedRateCard.lineageId;
    await archiveRateCardLineage(lineageId, db);
    await restoreRateCardLineage(lineageId, db);
    await reviseRateCard(lineageId, { effectiveFrom: "2099-06-01", rates: RATES_V2 }, db);

    // The shift's pinned rateCardId, its resolved rate card, and its computed pay are all unchanged.
    const shiftAfter = await db.shifts.getById(shift.id);
    expect(shiftAfter.rateCardId).toBe(shift.rateCardId);
    const pinnedRateCardAfter = await db.rateCards.getById(shiftAfter.rateCardId);
    expect(pinnedRateCardAfter).toEqual(pinnedRateCard);
    const payAfter = computeShiftBreakdown(shiftAfter, pinnedRateCardAfter);
    expect(payAfter).toEqual(payBefore);
  });
});

describe("rateCardService — payType (Per-Load Pay, Stage PL-1)", () => {
  it("createRateCard defaults payType to 'hourly' when omitted", async () => {
    const { db } = await createTestDb();
    const rc = await createRateCard({ workspaceId: "workspace-demo-agency", name: "Test", effectiveFrom: "2026-01-01", rates: RATES_V1 }, db);
    const lineage = await db.rateCardLineages.getById(rc.lineageId);
    expect(lineage.payType).toBe("hourly");
    expect(rc.rates).toEqual(RATES_V1);
  });

  it("createRateCard with payType 'per_load' forces rates to {} regardless of what's passed", async () => {
    const { db } = await createTestDb();
    const rc = await createRateCard(
      { workspaceId: "workspace-demo-agency", name: "Amazon Relay Spot Loads", effectiveFrom: "2026-01-01", rates: RATES_V1, payType: "per_load" },
      db
    );
    const lineage = await db.rateCardLineages.getById(rc.lineageId);
    expect(lineage.payType).toBe("per_load");
    expect(rc.rates).toEqual({});
  });

  it("reviseRateCard inherits the lineage's payType — a per_load lineage's new version also has empty rates", async () => {
    const { db } = await createTestDb();
    const v1 = await createRateCard(
      { workspaceId: "workspace-demo-agency", name: "Spot Loads", effectiveFrom: "2026-01-01", rates: {}, payType: "per_load" },
      db
    );
    const v2 = await reviseRateCard(v1.lineageId, { effectiveFrom: "2026-06-01", rates: RATES_V2 }, db);
    expect(v2.rates).toEqual({});
  });

  it("reviseRateCard on an 'hourly' lineage still stores rates normally (payType lookup doesn't break the existing path)", async () => {
    const { db } = await createTestDb();
    const v1 = await createRateCard({ workspaceId: "workspace-demo-agency", name: "Test", effectiveFrom: "2026-01-01", rates: RATES_V1 }, db);
    const v2 = await reviseRateCard(v1.lineageId, { effectiveFrom: "2026-06-01", rates: RATES_V2 }, db);
    expect(v2.rates).toEqual(RATES_V2);
  });

  it("resolveEffectiveRateCard denormalizes the lineage's payType onto the returned RateCard (Stage PL-2)", async () => {
    const { db } = await createTestDb();
    const perLoad = await createRateCard(
      { workspaceId: "workspace-demo-agency", name: "Spot Loads", effectiveFrom: "2026-01-01", rates: {}, payType: "per_load" },
      db
    );
    const resolved = await resolveEffectiveRateCard(perLoad.lineageId, "2026-06-01", db);
    expect(resolved.payType).toBe("per_load");
  });

  it("resolveEffectiveRateCard defaults payType to 'hourly' when omitted at creation", async () => {
    const { db } = await createTestDb();
    const hourly = await createRateCard({ workspaceId: "workspace-demo-agency", name: "Test", effectiveFrom: "2026-01-01", rates: RATES_V1 }, db);
    const resolved = await resolveEffectiveRateCard(hourly.lineageId, "2026-06-01", db);
    expect(resolved.payType).toBe("hourly");
  });

  it("buildRateCardResolver denormalizes payType per shift, batched (Stage PL-2)", async () => {
    const { db } = await createTestDb();
    const perLoad = await createRateCard(
      { workspaceId: "workspace-demo-agency", name: "Spot Loads", effectiveFrom: "2026-01-01", rates: {}, payType: "per_load" },
      db
    );
    const shifts = [{ id: "s1", rateCardId: perLoad.id }, { id: "s2", rateCardId: "ratecard-demo-agency-client" }];
    const resolve = await buildRateCardResolver(shifts, db);
    expect(resolve(shifts[0]).payType).toBe("per_load");
    expect(resolve(shifts[1]).payType).toBe("hourly");
  });
});
