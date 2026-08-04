import { describe, expect, it } from "vitest";
import { createDb } from "../storage/db.js";
import { createInMemoryStorage } from "../../test/inMemoryStorage.js";
import {
  archiveDriverDocument,
  createDriverDocument,
  listDriverDocuments,
  renewDriverDocument,
  restoreDriverDocument,
  updateDriverDocument,
} from "./driverDocumentService.js";

function newDb() {
  return createDb(createInMemoryStorage());
}

describe("driverDocumentService", () => {
  it("creates a named document type with no label", async () => {
    const db = newDb();
    const doc = await createDriverDocument(
      { personId: "p1", documentType: "driving_licence", expiryDate: "2030-01-01" },
      db
    );
    expect(doc.documentType).toBe("driving_licence");
    expect(doc.label).toBeNull();
    expect(doc.archivedAt).toBeNull();
  });

  it("requires a label for documentType 'other'", async () => {
    const db = newDb();
    await expect(createDriverDocument({ personId: "p1", documentType: "other" }, db)).rejects.toThrow();
    const doc = await createDriverDocument({ personId: "p1", documentType: "other", label: "ADR certificate" }, db);
    expect(doc.label).toBe("ADR certificate");
  });

  it("lists only a given person's documents, excluding archived by default inclusion behaviour matches activeOnly flag", async () => {
    const db = newDb();
    await createDriverDocument({ personId: "p1", documentType: "cpc_card", expiryDate: "2030-01-01" }, db);
    await createDriverDocument({ personId: "p2", documentType: "cpc_card", expiryDate: "2030-01-01" }, db);
    const forP1 = await listDriverDocuments("p1", db);
    expect(forP1).toHaveLength(1);
    expect(forP1[0].personId).toBe("p1");
  });

  it("activeOnly excludes archived rows", async () => {
    const db = newDb();
    const doc = await createDriverDocument({ personId: "p1", documentType: "tacho_card", expiryDate: "2030-01-01" }, db);
    await archiveDriverDocument(doc.id, db);
    expect(await listDriverDocuments("p1", db, { activeOnly: true })).toHaveLength(0);
    expect(await listDriverDocuments("p1", db)).toHaveLength(1);
  });

  it("restore clears archivedAt", async () => {
    const db = newDb();
    const doc = await createDriverDocument({ personId: "p1", documentType: "tacho_card", expiryDate: "2030-01-01" }, db);
    await archiveDriverDocument(doc.id, db);
    await restoreDriverDocument(doc.id, db);
    const active = await listDriverDocuments("p1", db, { activeOnly: true });
    expect(active).toHaveLength(1);
  });

  it("rejects changing documentType via update", async () => {
    const db = newDb();
    const doc = await createDriverDocument({ personId: "p1", documentType: "cpc_card", expiryDate: "2030-01-01" }, db);
    await expect(updateDriverDocument(doc.id, { documentType: "other" }, db)).rejects.toThrow();
  });

  it("renews: archives the old row and inserts a new active one with the new expiry date", async () => {
    const db = newDb();
    const original = await createDriverDocument(
      { personId: "p1", documentType: "cpc_card", referenceNumber: "REF-1", expiryDate: "2026-09-01" },
      db
    );

    const renewed = await renewDriverDocument(original.id, { expiryDate: "2031-09-01" }, db);

    const all = await listDriverDocuments("p1", db);
    expect(all).toHaveLength(2);
    const originalAfter = all.find((d) => d.id === original.id);
    expect(originalAfter.archivedAt).not.toBeNull();
    expect(originalAfter.expiryDate).toBe("2026-09-01");
    expect(renewed.archivedAt).toBeNull();
    expect(renewed.expiryDate).toBe("2031-09-01");
    expect(renewed.referenceNumber).toBe("REF-1");
    expect(renewed.documentType).toBe("cpc_card");
    expect(renewed.id).not.toBe(original.id);
  });

  it("renew lets referenceNumber/notes be overridden explicitly", async () => {
    const db = newDb();
    const original = await createDriverDocument(
      { personId: "p1", documentType: "driving_licence", referenceNumber: "OLD-REF", notes: "old note", expiryDate: "2026-09-01" },
      db
    );
    const renewed = await renewDriverDocument(
      original.id,
      { expiryDate: "2031-09-01", referenceNumber: "NEW-REF", notes: "new note" },
      db
    );
    expect(renewed.referenceNumber).toBe("NEW-REF");
    expect(renewed.notes).toBe("new note");
  });
});
