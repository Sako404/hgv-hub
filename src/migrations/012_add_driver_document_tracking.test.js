import { describe, expect, it } from "vitest";
import { createDb } from "../storage/db.js";
import { createInMemoryStorage } from "../../test/inMemoryStorage.js";
import { migration012AddDriverDocumentTracking } from "./012_add_driver_document_tracking.js";

describe("migration 012 — driver document tracking foundation", () => {
  it("is a safe no-op — resolves without error and touches no existing collection", async () => {
    const db = createDb(createInMemoryStorage());
    await db.rateCardLineages.insert({
      id: "lineage-1",
      workspaceId: "ws-1",
      name: "Standard",
      payType: "hourly",
      archivedAt: null,
      createdAt: "now",
    });

    await expect(migration012AddDriverDocumentTracking(db)).resolves.toBeUndefined();

    const lineage = await db.rateCardLineages.getById("lineage-1");
    expect(lineage.name).toBe("Standard");
    expect(await db.driverDocuments.getAll()).toEqual([]);
  });

  it("is idempotent — a repeat run is still a no-op", async () => {
    const db = createDb(createInMemoryStorage());
    await migration012AddDriverDocumentTracking(db);
    await migration012AddDriverDocumentTracking(db);
    expect(await db.driverDocuments.getAll()).toEqual([]);
  });
});
