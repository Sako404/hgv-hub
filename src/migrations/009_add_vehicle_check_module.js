import { newId } from "../domain/ids.js";

/**
 * A driver marks items not physically present on their vehicle (e.g.
 * "Coupling" on a rigid, not an articulated tractor unit) as `n/a` at
 * check time (VehicleCheck.items[].result) rather than the template
 * omitting them — one shared default list covers every VehicleType.
 */
const DEFAULT_CHECKLIST_ITEMS = [
  { code: "fuel_oil_coolant", label: "Fuel, oil and coolant levels", category: "Engine bay" },
  { code: "engine_leaks", label: "No visible fluid leaks", category: "Engine bay" },
  { code: "windscreen", label: "Windscreen clean and free of damage", category: "Cab" },
  { code: "wipers_washers", label: "Wipers and washers working", category: "Cab" },
  { code: "mirrors", label: "Mirrors secure, clean and correctly adjusted", category: "Cab" },
  { code: "horn", label: "Horn working", category: "Cab" },
  { code: "seatbelt", label: "Seatbelt in good condition and working", category: "Cab" },
  { code: "dashboard_warnings", label: "No warning lights showing after startup", category: "Cab" },
  { code: "steering", label: "Steering free of excessive play", category: "Cab" },
  { code: "tachograph", label: "Tachograph/speedometer working correctly", category: "Cab" },
  { code: "headlights", label: "Headlights (dip and main beam) working", category: "Lights" },
  { code: "indicators_hazards", label: "Indicators and hazard lights working", category: "Lights" },
  { code: "brake_lights", label: "Brake lights working", category: "Lights" },
  { code: "reflectors_markers", label: "Reflectors and markers present and clean", category: "Lights" },
  { code: "tyres_condition", label: "Tyres free of cuts, bulges and exposed cord", category: "Tyres & wheels" },
  { code: "tyres_tread", label: "Tread depth legal on all tyres", category: "Tyres & wheels" },
  { code: "wheel_nuts", label: "Wheel nuts/indicators all present and secure", category: "Tyres & wheels" },
  { code: "air_brakes", label: "Air brake system builds pressure, no warning light", category: "Braking system" },
  { code: "parking_brake", label: "Parking brake holds correctly", category: "Braking system" },
  { code: "bodywork_doors", label: "Bodywork and doors secure, no damage", category: "Bodywork" },
  { code: "number_plates", label: "Number plates clean, secure and legible", category: "Bodywork" },
  { code: "coupling", label: "Coupling (fifth wheel/kingpin), air and electrical lines secure", category: "Coupling" },
  { code: "load_security", label: "Load secure (if loaded)", category: "Load" },
];

/**
 * Vehicle Check module foundation (VC-1, see
 * decision-2026-08-03-working-time-vehicle-check-module-architecture).
 * The vehicles/checklistTemplates/vehicleChecks/defects IndexedDB
 * stores are created by indexedDbClient.js's own DB_VERSION bump (a
 * separate, lower-level mechanism — see its comment); this migration
 * only seeds DATA: one DVSA-style default ChecklistTemplate per
 * existing workspace, so a workspace starts with a real, usable
 * checklist rather than an empty one. Guarded on "does this workspace
 * already have a default template" so a retry after a partial failure
 * never double-seeds — same restart-safety pattern as migration 005.
 * @param {ReturnType<typeof import('../storage/db.js').createIndexedDbDb>} db
 */
export async function migration009AddVehicleCheckModule(db) {
  const now = new Date().toISOString();
  const workspaces = await db.workspaces.getAll();
  for (const workspace of workspaces) {
    const existingDefault = await db.checklistTemplates.query({
      where: { workspaceId: workspace.id, isDefault: true },
    });
    if (existingDefault.length > 0) continue;
    await db.checklistTemplates.insert({
      id: newId("checklisttemplate"),
      workspaceId: workspace.id,
      name: "Daily walkaround (default)",
      items: DEFAULT_CHECKLIST_ITEMS,
      isDefault: true,
      archivedAt: null,
      createdAt: now,
    });
  }
}
