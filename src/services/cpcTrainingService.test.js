import { describe, expect, it } from "vitest";
import { createDb } from "../storage/db.js";
import { createInMemoryStorage } from "../../test/inMemoryStorage.js";
import { createDriverDocument } from "./driverDocumentService.js";
import { deleteCpcTrainingRecord, listCpcTrainingRecords, logCpcTraining, resolveCpcCycleStatusForDriver } from "./cpcTrainingService.js";

function newDb() {
  return createDb(createInMemoryStorage());
}

describe("cpcTrainingService", () => {
  it("logs a training session with the required fields only", async () => {
    const db = newDb();
    const record = await logCpcTraining({ personId: "p1", date: "2026-01-01", hours: 7 }, db);
    expect(record.hours).toBe(7);
    expect(record.provider).toBeNull();
  });

  it("rejects a session with no hours or zero/negative hours", async () => {
    const db = newDb();
    await expect(logCpcTraining({ personId: "p1", date: "2026-01-01", hours: 0 }, db)).rejects.toThrow();
    await expect(logCpcTraining({ personId: "p1", date: "2026-01-01" }, db)).rejects.toThrow();
  });

  it("lists only a given person's records", async () => {
    const db = newDb();
    await logCpcTraining({ personId: "p1", date: "2026-01-01", hours: 7 }, db);
    await logCpcTraining({ personId: "p2", date: "2026-01-01", hours: 7 }, db);
    expect(await listCpcTrainingRecords("p1", db)).toHaveLength(1);
  });

  it("deletes a record with plain CRUD, no archive step", async () => {
    const db = newDb();
    const record = await logCpcTraining({ personId: "p1", date: "2026-01-01", hours: 7 }, db);
    await deleteCpcTrainingRecord(record.id, db);
    expect(await listCpcTrainingRecords("p1", db)).toHaveLength(0);
  });

  it("resolveCpcCycleStatusForDriver returns unknown_cycle with no cpc_card document", async () => {
    const db = newDb();
    const status = await resolveCpcCycleStatusForDriver("p1", db, new Date("2026-08-04"));
    expect(status.status).toBe("unknown_cycle");
  });

  it("resolveCpcCycleStatusForDriver composes the active cpc_card with training records", async () => {
    const db = newDb();
    await createDriverDocument({ personId: "p1", documentType: "cpc_card", expiryDate: "2028-06-01" }, db);
    await logCpcTraining({ personId: "p1", date: "2024-01-01", hours: 20 }, db);
    const status = await resolveCpcCycleStatusForDriver("p1", db, new Date("2026-08-04"));
    expect(status.hoursCompleted).toBe(20);
    expect(status.status).toBe("warning");
  });

  it("resolveCpcCycleStatusForDriver ignores an archived cpc_card and picks the latest active one", async () => {
    const db = newDb();
    const oldCard = await createDriverDocument({ personId: "p1", documentType: "cpc_card", expiryDate: "2024-01-01" }, db);
    const { archiveDriverDocument } = await import("./driverDocumentService.js");
    await archiveDriverDocument(oldCard.id, db);
    await createDriverDocument({ personId: "p1", documentType: "cpc_card", expiryDate: "2030-01-01" }, db);
    const status = await resolveCpcCycleStatusForDriver("p1", db, new Date("2026-08-04"));
    expect(status.cycleEndDate).toBe("2030-01-01");
  });
});
