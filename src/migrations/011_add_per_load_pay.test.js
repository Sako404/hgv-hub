import { describe, expect, it } from "vitest";
import { createDb } from "../storage/db.js";
import { createInMemoryStorage } from "../../test/inMemoryStorage.js";
import { migration011AddPerLoadPay } from "./011_add_per_load_pay.js";

describe("migration 011 — payType backfill", () => {
  it("backfills payType: 'hourly' onto an existing RateCardLineage that predates it", async () => {
    const db = createDb(createInMemoryStorage());
    await db.rateCardLineages.insert({
      id: "lineage-1",
      workspaceId: "ws-1",
      name: "Standard",
      archivedAt: null,
      createdAt: "now",
    });

    await migration011AddPerLoadPay(db);

    const lineage = await db.rateCardLineages.getById("lineage-1");
    expect(lineage.payType).toBe("hourly");
  });

  it("is idempotent — a from-scratch re-run doesn't error or change an already-set value", async () => {
    const db = createDb(createInMemoryStorage());
    await db.rateCardLineages.insert({
      id: "lineage-1",
      workspaceId: "ws-1",
      name: "Spot Loads",
      payType: "per_load",
      archivedAt: null,
      createdAt: "now",
    });

    await migration011AddPerLoadPay(db);
    await migration011AddPerLoadPay(db);

    const lineage = await db.rateCardLineages.getById("lineage-1");
    expect(lineage.payType).toBe("per_load");
  });
});
