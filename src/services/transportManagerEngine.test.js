import { describe, expect, it } from "vitest";
import { resolveExternalTmLimitStatus, resolveRecommendedHours } from "./transportManagerEngine.js";

describe("resolveRecommendedHours", () => {
  it.each([
    [0, 2, 4],
    [2, 2, 4],
    [3, 4, 8],
    [5, 4, 8],
    [6, 8, 12],
    [10, 8, 12],
    [11, 12, 20],
    [14, 12, 20],
    [15, 20, 30],
    [29, 20, 30],
  ])("returns the correct band for %i vehicles", (vehicleCount, minHours, maxHours) => {
    const result = resolveRecommendedHours(vehicleCount);
    expect(result.minHours).toBe(minHours);
    expect(result.maxHours).toBe(maxHours);
    expect(result.fullTimeRequired).toBe(false);
  });

  it("30-50 vehicles requires full time with an open-ended upper bound", () => {
    const result = resolveRecommendedHours(30);
    expect(result.minHours).toBe(30);
    expect(result.maxHours).toBeNull();
    expect(result.fullTimeRequired).toBe(true);
    expect(result.additionalAssistanceRecommended).toBe(false);

    const upper = resolveRecommendedHours(50);
    expect(upper.fullTimeRequired).toBe(true);
  });

  it("above 50 vehicles recommends additional assistance", () => {
    const result = resolveRecommendedHours(51);
    expect(result.fullTimeRequired).toBe(true);
    expect(result.additionalAssistanceRecommended).toBe(true);
  });
});

describe("resolveExternalTmLimitStatus", () => {
  it("is within limit for a single small operator", () => {
    const result = resolveExternalTmLimitStatus([{ workspaceId: "ws-1", vehicleCount: 5 }]);
    expect(result.operatorCount).toBe(1);
    expect(result.totalVehicleCount).toBe(5);
    expect(result.withinLimit).toBe(true);
  });

  it("flags exceeding the 4-operator limit even with few vehicles each", () => {
    const workspaces = Array.from({ length: 5 }, (_, i) => ({ workspaceId: `ws-${i}`, vehicleCount: 1 }));
    const result = resolveExternalTmLimitStatus(workspaces);
    expect(result.operatorCount).toBe(5);
    expect(result.withinLimit).toBe(false);
  });

  it("flags exceeding the 50-vehicle combined limit even within 4 operators", () => {
    const workspaces = [
      { workspaceId: "ws-1", vehicleCount: 20 },
      { workspaceId: "ws-2", vehicleCount: 20 },
      { workspaceId: "ws-3", vehicleCount: 20 },
    ];
    const result = resolveExternalTmLimitStatus(workspaces);
    expect(result.operatorCount).toBe(3);
    expect(result.totalVehicleCount).toBe(60);
    expect(result.withinLimit).toBe(false);
  });

  it("is within limit at exactly the boundary (4 operators, 50 vehicles)", () => {
    const workspaces = [
      { workspaceId: "ws-1", vehicleCount: 20 },
      { workspaceId: "ws-2", vehicleCount: 20 },
      { workspaceId: "ws-3", vehicleCount: 5 },
      { workspaceId: "ws-4", vehicleCount: 5 },
    ];
    const result = resolveExternalTmLimitStatus(workspaces);
    expect(result.withinLimit).toBe(true);
  });
});
