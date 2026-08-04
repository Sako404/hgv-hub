import { describe, expect, it } from "vitest";
import { resolveDriverReminders, resolveTransportManagerReminders } from "./reminderEngine.js";

const TODAY = new Date("2026-08-04T00:00:00");

function doc(documentType, expiryDate) {
  return { id: `d-${documentType}`, personId: "p1", documentType, expiryDate, archivedAt: null };
}

describe("resolveDriverReminders", () => {
  it("returns nothing when everything is fine", () => {
    const reminders = resolveDriverReminders([doc("driving_licence", "2030-01-01")], { status: "ok" }, TODAY);
    expect(reminders).toEqual([]);
  });

  it("flags an expired document as 'problem' and an expiring one as 'warning'", () => {
    const reminders = resolveDriverReminders(
      [doc("driving_licence", "2020-01-01"), doc("tacho_card", "2026-08-10")],
      { status: "ok" },
      TODAY
    );
    expect(reminders).toHaveLength(2);
    expect(reminders.find((r) => r.document.documentType === "driving_licence").severity).toBe("problem");
    expect(reminders.find((r) => r.document.documentType === "tacho_card").severity).toBe("warning");
  });

  it("ignores documents that are ok or unknown (no expiry date set)", () => {
    const reminders = resolveDriverReminders([doc("driving_licence", "2030-01-01"), doc("cpc_card", null)], { status: "ok" }, TODAY);
    expect(reminders).toEqual([]);
  });

  it("flags a CPC warning/problem status but NOT unknown_cycle", () => {
    expect(resolveDriverReminders([], { status: "warning" }, TODAY)).toEqual([{ kind: "cpc", severity: "warning" }]);
    expect(resolveDriverReminders([], { status: "problem" }, TODAY)).toEqual([{ kind: "cpc", severity: "problem" }]);
    expect(resolveDriverReminders([], { status: "unknown_cycle" }, TODAY)).toEqual([]);
    expect(resolveDriverReminders([], { status: "ok" }, TODAY)).toEqual([]);
  });
});

describe("resolveTransportManagerReminders", () => {
  it("returns nothing when everything is fine and within the external-TM limit", () => {
    const reminders = resolveTransportManagerReminders(
      [{ personId: "p1", displayName: "Alicja", hoursStatus: "ok", documentStatus: "ok", cpcCycleStatus: { status: "ok" } }],
      [{ vehicleId: "v1", registration: "AB12CDE", motStatus: "ok", insuranceStatus: "ok", hasDangerousDefect: false }],
      { withinLimit: true }
    );
    expect(reminders).toEqual([]);
  });

  it("flags the external-TM limit as its own reminder", () => {
    const reminders = resolveTransportManagerReminders([], [], { withinLimit: false });
    expect(reminders).toEqual([{ kind: "externalLimit", severity: "problem" }]);
  });

  it("flags driver hours/document/CPC issues with the driver's identity attached", () => {
    const reminders = resolveTransportManagerReminders(
      [
        {
          personId: "p1",
          displayName: "Alicja",
          hoursStatus: "problem",
          documentStatus: "expiring_soon",
          cpcCycleStatus: { status: "problem" },
        },
      ],
      [],
      { withinLimit: true }
    );
    expect(reminders).toHaveLength(3);
    expect(reminders.every((r) => r.personId === "p1" && r.displayName === "Alicja")).toBe(true);
    expect(reminders.find((r) => r.kind === "driverHours").severity).toBe("problem");
    expect(reminders.find((r) => r.kind === "driverDocument").severity).toBe("warning");
    expect(reminders.find((r) => r.kind === "driverCpc").severity).toBe("problem");
  });

  it("flags vehicle MOT/insurance/dangerous defect issues with the vehicle's identity attached", () => {
    const reminders = resolveTransportManagerReminders(
      [],
      [{ vehicleId: "v1", registration: "AB12CDE", motStatus: "expired", insuranceStatus: "expiring_soon", hasDangerousDefect: true }],
      { withinLimit: true }
    );
    expect(reminders).toHaveLength(3);
    expect(reminders.every((r) => r.vehicleId === "v1" && r.registration === "AB12CDE")).toBe(true);
    expect(reminders.find((r) => r.kind === "vehicleMot").severity).toBe("problem");
    expect(reminders.find((r) => r.kind === "vehicleInsurance").severity).toBe("warning");
    expect(reminders.find((r) => r.kind === "vehicleDefect").severity).toBe("problem");
  });
});
