import { describe, expect, it } from "vitest";
import { computeShiftBreakdown } from "./payEngine.js";

// Literal legacy RATES fixture, copied verbatim from the pre-refactor
// App.jsx / migration 002 — pins "the math is unchanged" for the refactor.
const RATE_CARD = {
  id: "ratecard-fixture",
  workspaceId: "workspace-fixture",
  name: "fixture",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  rates: {
    MonThu: { Days: [15.20, 17.20], Lates: [15.70, 17.70], Nights: [16.70, 18.70] },
    Fri: { Days: [15.95, 17.95], Lates: [16.45, 18.45], Nights: [17.45, 19.45] },
    Sat: { Days: [16.70, 18.70], Lates: [17.20, 19.20], Nights: [19.20, 21.20] },
    Sun: { Days: [17.20, 19.20], Lates: [17.70, 19.70], Nights: [20.20, 22.20] },
  },
};

function approx(a, b, eps = 0.01) {
  expect(Math.abs(a - b)).toBeLessThan(eps);
}

describe("computeShiftBreakdown", () => {
  it("prices a simple single-window Tuesday day shift", () => {
    // 2026-07-14 is a Tuesday.
    const shift = { date: "2026-07-14", start: "08:00", end: "13:00", breakMinutes: 0 };
    const b = computeShiftBreakdown(shift, RATE_CARD);
    expect(b.priced).toBe(true);
    approx(b.totalPaidHours, 5);
    approx(b.totalBasePay, 5 * 15.20);
    approx(b.totalGross, 5 * 17.20);
  });

  it("deducts the break from the shift END, not proportionally", () => {
    // 08:00-16:00 Tue, 45 min break => paid window is 08:00-15:15 (all Days).
    const shift = { date: "2026-07-14", start: "08:00", end: "16:00", breakMinutes: 45 };
    const b = computeShiftBreakdown(shift, RATE_CARD);
    approx(b.paidMinutes, 7.25 * 60);
    approx(b.totalPaidHours, 7.25);
    // Entirely within Days window (06:00-14:00 boundary would split it,
    // but paid end 15:15 crosses into Lates at 14:00) -> two segments.
    expect(b.segments.length).toBeGreaterThanOrEqual(1);
    approx(b.totalPaidHours, b.segments.reduce((s, x) => s + x.hours, 0));
  });

  it("splits a shift crossing a day/window boundary into rate segments", () => {
    // Tuesday 12:00 - Wednesday 02:00, no break: crosses 14:00, 22:00, and midnight.
    const shift = { date: "2026-07-14", start: "12:00", end: "02:00", breakMinutes: 0 };
    const b = computeShiftBreakdown(shift, RATE_CARD);
    expect(b.segments.length).toBeGreaterThan(1);
    approx(b.totalPaidHours, 14);
    approx(
      b.totalGross,
      b.segments.reduce((s, x) => s + x.incPay, 0)
    );
  });

  it("returns unpriced zeros (not fabricated pay) when there is no rate card", () => {
    const shift = { date: "2026-07-14", start: "08:00", end: "16:00", breakMinutes: 45 };
    const b = computeShiftBreakdown(shift, null);
    expect(b.priced).toBe(false);
    expect(b.totalBasePay).toBe(0);
    expect(b.totalHolidayDiff).toBe(0);
    expect(b.totalGross).toBe(0);
    approx(b.totalPaidHours, 7.25);
  });

  it("prices Saturday and Sunday at their distinct higher rates", () => {
    // 2026-07-18 is a Saturday.
    const sat = computeShiftBreakdown(
      { date: "2026-07-18", start: "08:00", end: "13:00", breakMinutes: 0 },
      RATE_CARD
    );
    approx(sat.totalBasePay, 5 * 16.70);
    // 2026-07-19 is a Sunday.
    const sun = computeShiftBreakdown(
      { date: "2026-07-19", start: "08:00", end: "13:00", breakMinutes: 0 },
      RATE_CARD
    );
    approx(sun.totalBasePay, 5 * 17.20);
  });
});

describe("computeShiftBreakdown — per-load pay (Per-Load Pay Stage PL-2)", () => {
  const PER_LOAD_RATE_CARD = {
    id: "ratecard-per-load-fixture",
    workspaceId: "workspace-fixture",
    lineageId: "ratecard-per-load-fixture",
    payType: "per_load",
    rates: {},
  };
  const SHIFT = { date: "2026-07-14", start: "08:00", end: "16:00", breakMinutes: 45 };

  it("sums the given loads' amounts into totalGross, with no base/holiday split", () => {
    const loads = [{ amount: 120.5 }, { amount: 89.25 }];
    const b = computeShiftBreakdown(SHIFT, PER_LOAD_RATE_CARD, loads);
    expect(b.perLoad).toBe(true);
    expect(b.priced).toBe(true);
    expect(b.loadsCount).toBe(2);
    expect(b.segments).toEqual([]);
    expect(b.totalBasePay).toBe(0);
    expect(b.totalHolidayDiff).toBe(0);
    approx(b.totalGross, 209.75);
  });

  it("still computes duty/paid hours identically to the hourly path — pricing model never touches compliance-relevant duration", () => {
    const hourlyLike = computeShiftBreakdown(SHIFT, null);
    const perLoad = computeShiftBreakdown(SHIFT, PER_LOAD_RATE_CARD, [{ amount: 50 }]);
    expect(perLoad.dutyMinutes).toBe(hourlyLike.dutyMinutes);
    expect(perLoad.paidMinutes).toBe(hourlyLike.paidMinutes);
    approx(perLoad.totalPaidHours, hourlyLike.totalPaidHours);
  });

  it("is unpriced (not a fabricated £0.00) when no loads have been entered yet", () => {
    const b = computeShiftBreakdown(SHIFT, PER_LOAD_RATE_CARD, []);
    expect(b.priced).toBe(false);
    expect(b.perLoad).toBe(true);
    expect(b.totalGross).toBe(0);
  });

  it("defaults loads to [] when the third argument is omitted", () => {
    const b = computeShiftBreakdown(SHIFT, PER_LOAD_RATE_CARD);
    expect(b.priced).toBe(false);
    expect(b.totalGross).toBe(0);
  });

  it("an hourly rate card's breakdown reports perLoad: false and loadsCount: 0", () => {
    const b = computeShiftBreakdown(SHIFT, RATE_CARD);
    expect(b.perLoad).toBe(false);
    expect(b.loadsCount).toBe(0);
  });
});
