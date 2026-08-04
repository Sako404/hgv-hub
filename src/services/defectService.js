import { newId } from "../domain/ids.js";

const STATUS_ORDER = ["open", "reported", "in_progress", "resolved"];

/** @param {string} workspaceId */
export async function listDefectsForWorkspace(workspaceId, db) {
  return db.defects.query({ where: { workspaceId } });
}

/**
 * @param {{workspaceId: string, vehicleId: string, raisedByDriverId: string, severity?: import('../domain/types.js').DefectSeverity, description: string, raisedFromCheckId?: string|null, raisedFromItemCode?: string|null}} input
 */
export async function createDefect(input, db) {
  if (!input.description) {
    throw new Error("A defect needs a description");
  }
  return db.defects.insert({
    id: newId("defect"),
    workspaceId: input.workspaceId,
    vehicleId: input.vehicleId,
    raisedFromCheckId: input.raisedFromCheckId ?? null,
    raisedFromItemCode: input.raisedFromItemCode ?? null,
    raisedByDriverId: input.raisedByDriverId,
    severity: input.severity ?? "minor",
    description: input.description,
    status: "open",
    resolvedAt: null,
    resolvedNotes: null,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Auto-raises one Defect per failed item in a just-submitted
 * VehicleCheck. Called from vehicleCheckService.createVehicleCheck
 * itself (a domain rule of "what a submitted check with failures
 * means," the same kind of inherent consequence Shift.rateCardId
 * pinning is — not a UI-orchestrated side effect), so every caller
 * gets it for free. Severity always starts 'minor'; a manager escalates
 * it from the Defects screen if warranted. Each defect raises against
 * the failed item's OWN `vehicleId` — not always `check.vehicleId` —
 * so a paired tractor+trailer check (see
 * decision-2026-08-04-working-time-owner-operator-architecture)
 * correctly splits defects across both vehicles' own defect lists.
 * @param {import('../domain/types.js').VehicleCheck} check
 */
export async function raiseDefectsFromVehicleCheck(check, db) {
  const failedItems = check.items.filter((item) => item.result === "defect");
  return Promise.all(
    failedItems.map((item) =>
      createDefect(
        {
          workspaceId: check.workspaceId,
          vehicleId: item.vehicleId ?? check.vehicleId,
          raisedByDriverId: check.driverId,
          severity: "minor",
          description: item.notes ? `${item.label}: ${item.notes}` : item.label,
          raisedFromCheckId: check.id,
          raisedFromItemCode: item.code,
        },
        db
      )
    )
  );
}

/**
 * Moves a defect to the NEXT status in the linear workflow only — never
 * skips ahead or goes backward, so the status history stays an honest
 * audit trail. `resolvedNotes` is only stored (and only meaningful) on
 * the transition into 'resolved'; ignored otherwise.
 */
export async function advanceDefectStatus(id, resolvedNotes, db) {
  const defect = await db.defects.getById(id);
  const currentIndex = STATUS_ORDER.indexOf(defect.status);
  if (currentIndex === -1 || currentIndex === STATUS_ORDER.length - 1) {
    throw new Error("This defect is already resolved");
  }
  const nextStatus = STATUS_ORDER[currentIndex + 1];
  const patch = { status: nextStatus };
  if (nextStatus === "resolved") {
    patch.resolvedAt = new Date().toISOString();
    patch.resolvedNotes = resolvedNotes || null;
  }
  return db.defects.update(id, patch);
}
