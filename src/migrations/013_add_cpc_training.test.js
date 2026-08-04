import { describe, expect, it } from "vitest";
import { createDb } from "../storage/db.js";
import { createInMemoryStorage } from "../../test/inMemoryStorage.js";
import { migration013AddCpcTraining } from "./013_add_cpc_training.js";

describe("migration 013 — CPC training foundation", () => {
  it("is a safe no-op — resolves without error and touches no existing collection", async () => {
    const db = createDb(createInMemoryStorage());
    await db.driverDocuments.insert({
      id: "doc-1",
      personId: "p1",
      documentType: "cpc_card",
      label: null,
      referenceNumber: null,
      expiryDate: "2030-01-01",
      notes: null,
      archivedAt: null,
      createdAt: "now",
      updatedAt: "now",
    });

    await expect(migration013AddCpcTraining(db)).resolves.toBeUndefined();

    expect(await db.driverDocuments.getById("doc-1")).toBeTruthy();
    expect(await db.cpcTrainingRecords.getAll()).toEqual([]);
  });

  it("is idempotent — a repeat run is still a no-op", async () => {
    const db = createDb(createInMemoryStorage());
    await migration013AddCpcTraining(db);
    await migration013AddCpcTraining(db);
    expect(await db.cpcTrainingRecords.getAll()).toEqual([]);
  });
});
