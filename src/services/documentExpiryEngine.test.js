import { describe, expect, it } from "vitest";
import { resolveDocumentStatus, resolveDriverDocumentSummary } from "./documentExpiryEngine.js";

const TODAY = new Date("2026-08-04T00:00:00");

function doc(expiryDate) {
  return { id: "d1", personId: "p1", documentType: "driving_licence", expiryDate, archivedAt: null };
}

describe("resolveDocumentStatus", () => {
  it("returns 'unknown' when no expiryDate is set", () => {
    expect(resolveDocumentStatus(doc(null), TODAY)).toBe("unknown");
  });

  it("returns 'expired' for a past date", () => {
    expect(resolveDocumentStatus(doc("2026-08-01"), TODAY)).toBe("expired");
  });

  it("returns 'expired' for today's date having already passed midnight (day 0 counts as not-yet-expired)", () => {
    expect(resolveDocumentStatus(doc("2026-08-04"), TODAY)).toBe("expiring_soon");
  });

  it("returns 'expiring_soon' inside the default 30-day window", () => {
    expect(resolveDocumentStatus(doc("2026-08-20"), TODAY)).toBe("expiring_soon");
    expect(resolveDocumentStatus(doc("2026-09-03"), TODAY)).toBe("expiring_soon");
  });

  it("returns 'ok' outside the default 30-day window", () => {
    expect(resolveDocumentStatus(doc("2026-09-10"), TODAY)).toBe("ok");
  });

  it("respects a custom warning window", () => {
    expect(resolveDocumentStatus(doc("2026-08-10"), TODAY, 5)).toBe("ok");
    expect(resolveDocumentStatus(doc("2026-08-10"), TODAY, 10)).toBe("expiring_soon");
  });
});

describe("resolveDriverDocumentSummary", () => {
  it("returns 'ok' for an empty list", () => {
    expect(resolveDriverDocumentSummary([], TODAY)).toBe("ok");
  });

  it("returns the worst status across several documents", () => {
    const documents = [doc("2026-12-01"), doc("2026-08-10"), doc("2026-07-01")];
    expect(resolveDriverDocumentSummary(documents, TODAY)).toBe("expired");
  });

  it("treats 'unknown' as worse than 'ok' but better than 'expiring_soon'/'expired'", () => {
    expect(resolveDriverDocumentSummary([doc(null)], TODAY)).toBe("unknown");
    expect(resolveDriverDocumentSummary([doc(null), doc("2026-08-10")], TODAY)).toBe("expiring_soon");
  });
});
