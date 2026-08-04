import { describe, expect, it } from "vitest";
import { resolveCpcCycleStatus } from "./cpcTrainingEngine.js";

const TODAY = new Date("2026-08-04T00:00:00");

function cpcCard(expiryDate) {
  return { id: "d1", personId: "p1", documentType: "cpc_card", expiryDate, archivedAt: null };
}

function record(date, hours) {
  return { id: `r-${date}`, personId: "p1", date, hours, provider: null, notes: null };
}

describe("resolveCpcCycleStatus", () => {
  it("returns 'unknown_cycle' when there is no cpc_card document", () => {
    const result = resolveCpcCycleStatus(null, [], TODAY);
    expect(result.status).toBe("unknown_cycle");
    expect(result.cycleStartDate).toBeNull();
  });

  it("returns 'unknown_cycle' when the cpc_card document has no expiryDate", () => {
    const result = resolveCpcCycleStatus(cpcCard(null), [], TODAY);
    expect(result.status).toBe("unknown_cycle");
  });

  it("derives cycleStartDate as 5 years before the cpc_card's expiryDate", () => {
    const result = resolveCpcCycleStatus(cpcCard("2028-06-01"), [], TODAY);
    expect(result.cycleEndDate).toBe("2028-06-01");
    expect(result.cycleStartDate).toBe("2023-06-01");
  });

  it("sums only hours from records falling within the cycle window", () => {
    const document = cpcCard("2028-06-01"); // cycle: 2023-06-01 .. 2028-06-01
    const records = [
      record("2022-01-01", 7), // before the cycle — excluded
      record("2024-01-01", 7),
      record("2025-01-01", 7),
      record("2029-01-01", 7), // after the cycle — excluded
    ];
    const result = resolveCpcCycleStatus(document, records, TODAY);
    expect(result.hoursCompleted).toBe(14);
  });

  it("status 'ok' once hoursCompleted reaches 35", () => {
    const document = cpcCard("2028-06-01");
    const records = Array.from({ length: 5 }, (_, i) => record(`2024-0${i + 1}-01`, 7));
    const result = resolveCpcCycleStatus(document, records, TODAY);
    expect(result.hoursCompleted).toBe(35);
    expect(result.status).toBe("ok");
  });

  it("status 'warning' when under 35h but the cycle is still open", () => {
    const document = cpcCard("2028-06-01");
    const result = resolveCpcCycleStatus(document, [record("2024-01-01", 7)], TODAY);
    expect(result.status).toBe("warning");
  });

  it("status 'problem' when under 35h and the cycle has already ended", () => {
    const document = cpcCard("2026-01-01"); // already passed relative to TODAY
    const result = resolveCpcCycleStatus(document, [record("2021-06-01", 7)], TODAY);
    expect(result.status).toBe("problem");
  });
});
