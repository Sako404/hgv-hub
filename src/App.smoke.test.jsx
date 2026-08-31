// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";
import { STORAGE_KEYS } from "./storage/keys.js";
import { runMigrations } from "./migrations/index.js";
import { createIndexedDbDb } from "./storage/db.js";
import { seedSecondCompany } from "./services/seed/seedSecondCompany.js";
import { createSoloWorkContext, resolvePersonDisplayName } from "./services/driverService.js";
import { createDriverDocument } from "./services/driverDocumentService.js";
import { logCpcTraining } from "./services/cpcTrainingService.js";
import { createVehicle } from "./services/vehicleService.js";
import { createChecklistTemplate, setDefaultChecklistTemplate } from "./services/checklistTemplateService.js";
import { resetIndexedDb } from "../test/resetIndexedDb.js";
import { toKey } from "./services/shiftMath.js";

const RATES_FIXTURE = {
  MonThu: { Days: [15, 17], Lates: [15.5, 17.5], Nights: [16, 18] },
  Fri: { Days: [16, 18], Lates: [16.5, 18.5], Nights: [17, 19] },
  Sat: { Days: [17, 19], Lates: [17.5, 19.5], Nights: [18, 20] },
  Sun: { Days: [18, 20], Lates: [18.5, 20.5], Nights: [19, 21] },
};

// Real jsdom localStorage + a real React render/mount — this is the
// closest thing to "open it in a browser" available in this sandbox (no
// headless Chromium binary present). It exercises the actual component
// tree, hooks, and migration wiring, not just isolated service functions.
// Domain data now lives in real IndexedDB (fake-indexeddb in tests) —
// resetIndexedDb() gives each test a clean database, the IndexedDB
// equivalent of window.localStorage.clear().
//
// jsdom does not apply CSS (no real layout engine), so the desktop
// sidebar nav and the mobile bottom nav are BOTH present in the DOM at
// once — media queries only hide one of them visually in a real
// browser. Tests scope queries to the right container
// (`within(sidebarNav)` / `within(bottomNav)` / `getByRole("heading")`)
// rather than relying on visibility.

const LEGACY_SHIFTS = [
  { id: "legacy-1", date: "2026-07-14", start: "08:00", end: "16:00", drivingHours: 5, breakMinutes: 45 },
];

async function bootAppWithLegacyData() {
  window.localStorage.setItem(STORAGE_KEYS.LEGACY_SHIFTS, JSON.stringify(LEGACY_SHIFTS));
  const db = await createIndexedDbDb();
  await runMigrations(db, window.localStorage);
  render(<App />);
  // Boot (IndexedDB open + migrations + session resolve) is async now,
  // AND DriverApp itself has its own async data load past that — wait
  // for the Dashboard heading (only rendered once DriverApp's own fetch
  // has resolved) before handing control back, so callers can use
  // synchronous queries (sidebarNav(), bottomNav(), etc) safely.
  await screen.findByRole("heading", { name: "Dashboard" });
  return db;
}

function mainContent() {
  // Scopes queries to the screen content area, excluding the sidebar's
  // workspace switcher — whose <option> labels (e.g. "Example Driver Agency")
  // would otherwise collide with identically-named text rendered by the
  // Organisations/Sites screens themselves.
  return document.querySelector(".shell-main");
}

function sidebarNav() {
  return screen.getByLabelText("Main navigation");
}

function bottomNav() {
  return screen.getByLabelText("Driver quick navigation");
}

describe("AppShell — driver experience", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await resetIndexedDb();
  });
  afterEach(() => {
    cleanup();
  });

  it("boots straight into the driver sidebar for Alex, with no workspace switcher", async () => {
    await bootAppWithLegacyData();

    expect(await screen.findByText("HGV HUB")).toBeInTheDocument();
    // Driver-only membership in Example Driver Agency must NOT trigger the switcher.
    expect(screen.queryByLabelText("Switch workspace")).not.toBeInTheDocument();

    const nav = sidebarNav();
    expect(within(nav).getByText("Driver")).toBeInTheDocument();
    expect(within(nav).getByText("Dashboard")).toBeInTheDocument();
    expect(within(nav).getByText("Add Shift")).toBeInTheDocument();
    expect(within(nav).getByText("Payslip")).toBeInTheDocument();
    expect(within(nav).getByText("History")).toBeInTheDocument();

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText(/Example Driver Agency/)).toBeInTheDocument();
  });

  it("shows migrated shift history via the sidebar History link", async () => {
    await bootAppWithLegacyData();
    const user = userEvent.setup();

    await user.click(within(sidebarNav()).getByText("History"));

    expect(await screen.findByRole("heading", { name: "History" })).toBeInTheDocument();
    expect(await screen.findByText("2026-07-14")).toBeInTheDocument();
    expect(screen.getByText(/05:00 driving/)).toBeInTheDocument();
  });

  it("supports the Add Shift flow end to end via the sidebar and reflects it in history", async () => {
    await bootAppWithLegacyData();
    const user = userEvent.setup();

    await user.click(within(sidebarNav()).getByText("Add Shift"));
    expect(await screen.findByRole("heading", { name: "Add Shift" })).toBeInTheDocument();

    const dateInput = document.querySelector('input[type="date"]');
    const [startInput, endInput] = document.querySelectorAll('input[type="time"]');
    await user.clear(dateInput);
    await user.type(dateInput, "2026-07-20");
    await user.clear(startInput);
    await user.type(startInput, "0800");
    await user.clear(endInput);
    await user.type(endInput, "1300");

    await user.click(screen.getByText("Save Shift"));

    await user.click(within(sidebarNav()).getByText("History"));
    expect(await screen.findByText("2026-07-20")).toBeInTheDocument();
  });

  it("Stage 4E: Add Shift picker defaults to the last-used assignment, not always the first one", async () => {
    // Give Alex a SECOND active assignment (migration 002 already
    // gives him one at Example Driver Agency/Example Logistics) so the picker actually
    // renders — it's hidden entirely when there's only one. Created
    // BEFORE render/mount so DriverApp's initial data load already
    // resolves both, same as a real returning user would see.
    window.localStorage.setItem(STORAGE_KEYS.LEGACY_SHIFTS, JSON.stringify(LEGACY_SHIFTS));
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    await createSoloWorkContext(
      {
        workspaceId: "workspace-personal-demo",
        driverId: "person-demo",
        startDate: "2020-01-01",
        relationshipType: "agency_worker",
        providerOrganisationName: "Second Agency",
        clientOrganisationName: "Second Client",
        siteName: "Second Site",
        rateCardName: "Second Rates",
        rates: RATES_FIXTURE,
      },
      db
    );
    render(<App />);
    await screen.findByRole("heading", { name: "Dashboard" });
    const user = userEvent.setup();

    await user.click(within(sidebarNav()).getByText("Add Shift"));
    await screen.findByRole("heading", { name: "Add Shift" });

    // No shift saved with an assignment yet -> falls back to whichever
    // active assignment resolves first (pre-existing behaviour,
    // unchanged; which of the two that is isn't itself under test
    // here). Pick the OTHER one so the switch is unambiguous.
    const assignmentSelect = screen.getByLabelText("Job / employer");
    const initialDefaultId = assignmentSelect.value;
    const otherOption = Array.from(assignmentSelect.querySelectorAll("option")).find(
      (o) => o.value !== initialDefaultId
    );
    expect(otherOption).toBeTruthy();

    await user.selectOptions(assignmentSelect, otherOption);

    const dateInput = document.querySelector('input[type="date"]');
    const [startInput, endInput] = document.querySelectorAll('input[type="time"]');
    await user.clear(dateInput);
    await user.type(dateInput, "2026-07-21");
    await user.clear(startInput);
    await user.type(startInput, "0800");
    await user.clear(endInput);
    await user.type(endInput, "1300");
    await user.click(screen.getByText("Save Shift"));

    // Reopen Add Shift for a fresh (not edit) shift -> the picker now
    // defaults to what was just used, not back to the original default.
    await user.click(within(sidebarNav()).getByText("Add Shift"));
    await screen.findByRole("heading", { name: "Add Shift" });
    expect(await screen.findByLabelText("Job / employer")).toHaveProperty("value", otherOption.value);

    const profile = (
      await db.driverProfiles.query({ where: { personId: "person-demo", workspaceId: "workspace-personal-demo" } })
    )[0];
    expect(profile.lastUsedAssignmentId).toBe(otherOption.value);
  });

  it("Vehicle Check (VC-2): submit a new check end to end via the real UI", async () => {
    // Setup BEFORE render — VehicleCheckApp's initial data load must
    // already see the vehicle/template, same lesson as the Stage 4E
    // test above. A compact 2-item template (not migration 009's real
    // 23-item default) keeps this test's interactions manageable.
    window.localStorage.setItem(STORAGE_KEYS.LEGACY_SHIFTS, JSON.stringify(LEGACY_SHIFTS));
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    const vehicle = await createVehicle(
      { workspaceId: "workspace-demo-agency", registration: "AB12 CDE", vehicleType: "tractor_unit" },
      db
    );
    const template = await createChecklistTemplate(
      {
        workspaceId: "workspace-demo-agency",
        name: "Quick check",
        items: [
          { code: "tyres", label: "Tyres", category: "Exterior" },
          { code: "lights", label: "Lights", category: "Exterior" },
        ],
      },
      db
    );
    await setDefaultChecklistTemplate(template.id, "workspace-demo-agency", db);

    render(<App />);
    await screen.findByRole("heading", { name: "Dashboard" });
    const user = userEvent.setup();

    await user.click(within(sidebarNav()).getByText("New Check"));
    await screen.findByRole("heading", { name: "New Vehicle Check" });

    // Only one vehicle available -> auto-selected.
    expect(screen.getByLabelText("Vehicle")).toHaveProperty("value", vehicle.id);
    // TEMPORARY CI DIAGNOSTIC — remove once the CI-only failure is understood.
    if (!screen.queryByText("Tyres")) {
      const tpls = await db.checklistTemplates.query({ where: { workspaceId: "workspace-demo-agency" } });
      const vehs = await db.vehicles.query({ where: { workspaceId: "workspace-demo-agency" } });
      // eslint-disable-next-line no-console
      console.log("VC2-DIAG", JSON.stringify({
        templates: tpls.map((t) => ({ id: t.id, name: t.name, isDefault: t.isDefault, items: (t.items || []).length })),
        expectedTemplateId: template.id,
        vehicles: vehs.map((v) => ({ id: v.id, reg: v.registration })),
        vehicleSelectValue: screen.getByLabelText("Vehicle").value,
        mainText: mainContent().textContent.replace(/\s+/g, " ").slice(0, 700),
      }));
    }
    expect(screen.getByText("Tyres")).toBeInTheDocument();
    expect(screen.getByText("Lights")).toBeInTheDocument();
    expect(screen.getByText("Save Check")).toBeDisabled();

    await user.click(screen.getAllByText("OK")[0]); // Tyres -> OK
    await user.click(screen.getAllByText("Defect")[1]); // Lights -> Defect (index 0 is Tyres' own Defect button)
    await user.type(screen.getByPlaceholderText("Describe the defect"), "Cracked lens");
    await user.type(screen.getByLabelText("Your name (sign-off)"), "Alex Demo");

    expect(screen.getByText("Save Check")).not.toBeDisabled();
    await user.click(screen.getByText("Save Check"));

    // Saving navigates to Check History.
    await screen.findByRole("heading", { name: "Check History" });
    expect(await within(mainContent()).findByText("AB12 CDE")).toBeInTheDocument();
    expect(within(mainContent()).getByText("Defects found")).toBeInTheDocument();
    expect(within(mainContent()).getByText(/Lights.*Cracked lens/)).toBeInTheDocument();

    const checks = await db.vehicleChecks.query({ where: { driverId: "person-demo" } });
    expect(checks).toHaveLength(1);
    expect(checks[0].overallResult).toBe("defects_found");
    expect(checks[0].driverSignOffName).toBe("Alex Demo");
    expect(checks[0].workspaceId).toBe("workspace-demo-agency");
  });

  it("Add Shift (PL-2): a per-load assignment shows the Loads editor, prices from entered loads, and round-trips through edit", async () => {
    // A second, per-load assignment alongside the primary agency
    // Driving/Example Logistics (hourly) one, set up BEFORE render — same lesson as
    // Stage 4E's test above — so the Job/employer picker renders with
    // both options from the first load.
    window.localStorage.setItem(STORAGE_KEYS.LEGACY_SHIFTS, JSON.stringify(LEGACY_SHIFTS));
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    await createSoloWorkContext(
      {
        workspaceId: "workspace-personal-demo",
        driverId: "person-demo",
        startDate: "2020-01-01",
        relationshipType: "self_employed",
        providerOrganisationName: "Amazon Relay",
        clientOrganisationName: "Amazon Relay",
        siteName: "Spot Loads",
        rateCardName: "Spot Loads",
        payType: "per_load",
      },
      db
    );
    render(<App />);
    await screen.findByRole("heading", { name: "Dashboard" });
    const user = userEvent.setup();

    await user.click(within(sidebarNav()).getByText("Add Shift"));
    await screen.findByRole("heading", { name: "Add Shift" });

    const assignmentSelect = screen.getByLabelText("Job / employer");
    const perLoadOption = Array.from(assignmentSelect.querySelectorAll("option")).find((o) =>
      o.textContent.includes("Spot Loads")
    );
    expect(perLoadOption).toBeTruthy();
    await user.selectOptions(assignmentSelect, perLoadOption);

    // Loads editor now shown; the hourly pay-preview card never is.
    expect(await screen.findByText("Loads")).toBeInTheDocument();
    expect(screen.queryByText("Pay preview")).not.toBeInTheDocument();
    // No loads entered yet -> the per-load "nothing to price" message,
    // not the generic "no rate card assigned" one (a rate card IS
    // assigned here, it's just per-load with nothing entered).
    expect(await screen.findByText(/add at least one load/i)).toBeInTheDocument();

    // Date left at its default (today) — deliberately, so this shift
    // falls within the Dashboard's default "this week" window and its
    // Expected gross KPI can be checked below without also having to
    // navigate the week picker to a fixed historical date.
    const todayKey = toKey(new Date());
    const [startInput, endInput] = document.querySelectorAll('input[type="time"]');
    await user.clear(startInput);
    await user.type(startInput, "0600");
    await user.clear(endInput);
    await user.type(endInput, "1800");

    await user.click(screen.getByText("Add Load"));
    await user.type(screen.getAllByPlaceholderText("Amount (£)")[0], "150");
    await user.click(screen.getByText("Add Load"));
    await user.type(screen.getAllByPlaceholderText("Amount (£)")[1], "95.50");

    expect(await screen.findByText("£245.50")).toBeInTheDocument();

    await user.click(screen.getByText("Save Shift"));

    await user.click(within(sidebarNav()).getByText("History"));
    await screen.findByText(todayKey);
    expect(within(mainContent()).getByText("£245.50")).toBeInTheDocument();
    expect(within(mainContent()).getByText(/2 loads/)).toBeInTheDocument();

    const shift = (await db.shifts.query({ where: { date: todayKey } }))[0];
    const loads = await db.loads.query({ where: { shiftId: shift.id } });
    expect(loads).toHaveLength(2);
    expect(loads.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(245.5);

    // Dashboard's Expected gross now includes it too (via totalGross,
    // not the old totalBasePay+totalHolidayDiff sum, which would have
    // silently under-counted a per-load shift's pay). Today's-shift
    // card shows the same figure, so there are two matches, not one.
    await user.click(within(sidebarNav()).getByText("Dashboard"));
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(within(mainContent()).getAllByText("£245.50").length).toBeGreaterThan(0);

    // Edit round-trip: both loads repopulate; changing one and saving
    // replaces the Load rows rather than adding to them.
    await user.click(within(sidebarNav()).getByText("History"));
    const dateCell = await screen.findByText(todayKey);
    const shiftCard = dateCell.parentElement.parentElement.parentElement;
    await user.click(within(shiftCard).getByLabelText("Edit"));
    await screen.findByRole("heading", { name: "Edit Shift" });
    const editAmountInputs = await screen.findAllByPlaceholderText("Amount (£)");
    expect(editAmountInputs).toHaveLength(2);
    expect(editAmountInputs.map((el) => el.value).sort()).toEqual(["150", "95.5"]);

    // Load query order isn't guaranteed, so find the "150" row by its
    // known value rather than assuming index 0 — indexing blindly here
    // was flaky (~1-in-3), silently editing whichever row happened to
    // land first.
    const inputToEdit = editAmountInputs.find((el) => el.value === "150");
    await user.clear(inputToEdit);
    await user.type(inputToEdit, "200");
    await user.click(screen.getByText("Save Changes"));

    await screen.findByRole("heading", { name: "Dashboard" });
    const updatedLoads = await db.loads.query({ where: { shiftId: shift.id } });
    expect(updatedLoads).toHaveLength(2);
    expect(updatedLoads.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(295.5);
  });

  it("shows the Payslip tab without crashing", async () => {
    await bootAppWithLegacyData();
    const user = userEvent.setup();
    await user.click(within(sidebarNav()).getByText("Payslip"));
    expect(await screen.findByRole("heading", { name: "Payslip" })).toBeInTheDocument();
    expect(screen.getByText("My total")).toBeInTheDocument();
  });

  it("keeps the mobile bottom nav working and in sync with the sidebar", async () => {
    await bootAppWithLegacyData();
    const user = userEvent.setup();

    const nav = bottomNav();
    expect(within(nav).getByText("Week")).toBeInTheDocument();
    expect(within(nav).getByText("Add")).toBeInTheDocument();
    expect(within(nav).getByText("Payslip")).toBeInTheDocument();
    expect(within(nav).getByText("History")).toBeInTheDocument();

    await user.click(within(nav).getByText("History"));
    expect(await screen.findByRole("heading", { name: "History" })).toBeInTheDocument();
    // Sidebar's own History item reflects the same lifted tab state (single source of truth).
    expect(within(sidebarNav()).getByText("History").closest("button")).toHaveAttribute("aria-current", "page");
  });

  it("boots a true solo driver (no org membership at all) straight into the driver sidebar, unpriced", async () => {
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage); // seeds default compliance profile only, no legacy data
    const soloPersonId = "person-solo-smoke";
    await db.people.insert({ id: soloPersonId, name: "Solo Smoke Driver", email: null, createdAt: "now" });
    const wsId = "workspace-solo-smoke";
    await db.workspaces.insert({ id: wsId, kind: "personal", name: "Solo — Personal", ownerPersonId: soloPersonId, createdAt: "now" });
    await db.memberships.insert({ id: "membership-solo-smoke", workspaceId: wsId, personId: soloPersonId, roles: ["driver", "owner"], createdAt: "now" });
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, soloPersonId);

    render(<App />);
    expect(await screen.findByText("HGV HUB")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Independent Driver")).toBeInTheDocument();
    expect(screen.queryByLabelText("Switch workspace")).not.toBeInTheDocument();
  });

  it("a true solo driver (no company workspace at all) can set up and use Vehicle Check entirely within their own personal workspace", async () => {
    // Gap found 2026-08-03: Vehicles/Checklists management was only
    // wired into the company-side Management nav group, which never
    // appears for a driver with no manager-tier role anywhere (see
    // workspaceService.resolveSession — a role on one's OWN personal
    // workspace never counts as a "managerial membership"). Fixed by
    // also exposing them under the driver's own "Vehicle Check" nav
    // group, scoped to session.personalWorkspace.
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage); // no personal workspace exists yet -> migration 009 seeds nothing for this driver
    const soloPersonId = "person-solo-vc";
    await db.people.insert({ id: soloPersonId, name: "Solo VC Driver", email: null, createdAt: "now" });
    const wsId = "workspace-solo-vc";
    await db.workspaces.insert({ id: wsId, kind: "personal", name: "Solo VC — Personal", ownerPersonId: soloPersonId, createdAt: "now" });
    await db.memberships.insert({ id: "membership-solo-vc", workspaceId: wsId, personId: soloPersonId, roles: ["driver"], createdAt: "now" });
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, soloPersonId);

    render(<App />);
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(screen.queryByLabelText("Switch workspace")).not.toBeInTheDocument();
    const user = userEvent.setup();

    const nav = sidebarNav();
    expect(within(nav).getByText("Vehicles")).toBeInTheDocument();
    expect(within(nav).getByText("Checklists")).toBeInTheDocument();

    await user.click(within(nav).getByText("Vehicles"));
    await screen.findByRole("heading", { name: "Vehicles" });
    expect(within(mainContent()).getByText("No vehicles yet.")).toBeInTheDocument();
    await user.click(screen.getByText("Add Vehicle"));
    await user.type(screen.getByLabelText("Registration"), "solo van 1");
    await user.selectOptions(screen.getByLabelText("Type"), "Van");
    await user.click(screen.getByText("Save"));
    await screen.findByRole("heading", { name: "Vehicles" });
    expect(await within(mainContent()).findByText("SOLO VAN 1")).toBeInTheDocument();

    // No migration-seeded default here (this workspace didn't exist
    // when migration 009 ran) -> the driver creates their own.
    await user.click(within(nav).getByText("Checklists"));
    await screen.findByRole("heading", { name: "Checklists" });
    expect(within(mainContent()).getByText("No checklists yet.")).toBeInTheDocument();
    await user.click(screen.getByText("Add Checklist"));
    await user.type(screen.getByLabelText("Name"), "My own checklist");
    await user.click(screen.getByText("Add item"));
    await user.type(screen.getByPlaceholderText("Category"), "General");
    await user.type(screen.getByPlaceholderText("Check item"), "Walk around the vehicle");
    await user.click(screen.getByText("Save"));
    await screen.findByRole("heading", { name: "Checklists" });
    await user.click(await screen.findByText("Set as default"));

    await user.click(within(nav).getByText("New Check"));
    await screen.findByRole("heading", { name: "New Vehicle Check" });
    // TEMPORARY CI DIAGNOSTIC — remove once understood.
    if (!screen.queryByText("Walk around the vehicle")) {
      const tpls = await db.checklistTemplates.query({ where: { workspaceId: wsId } });
      // eslint-disable-next-line no-console
      console.log("SOLO-DIAG", JSON.stringify({
        templates: tpls.map((t) => ({ name: t.name, isDefault: t.isDefault,
          items: (t.items || []).map((i) => ({ label: i.label, category: i.category })) })),
        mainText: mainContent().textContent.replace(/\s+/g, " ").slice(0, 500),
      }));
    }
    expect(screen.getByText("Walk around the vehicle")).toBeInTheDocument();
    await user.click(screen.getByText("OK"));
    await user.type(screen.getByLabelText("Your name (sign-off)"), "Solo VC Driver");
    await user.click(screen.getByText("Save Check"));

    await screen.findByRole("heading", { name: "Check History" });
    expect(await within(mainContent()).findByText("SOLO VAN 1")).toBeInTheDocument();
    expect(within(mainContent()).getByText("OK")).toBeInTheDocument();

    const checks = await db.vehicleChecks.query({ where: { driverId: soloPersonId } });
    expect(checks).toHaveLength(1);
    expect(checks[0].workspaceId).toBe(wsId);
    expect(checks[0].overallResult).toBe("ok");
  });

  it("Workplaces: add a second workplace, set it as the explicit default, and see it reflected in the Add Shift picker", async () => {
    const db = await bootAppWithLegacyData(); // Alex, one active workplace already (Example Driver Agency/Example Logistics)
    const user = userEvent.setup();

    await user.click(within(sidebarNav()).getByText("Workplaces"));
    await screen.findByRole("heading", { name: "Workplaces" });
    // Exact title text, not a loose regex — the rate-card-lineage name
    // in the subtitle line below ALSO contains "Example Driver Agency"/"Example Logistics".
    expect(await within(mainContent()).findByText("Example Driver Agency · Example Logistics Depot A")).toBeInTheDocument();

    await user.click(screen.getByText("Add Workplace"));
    await screen.findByRole("heading", { name: "Add Workplace" });
    const orgNameInputs = screen.getAllByPlaceholderText("Organisation name");
    await user.type(orgNameInputs[0], "Second Agency");
    await user.type(orgNameInputs[1], "Second Client");
    await user.type(screen.getByLabelText("Site name"), "Second Site");
    await user.type(screen.getByLabelText("Rate card name"), "Second Rates");
    await user.click(screen.getByText("Save"));

    await screen.findByRole("heading", { name: "Workplaces" });
    expect(await within(mainContent()).findByText("Second Agency · Second Site")).toBeInTheDocument();
    // Neither workplace has an explicit default yet -> both offer "Set as default".
    expect(within(mainContent()).getAllByText("Set as default")).toHaveLength(2);

    const secondAgencyTitle = within(mainContent()).getByText("Second Agency · Second Site");
    const secondAgencyRow = secondAgencyTitle.parentElement.parentElement;
    await user.click(within(secondAgencyRow).getByText("Set as default"));

    // Now exactly one row is missing the button (the one just made default).
    await waitFor(() => expect(within(mainContent()).getAllByText("Set as default")).toHaveLength(1));

    const site = (await db.sites.query({ where: { name: "Second Site" } }))[0];
    const placement = (await db.placements.query({ where: { siteId: site.id } }))[0];
    const newAssignment = (await db.assignments.query({ where: { placementId: placement.id } }))[0];

    await user.click(within(sidebarNav()).getByText("Add Shift"));
    await screen.findByRole("heading", { name: "Add Shift" });
    expect(await screen.findByLabelText("Job / employer")).toHaveProperty("value", newAssignment.id);

    const profile = (
      await db.driverProfiles.query({ where: { personId: "person-demo", workspaceId: "workspace-personal-demo" } })
    )[0];
    expect(profile.preferredAssignmentId).toBe(newAssignment.id);
  });

  it("Workplaces: adding a 'per load' workplace skips the hourly rate grid entirely (Per-Load Pay Stage PL-1)", async () => {
    const db = await bootAppWithLegacyData();
    const user = userEvent.setup();

    await user.click(within(sidebarNav()).getByText("Workplaces"));
    await screen.findByRole("heading", { name: "Workplaces" });
    await user.click(screen.getByText("Add Workplace"));
    await screen.findByRole("heading", { name: "Add Workplace" });

    const orgNameInputs = screen.getAllByPlaceholderText("Organisation name");
    await user.type(orgNameInputs[0], "Amazon Relay");
    await user.type(orgNameInputs[1], "Spot Load Client");
    await user.type(screen.getByLabelText("Site name"), "Spot Load Site");
    await user.type(screen.getByLabelText("Rate card name"), "Spot Loads");
    // Grid visible by default (hourly) — "Base" is a column header repeated once per window (Days/Lates/Nights).
    expect(screen.getAllByText("Base").length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText("Pay type"), "Per load");
    expect(screen.queryAllByText("Base")).toHaveLength(0);
    expect(screen.getByText(/no rate grid to set here/)).toBeInTheDocument();

    await user.click(screen.getByText("Save"));
    await screen.findByRole("heading", { name: "Workplaces" });
    expect(await within(mainContent()).findByText("Amazon Relay · Spot Load Site")).toBeInTheDocument();
    expect(within(mainContent()).getByText(/Per load/)).toBeInTheDocument();

    const lineage = (await db.rateCardLineages.query({ where: { name: "Spot Loads" } }))[0];
    expect(lineage.payType).toBe("per_load");
  });

  it("Documents (DE-1): add a document, see its status reflected on the Dashboard, then renew it", async () => {
    const db = await bootAppWithLegacyData();
    const user = userEvent.setup();

    const soon = toKey(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000));
    const farFuture = toKey(new Date(Date.now() + 500 * 24 * 60 * 60 * 1000));

    await user.click(within(sidebarNav()).getByText("Documents"));
    await screen.findByRole("heading", { name: "Documents" });
    expect(within(mainContent()).getByText("No documents tracked yet.")).toBeInTheDocument();

    await user.click(screen.getByText("Add Document"));
    await screen.findByRole("heading", { name: "Add Document" });
    await user.selectOptions(screen.getByLabelText("Document type"), "CPC card");
    const addDateInput = document.querySelector('input[type="date"]');
    await user.clear(addDateInput);
    await user.type(addDateInput, soon);
    await user.click(screen.getByText("Save"));

    await screen.findByRole("heading", { name: "Documents" });
    expect(await within(mainContent()).findByText("CPC card")).toBeInTheDocument();
    expect(within(mainContent()).getByText("Expiring soon")).toBeInTheDocument();

    // The Dashboard's own tile reflects the same driver-document status.
    await user.click(within(sidebarNav()).getByText("Dashboard"));
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(await within(mainContent()).findByText("Renewal due soon")).toBeInTheDocument();

    // Renew — the old row is archived, a new active one carries the new date.
    await user.click(within(sidebarNav()).getByText("Documents"));
    await screen.findByRole("heading", { name: "Documents" });
    await user.click(screen.getByLabelText("Renew"));
    await screen.findByRole("heading", { name: "Renew Document" });
    const renewDateInput = document.querySelector('input[type="date"]');
    await user.clear(renewDateInput);
    await user.type(renewDateInput, farFuture);
    await user.click(screen.getByText("Confirm Renewal"));

    await screen.findByRole("heading", { name: "Documents" });
    expect(await within(mainContent()).findByText("OK")).toBeInTheDocument();
    expect(within(mainContent()).queryByText("Expiring soon")).not.toBeInTheDocument();

    const documents = await db.driverDocuments.query({ where: { personId: "person-demo" } });
    expect(documents).toHaveLength(2);
    const active = documents.filter((d) => !d.archivedAt);
    expect(active).toHaveLength(1);
    expect(active[0].expiryDate).toBe(farFuture);
    expect(documents.find((d) => d.id !== active[0].id).archivedAt).not.toBeNull();

    await user.click(within(sidebarNav()).getByText("Dashboard"));
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(await within(mainContent()).findByText("All up to date")).toBeInTheDocument();
  });

  it("CPC Training (CPC-1): the cycle is derived from the driver's cpc_card document, and logging sessions moves the status from Behind to OK", async () => {
    await bootAppWithLegacyData();
    const user = userEvent.setup();

    // Before any cpc_card document exists, the cycle can't be resolved.
    await user.click(within(sidebarNav()).getByText("CPC Training"));
    await screen.findByRole("heading", { name: "CPC Training" });
    expect(await within(mainContent()).findByText("Add your CPC card under Documents to track your cycle")).toBeInTheDocument();

    // Add a cpc_card document — this is what anchors the training cycle.
    await user.click(within(sidebarNav()).getByText("Documents"));
    await screen.findByRole("heading", { name: "Documents" });
    await user.click(screen.getByText("Add Document"));
    await screen.findByRole("heading", { name: "Add Document" });
    await user.selectOptions(screen.getByLabelText("Document type"), "CPC card");
    const cardDateInput = document.querySelector('input[type="date"]');
    await user.clear(cardDateInput);
    await user.type(cardDateInput, "2030-01-01");
    await user.click(screen.getByText("Save"));
    await screen.findByRole("heading", { name: "Documents" });

    // Back on CPC Training, the cycle now resolves — 0/35h, Behind.
    await user.click(within(sidebarNav()).getByText("CPC Training"));
    await screen.findByRole("heading", { name: "CPC Training" });
    expect(await within(mainContent()).findByText("0/35h · cycle ends 2030-01-01")).toBeInTheDocument();
    expect(within(mainContent()).getByText("Behind")).toBeInTheDocument();

    // Log a 20h session — still Behind (< 35h).
    await user.click(screen.getByText("Log Training"));
    await screen.findByRole("heading", { name: "Log Training" });
    const hoursInput = screen.getByLabelText("Hours");
    await user.clear(hoursInput);
    await user.type(hoursInput, "20");
    await user.click(screen.getByText("Save"));

    await screen.findByRole("heading", { name: "CPC Training" });
    expect(await within(mainContent()).findByText("20/35h · cycle ends 2030-01-01")).toBeInTheDocument();
    expect(within(mainContent()).getByText("Behind")).toBeInTheDocument();

    // Log another 15h session — total 35h, now OK.
    await user.click(screen.getByText("Log Training"));
    await screen.findByRole("heading", { name: "Log Training" });
    const secondHoursInput = screen.getByLabelText("Hours");
    await user.clear(secondHoursInput);
    await user.type(secondHoursInput, "15");
    await user.click(screen.getByText("Save"));

    await screen.findByRole("heading", { name: "CPC Training" });
    expect(await within(mainContent()).findByText("35/35h · cycle ends 2030-01-01")).toBeInTheDocument();
    expect(within(mainContent()).getByText("OK")).toBeInTheDocument();

    // The Dashboard's own CPC Training tile reflects the same status.
    await user.click(within(sidebarNav()).getByText("Dashboard"));
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(await within(mainContent()).findByText("35/35h · cycle ends 2030-01-01")).toBeInTheDocument();
  });

  it("Reminders: an expired driver document surfaces as a banner on the Dashboard, the default landing screen", async () => {
    await bootAppWithLegacyData();
    const user = userEvent.setup();

    await user.click(within(sidebarNav()).getByText("Documents"));
    await screen.findByRole("heading", { name: "Documents" });
    await user.click(screen.getByText("Add Document"));
    await screen.findByRole("heading", { name: "Add Document" });
    const dateInput = document.querySelector('input[type="date"]');
    await user.clear(dateInput);
    await user.type(dateInput, "2020-01-01");
    await user.click(screen.getByText("Save"));
    await screen.findByRole("heading", { name: "Documents" });

    await user.click(within(sidebarNav()).getByText("Dashboard"));
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(await within(mainContent()).findByText(/Driving licence expired 2020-01-01/)).toBeInTheDocument();
  });

  it("Vehicle Check: pairing a trailer walks the checklist twice in one submission, with defects attributed to the correct vehicle", async () => {
    const db = await bootAppWithLegacyData();
    const user = userEvent.setup();
    const nav = sidebarNav();

    // A lightweight custom checklist (1 item), same trick the solo-driver
    // VC test uses, so the paired walkthrough doesn't require clicking
    // through the full 23-item DVSA default twice.
    await user.click(within(nav).getByText("Checklists"));
    await screen.findByRole("heading", { name: "Checklists" });
    await user.click(screen.getByText("Add Checklist"));
    await user.type(screen.getByLabelText("Name"), "Quick checklist");
    await user.click(screen.getByText("Add item"));
    await user.type(screen.getByPlaceholderText("Category"), "General");
    await user.type(screen.getByPlaceholderText("Check item"), "Lights");
    await user.click(screen.getByText("Save"));
    await screen.findByRole("heading", { name: "Checklists" });
    await user.click(await screen.findByText("Set as default"));

    await user.click(within(nav).getByText("Vehicles"));
    await screen.findByRole("heading", { name: "Vehicles" });
    await user.click(screen.getByText("Add Vehicle"));
    await user.type(screen.getByLabelText("Registration"), "tractor1");
    await user.selectOptions(screen.getByLabelText("Type"), "Tractor unit");
    await user.click(screen.getByText("Save"));
    await screen.findByRole("heading", { name: "Vehicles" });
    await user.click(screen.getByText("Add Vehicle"));
    await user.type(screen.getByLabelText("Registration"), "trailer1");
    await user.selectOptions(screen.getByLabelText("Type"), "Trailer");
    await user.click(screen.getByText("Save"));
    await screen.findByRole("heading", { name: "Vehicles" });

    await user.click(within(nav).getByText("New Check"));
    await screen.findByRole("heading", { name: "New Vehicle Check" });
    await user.selectOptions(screen.getByLabelText("Vehicle"), "TRACTOR1");
    await user.selectOptions(await screen.findByLabelText("Paired trailer (optional)"), "TRAILER1");

    expect(await screen.findByText("Tractor unit")).toBeInTheDocument();
    expect(screen.getByText("Trailer")).toBeInTheDocument();
    const lightsRows = screen.getAllByText("Lights");
    expect(lightsRows).toHaveLength(2); // one per pass

    // Tractor's own "Lights" -> OK; trailer's own "Lights" -> Defect.
    const okButtons = screen.getAllByText("OK");
    const defectButtons = screen.getAllByText("Defect");
    await user.click(okButtons[0]);
    await user.click(defectButtons[1]);
    await user.type(screen.getByPlaceholderText("Describe the defect"), "Trailer marker light out");
    await user.type(screen.getByLabelText("Your name (sign-off)"), "Alex Demo");
    await user.click(screen.getByText("Save Check"));

    await screen.findByRole("heading", { name: "Check History" });
    expect(await within(mainContent()).findByText("TRACTOR1 + TRAILER1")).toBeInTheDocument();
    expect(within(mainContent()).getByText("Defects found")).toBeInTheDocument();

    const tractor = (await db.vehicles.query({ where: { registration: "TRACTOR1" } }))[0];
    const trailer = (await db.vehicles.query({ where: { registration: "TRAILER1" } }))[0];
    const checks = await db.vehicleChecks.query({ where: { vehicleId: tractor.id } });
    expect(checks).toHaveLength(1);
    expect(checks[0].pairedVehicleId).toBe(trailer.id);

    const defects = await db.defects.query({ where: { raisedFromCheckId: checks[0].id } });
    expect(defects).toHaveLength(1);
    expect(defects[0].vehicleId).toBe(trailer.id);
  });
});

describe("AppShell — sidebar collapse and mobile drawer", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await resetIndexedDb();
  });
  afterEach(() => {
    cleanup();
  });

  it("toggles collapsed state and persists it to localStorage", async () => {
    await bootAppWithLegacyData();
    const user = userEvent.setup();

    const collapseBtn = screen.getByLabelText("Collapse sidebar");
    expect(document.querySelector(".shell-root--collapsed")).not.toBeInTheDocument();

    await user.click(collapseBtn);
    expect(document.querySelector(".shell-root--collapsed")).toBeInTheDocument();
    expect(window.localStorage.getItem("wt-shell-sidebar-collapsed")).toBe("1");
    expect(screen.getByLabelText("Expand sidebar")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Expand sidebar"));
    expect(document.querySelector(".shell-root--collapsed")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("wt-shell-sidebar-collapsed")).toBe("0");
  });

  it("opens and closes the mobile drawer via hamburger and overlay", async () => {
    await bootAppWithLegacyData();
    const user = userEvent.setup();

    const sidebar = document.getElementById("app-sidebar");
    expect(sidebar.className).not.toMatch(/shell-sidebar--mobile-open/);

    await user.click(screen.getByLabelText("Open navigation"));
    expect(sidebar.className).toMatch(/shell-sidebar--mobile-open/);

    await user.click(screen.getByLabelText("Close navigation"));
    expect(sidebar.className).not.toMatch(/shell-sidebar--mobile-open/);
  });

  it("closes the mobile drawer when a nav item is clicked", async () => {
    await bootAppWithLegacyData();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText("Open navigation"));
    const sidebar = document.getElementById("app-sidebar");
    expect(sidebar.className).toMatch(/shell-sidebar--mobile-open/);

    await user.click(within(sidebarNav()).getByText("Payslip"));
    expect(sidebar.className).not.toMatch(/shell-sidebar--mobile-open/);
  });
});

describe("AppShell — company experience and workspace switching", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await resetIndexedDb();
  });
  afterEach(() => {
    cleanup();
  });

  it("shows the workspace switcher only for a manager-tier person, and switches nav + content", async () => {
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    const seed = await seedSecondCompany(db);
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, seed.ownerPersonId);

    render(<App />);

    const switcher = await screen.findByLabelText("Switch workspace");
    expect(within(switcher).getByText("Northline Transport Ltd")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(switcher, screen.getByText("Northline Transport Ltd"));

    // Nav flips from Driver group to Management group — no hardcoded company name in the nav itself.
    const nav = sidebarNav();
    expect(within(nav).getByText("Management")).toBeInTheDocument();
    expect(within(nav).getByText("Drivers")).toBeInTheDocument();
    expect(within(nav).queryByText("Dashboard")).not.toBeInTheDocument();

    expect(await screen.findByRole("heading", { name: "Drivers" })).toBeInTheDocument();
    expect(screen.getByText(/3 active drivers/)).toBeInTheDocument();
  });

  it("Management group: Organisations and Sites are navigable and reflect the real corrected data", async () => {
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, "person-demo");
    // Alex's own membership in Example Driver Agency is driver-only — give him
    // a manager-tier role there too so the switcher/Management group appears.
    const membership = (await db.memberships.query({ where: { workspaceId: "workspace-demo-agency", personId: "person-demo" } }))[0];
    await db.memberships.update(membership.id, { roles: [...membership.roles, "owner"] });

    render(<App />);
    const switcher = await screen.findByLabelText("Switch workspace");
    const user = userEvent.setup();
    await user.selectOptions(switcher, screen.getByText("Example Driver Agency"));

    const nav = sidebarNav();
    expect(within(nav).getByText("Management")).toBeInTheDocument();

    await user.click(within(nav).getByText("Organisations"));
    expect(await screen.findByRole("heading", { name: "Organisations" })).toBeInTheDocument();
    // Example Driver Agency's own self-org and the corrected Example Logistics client org both show up.
    expect(await within(mainContent()).findByText("Example Driver Agency")).toBeInTheDocument();
    expect(within(mainContent()).getByText("Example Logistics")).toBeInTheDocument();

    await user.click(within(nav).getByText("Sites"));
    expect(await screen.findByRole("heading", { name: "Sites" })).toBeInTheDocument();
    expect(await within(mainContent()).findByText(/Example Logistics Depot A/)).toBeInTheDocument();
    // Site now correctly shows the CLIENT org (Example Logistics), not Example Driver Agency's own org.
    expect(within(mainContent()).getByText(/Example Logistics · Client site/)).toBeInTheDocument();
  });

  it("Add Organisation end to end: form -> service -> list refresh, via the real UI", async () => {
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, "person-demo");
    const membership = (await db.memberships.query({ where: { workspaceId: "workspace-demo-agency", personId: "person-demo" } }))[0];
    await db.memberships.update(membership.id, { roles: [...membership.roles, "owner"] });

    render(<App />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Switch workspace"), screen.getByText("Example Driver Agency"));
    await user.click(within(sidebarNav()).getByText("Organisations"));
    await screen.findByRole("heading", { name: "Organisations" });

    await user.click(screen.getByText("Add Organisation"));
    await screen.findByRole("heading", { name: "Add Organisation" });

    await user.type(screen.getByLabelText("Legal name"), "Test Client Ltd");
    await user.type(screen.getByLabelText("Trading name"), "Test Client");
    await user.click(screen.getByText("Client"));
    await user.click(screen.getByText("Save"));

    await screen.findByRole("heading", { name: "Organisations" });
    expect(await screen.findByText("Test Client")).toBeInTheDocument();

    // Persisted for real, not just in React state — reload confirms it.
    expect(await db.organisations.query({ where: { tradingName: "Test Client" } })).toHaveLength(1);
  });

  it("Rate Cards: list shows the real Example/Example Logistics lineage; create, revise, and archive all work end to end", async () => {
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, "person-demo");
    const membership = (await db.memberships.query({ where: { workspaceId: "workspace-demo-agency", personId: "person-demo" } }))[0];
    await db.memberships.update(membership.id, { roles: [...membership.roles, "owner"] });

    render(<App />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Switch workspace"), screen.getByText("Example Driver Agency"));
    await user.click(within(sidebarNav()).getByText("Rate Cards"));
    await screen.findByRole("heading", { name: "Rate Cards" });

    // The real, migrated Example Driver Agency/Example Logistics lineage shows as one card, one version.
    expect(await within(mainContent()).findByText(/Example Driver Agency.*Example Logistics/)).toBeInTheDocument();
    expect(within(mainContent()).getByText(/1 version/)).toBeInTheDocument();

    // Create a brand-new lineage.
    await user.click(screen.getByText("Create Rate Card"));
    await screen.findByRole("heading", { name: "Create Rate Card" });
    await user.type(screen.getByLabelText("Name"), "FedEx Rotherham Standard");
    const dateInput = document.querySelector('input[type="date"]');
    await user.clear(dateInput);
    await user.type(dateInput, "2026-01-01");
    await user.click(screen.getByText("Save"));

    await screen.findByRole("heading", { name: "Rate Cards" });
    expect(await within(mainContent()).findByText("FedEx Rotherham Standard")).toBeInTheDocument();

    // Open its detail and revise it.
    await user.click(within(mainContent()).getByText("FedEx Rotherham Standard"));
    await screen.findByRole("heading", { name: "FedEx Rotherham Standard" });
    expect(within(mainContent()).getByText(/Effective from 2026-01-01/)).toBeInTheDocument();
    expect(within(mainContent()).getByText(/only rate this lineage has had/)).toBeInTheDocument();

    await user.click(screen.getByText("Create new version"));
    await screen.findByRole("heading", { name: "New Version" });
    const reviseDateInput = document.querySelector('input[type="date"]');
    await user.clear(reviseDateInput);
    await user.type(reviseDateInput, "2026-06-01");
    await user.click(screen.getByText("Save"));

    await screen.findByRole("heading", { name: "FedEx Rotherham Standard" });
    expect(within(mainContent()).getByText(/Effective from 2026-06-01/)).toBeInTheDocument();
    // The 2026-01-01 version now appears under Previous rates.
    expect(within(mainContent()).getByText("Previous rates")).toBeInTheDocument();
    expect(within(mainContent()).getByText(/Effective from 2026-01-01/)).toBeInTheDocument();

    // Archive it.
    await user.click(screen.getByText("Archive"));
    await screen.findByText("Archive this Rate Card?");
    await user.click(screen.getAllByText("Archive").at(-1));
    expect(await within(mainContent()).findByText("Archived")).toBeInTheDocument();

    // Persisted for real.
    const lineages = await db.rateCardLineages.query({ where: { name: "FedEx Rotherham Standard" } });
    expect(lineages).toHaveLength(1);
    expect(lineages[0].archivedAt).toBeTruthy();
    const versions = await db.rateCards.query({ where: { lineageId: lineages[0].id } });
    expect(versions).toHaveLength(2);
  });

  it("Rate Cards: creating a 'per load' rate card skips the hourly rate grid entirely (Per-Load Pay Stage PL-1)", async () => {
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, "person-demo");
    const membership = (await db.memberships.query({ where: { workspaceId: "workspace-demo-agency", personId: "person-demo" } }))[0];
    await db.memberships.update(membership.id, { roles: [...membership.roles, "owner"] });

    render(<App />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Switch workspace"), screen.getByText("Example Driver Agency"));
    await user.click(within(sidebarNav()).getByText("Rate Cards"));
    await screen.findByRole("heading", { name: "Rate Cards" });

    await user.click(screen.getByText("Create Rate Card"));
    await screen.findByRole("heading", { name: "Create Rate Card" });
    await user.type(screen.getByLabelText("Name"), "Amazon Relay Spot Loads");
    // Grid visible by default (hourly) — "Base" is a column header repeated once per window (Days/Lates/Nights).
    expect(screen.getAllByText("Base").length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText("Pay type"), "Per load");
    expect(screen.queryAllByText("Base")).toHaveLength(0);
    expect(screen.getByText(/no rate grid to set here/)).toBeInTheDocument();

    const dateInput = document.querySelector('input[type="date"]');
    await user.clear(dateInput);
    await user.type(dateInput, "2026-01-01");
    await user.click(screen.getByText("Save"));

    await screen.findByRole("heading", { name: "Rate Cards" });
    expect(await within(mainContent()).findByText(/Amazon Relay Spot Loads/)).toBeInTheDocument();
    expect(within(mainContent()).getByText(/Per load/)).toBeInTheDocument();

    await user.click(within(mainContent()).getByText("Amazon Relay Spot Loads"));
    await screen.findByRole("heading", { name: "Amazon Relay Spot Loads" });
    expect(within(mainContent()).getByText(/no rate grid to set here/)).toBeInTheDocument();
    expect(within(mainContent()).queryAllByText("Base")).toHaveLength(0);

    const lineage = (await db.rateCardLineages.query({ where: { name: "Amazon Relay Spot Loads" } }))[0];
    expect(lineage.payType).toBe("per_load");
    const version = (await db.rateCards.query({ where: { lineageId: lineage.id } }))[0];
    expect(version.rates).toEqual({});
  });

  it("Vehicles: add a vehicle end to end via the real UI (VC-1)", async () => {
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, "person-demo");
    const membership = (await db.memberships.query({ where: { workspaceId: "workspace-demo-agency", personId: "person-demo" } }))[0];
    await db.memberships.update(membership.id, { roles: [...membership.roles, "owner"] });

    render(<App />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Switch workspace"), screen.getByText("Example Driver Agency"));
    await user.click(within(sidebarNav()).getByText("Vehicles"));
    await screen.findByRole("heading", { name: "Vehicles" });
    expect(within(mainContent()).getByText("No vehicles yet.")).toBeInTheDocument();

    await user.click(screen.getByText("Add Vehicle"));
    await screen.findByRole("heading", { name: "Add Vehicle" });
    await user.type(screen.getByLabelText("Registration"), "ab12 cde");
    await user.selectOptions(screen.getByLabelText("Type"), "Tractor unit");
    await user.type(screen.getByLabelText("Make"), "DAF");
    await user.type(screen.getByLabelText("Model"), "XF");
    await user.click(screen.getByText("Save"));

    await screen.findByRole("heading", { name: "Vehicles" });
    // Registration is upper-cased by the form as the user types.
    expect(await within(mainContent()).findByText("AB12 CDE")).toBeInTheDocument();
    expect(within(mainContent()).getByText(/Tractor unit.*DAF XF/)).toBeInTheDocument();

    const vehicles = await db.vehicles.query({ where: { registration: "AB12 CDE" } });
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].vehicleType).toBe("tractor_unit");
  });

  it("Checklist Templates: migration seeds a default, create a new one and set it as the default (VC-1)", async () => {
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, "person-demo");
    const membership = (await db.memberships.query({ where: { workspaceId: "workspace-demo-agency", personId: "person-demo" } }))[0];
    await db.memberships.update(membership.id, { roles: [...membership.roles, "owner"] });

    render(<App />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Switch workspace"), screen.getByText("Example Driver Agency"));
    await user.click(within(sidebarNav()).getByText("Checklists"));
    await screen.findByRole("heading", { name: "Checklists" });

    // Migration 009's seeded default is already there, already marked default.
    expect(await within(mainContent()).findByText("Daily walkaround (default)")).toBeInTheDocument();
    expect(within(mainContent()).queryByText("Set as default")).not.toBeInTheDocument();

    await user.click(screen.getByText("Add Checklist"));
    await screen.findByRole("heading", { name: "Add Checklist" });
    await user.type(screen.getByLabelText("Name"), "Custom pre-trip checklist");
    await user.click(screen.getByText("Add item"));
    await user.type(screen.getByPlaceholderText("Category"), "Custom");
    await user.type(screen.getByPlaceholderText("Check item"), "ADR plates present");
    await user.click(screen.getByText("Save"));

    await screen.findByRole("heading", { name: "Checklists" });
    expect(await within(mainContent()).findByText("Custom pre-trip checklist")).toBeInTheDocument();
    // Not yet default -> offers "Set as default"; the seeded one still is.
    expect(within(mainContent()).getAllByText("Set as default")).toHaveLength(1);

    await user.click(screen.getByText("Set as default"));

    // The flag flips: the new template loses its "Set as default" button,
    // the old default gains one back.
    await screen.findByRole("heading", { name: "Checklists" });
    expect(within(mainContent()).getAllByText("Set as default")).toHaveLength(1);

    const templates = await db.checklistTemplates.query({ where: { workspaceId: "workspace-demo-agency" } });
    const defaults = templates.filter((t) => t.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].name).toBe("Custom pre-trip checklist");
  });

  it("Defects (VC-3): a failed check item auto-raises a Defect, and its status workflow closes the loop back into Check History", async () => {
    window.localStorage.setItem(STORAGE_KEYS.LEGACY_SHIFTS, JSON.stringify(LEGACY_SHIFTS));
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    const vehicle = await createVehicle(
      { workspaceId: "workspace-demo-agency", registration: "AB12 CDE", vehicleType: "tractor_unit" },
      db
    );
    const template = await createChecklistTemplate(
      {
        workspaceId: "workspace-demo-agency",
        name: "Quick check",
        items: [
          { code: "tyres", label: "Tyres", category: "Exterior" },
          { code: "lights", label: "Lights", category: "Exterior" },
        ],
      },
      db
    );
    await setDefaultChecklistTemplate(template.id, "workspace-demo-agency", db);
    const membership = (await db.memberships.query({ where: { workspaceId: "workspace-demo-agency", personId: "person-demo" } }))[0];
    await db.memberships.update(membership.id, { roles: [...membership.roles, "owner"] });

    render(<App />);
    await screen.findByRole("heading", { name: "Dashboard" });
    const user = userEvent.setup();

    // 1. Submit a check with one defect, driver side.
    await user.click(within(sidebarNav()).getByText("New Check"));
    await screen.findByRole("heading", { name: "New Vehicle Check" });
    await user.click(screen.getAllByText("OK")[0]); // Tyres -> OK
    await user.click(screen.getAllByText("Defect")[1]); // Lights -> Defect
    await user.type(screen.getByPlaceholderText("Describe the defect"), "Cracked lens");
    await user.type(screen.getByLabelText("Your name (sign-off)"), "Alex Demo");
    await user.click(screen.getByText("Save Check"));
    await screen.findByRole("heading", { name: "Check History" });

    // The just-raised defect starts "Open" in the driver's own history view too,
    // and the check-level badge still reads the alarming "Defects found"
    // (only flips to "Defect resolved" once the defect actually is).
    expect(await within(mainContent()).findByText("Open")).toBeInTheDocument();
    expect(within(mainContent()).getByText("Defects found")).toBeInTheDocument();
    expect(within(mainContent()).getByText(/Lights.*Cracked lens/)).toBeInTheDocument();

    // 2. Switch to the company view and manage the defect through its workflow.
    await user.selectOptions(await screen.findByLabelText("Switch workspace"), screen.getByText("Example Driver Agency"));
    await user.click(within(sidebarNav()).getByText("Defects"));
    await screen.findByRole("heading", { name: "Defects" });

    expect(await within(mainContent()).findByText("AB12 CDE")).toBeInTheDocument();
    expect(within(mainContent()).getByText("Lights: Cracked lens")).toBeInTheDocument();
    expect(within(mainContent()).getByText("Minor")).toBeInTheDocument();
    expect(within(mainContent()).getByText("Open")).toBeInTheDocument();

    await user.click(within(mainContent()).getByText("Mark as reported"));
    expect(await within(mainContent()).findByText("Reported")).toBeInTheDocument();

    await user.click(within(mainContent()).getByText("Mark as in progress"));
    expect(await within(mainContent()).findByText("In progress")).toBeInTheDocument();

    await user.click(within(mainContent()).getByText("Resolve"));
    await user.type(screen.getByPlaceholderText("Resolution notes (optional)"), "Replaced the lens");
    await user.click(within(mainContent()).getByText("Confirm resolved"));

    expect(await within(mainContent()).findByText("Resolved")).toBeInTheDocument();
    expect(within(mainContent()).getByText("Resolved: Replaced the lens")).toBeInTheDocument();

    // 3. Back on the driver side, Check History now reflects the resolution
    // — including the check-level badge, which stops saying the alarming
    // "Defects found" once every defect it raised is resolved (the raw
    // overallResult field itself stays pinned/unchanged; only the
    // DISPLAYED badge is smarter — see VehicleCheckApp's `allResolved`).
    await user.selectOptions(await screen.findByLabelText("Switch workspace"), screen.getByText("Alex — Personal"));
    await user.click(within(sidebarNav()).getByText("Check History"));
    await screen.findByRole("heading", { name: "Check History" });
    expect(await within(mainContent()).findByText("Defect resolved")).toBeInTheDocument();
    expect(within(mainContent()).queryByText("Defects found")).not.toBeInTheDocument();
    expect(within(mainContent()).getByText("Resolved")).toBeInTheDocument(); // per-item defect status badge
    expect(within(mainContent()).getByText("Resolved: Replaced the lens")).toBeInTheDocument();

    const defects = await db.defects.query({ where: { vehicleId: vehicle.id } });
    expect(defects).toHaveLength(1);
    expect(defects[0].status).toBe("resolved");
    expect(defects[0].resolvedNotes).toBe("Replaced the lens");
  });

  it("company drilldown shows the exact same Shift record as the driver's own view (no duplication)", async () => {
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    const seed = await seedSecondCompany(db);
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, seed.ownerPersonId);

    render(<App />);
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("Switch workspace"), screen.getByText("Northline Transport Ltd"));
    await user.click(within(sidebarNav()).getByText("Drivers"));

    const driverPerson = await db.people.getById(seed.drivers[0].personId);
    const driverDisplayName = resolvePersonDisplayName(driverPerson);
    await user.click(await screen.findByText(driverDisplayName));

    expect(await screen.findByRole("heading", { name: driverDisplayName })).toBeInTheDocument();
    const driverShifts = await db.shifts.query({ where: { driverId: driverPerson.id } });
    const driverShift = driverShifts[0];
    expect(await screen.findByText(driverShift.date)).toBeInTheDocument();
    // Exactly one row for this shift id anywhere in the shared collection.
    const allShifts = await db.shifts.getAll();
    expect(allShifts.filter((s) => s.id === driverShift.id)).toHaveLength(1);
  });

  it("Documents (DE-2): company drilldown shows a driver's document status read-only, with no edit controls", async () => {
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    const seed = await seedSecondCompany(db);
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, seed.ownerPersonId);

    const driverPersonId = seed.drivers[0].personId;
    const soon = toKey(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000));
    await createDriverDocument({ personId: driverPersonId, documentType: "driving_licence", expiryDate: soon }, db);

    render(<App />);
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("Switch workspace"), screen.getByText("Northline Transport Ltd"));
    await user.click(within(sidebarNav()).getByText("Drivers"));

    const driverPerson = await db.people.getById(driverPersonId);
    const driverDisplayName = resolvePersonDisplayName(driverPerson);
    await user.click(await screen.findByText(driverDisplayName));

    expect(await screen.findByRole("heading", { name: driverDisplayName })).toBeInTheDocument();
    expect(await within(mainContent()).findByText("Driving licence")).toBeInTheDocument();
    expect(within(mainContent()).getByText("Expiring soon")).toBeInTheDocument();

    // Read-only — none of the driver's own edit/renew/archive controls appear here.
    expect(screen.queryByLabelText("Renew")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Edit")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Archive")).not.toBeInTheDocument();
  });

  it("CPC Training (CPC-2): company drilldown shows a driver's CPC cycle status and sessions read-only, with no logging control", async () => {
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    const seed = await seedSecondCompany(db);
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, seed.ownerPersonId);

    const driverPersonId = seed.drivers[0].personId;
    await createDriverDocument({ personId: driverPersonId, documentType: "cpc_card", expiryDate: "2030-01-01" }, db);
    await logCpcTraining({ personId: driverPersonId, date: "2026-01-01", hours: 20, provider: "Acme Training" }, db);

    render(<App />);
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("Switch workspace"), screen.getByText("Northline Transport Ltd"));
    await user.click(within(sidebarNav()).getByText("Drivers"));

    const driverPerson = await db.people.getById(driverPersonId);
    const driverDisplayName = resolvePersonDisplayName(driverPerson);
    await user.click(await screen.findByText(driverDisplayName));

    expect(await screen.findByRole("heading", { name: driverDisplayName })).toBeInTheDocument();
    expect(await within(mainContent()).findByText("20/35h · cycle ends 2030-01-01")).toBeInTheDocument();
    expect(within(mainContent()).getByText("Behind")).toBeInTheDocument();
    expect(within(mainContent()).getByText("Acme Training")).toBeInTheDocument();

    // Read-only — no logging control on the company side.
    expect(screen.queryByText("Log Training")).not.toBeInTheDocument();
  });

  it("property 9: a driver-only role never sees the Management group or a Drivers management screen", async () => {
    await bootAppWithLegacyData(); // Alex, driver-only in Example Driver Agency, no manager-tier role anywhere
    expect(screen.queryByLabelText("Switch workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Management")).not.toBeInTheDocument();
    // "Drivers" (the sidebar item label) never appears for a pure driver.
    expect(screen.queryByText("Drivers")).not.toBeInTheDocument();
  });

  it("property 10: admin and manager roles (not just owner) see the Drivers management screen", async () => {
    for (const role of ["admin", "manager"]) {
      window.localStorage.clear();
      await resetIndexedDb();
      const db = await createIndexedDbDb();
      await runMigrations(db, window.localStorage);
      window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, "person-demo");
      const membership = (await db.memberships.query({ where: { workspaceId: "workspace-demo-agency", personId: "person-demo" } }))[0];
      await db.memberships.update(membership.id, { roles: [...membership.roles, role] });

      const { unmount } = render(<App />);
      const user = userEvent.setup();
      await user.selectOptions(await screen.findByLabelText("Switch workspace"), screen.getByText("Example Driver Agency"));
      await user.click(within(sidebarNav()).getByText("Drivers"));
      expect(await screen.findByRole("heading", { name: "Drivers" })).toBeInTheDocument();
      expect(screen.getByText("Add driver")).toBeInTheDocument();
      unmount();
      cleanup();
    }
  });

  it("Transport Manager: gated on the transport_manager role specifically — an ordinary manager role never sees it", async () => {
    window.localStorage.clear();
    await resetIndexedDb();
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, "person-demo");
    const membership = (await db.memberships.query({ where: { workspaceId: "workspace-demo-agency", personId: "person-demo" } }))[0];
    await db.memberships.update(membership.id, { roles: [...membership.roles, "manager"] });

    render(<App />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Switch workspace"), screen.getByText("Example Driver Agency"));
    expect(screen.queryByText("Transport Manager")).not.toBeInTheDocument();
  });

  it("Transport Manager: a transport_manager role sees the gated dashboard, rolling up driver and vehicle compliance status", async () => {
    window.localStorage.clear();
    await resetIndexedDb();
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, "person-demo");
    const membership = (await db.memberships.query({ where: { workspaceId: "workspace-demo-agency", personId: "person-demo" } }))[0];
    await db.memberships.update(membership.id, { roles: [...membership.roles, "transport_manager"] });
    await db.vehicles.insert({
      id: "vehicle-tm-test",
      workspaceId: "workspace-demo-agency",
      registration: "AB12CDE",
      vehicleType: "tractor_unit",
      make: null,
      model: null,
      notes: null,
      motExpiryDate: "2020-01-01",
      insuranceExpiryDate: null,
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    render(<App />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Switch workspace"), screen.getByText("Example Driver Agency"));
    await user.click(within(sidebarNav()).getByText("Dashboard"));

    expect(await screen.findByRole("heading", { name: "Transport Manager" })).toBeInTheDocument();
    // Fleet-size hours guidance, derived from the 1 active vehicle above (Stat Doc 3's <=2 band).
    expect(await within(mainContent()).findByText(/2–4 hours\/week suggested/)).toBeInTheDocument();
    // Alex himself is a driver-role member of this workspace, so he appears as a driver row.
    expect(within(mainContent()).getByText("Alex")).toBeInTheDocument();
    // The seeded vehicle's expired MOT surfaces in the roll-up.
    expect(within(mainContent()).getByText("AB12CDE")).toBeInTheDocument();
    expect(within(mainContent()).getByText("Expired")).toBeInTheDocument();

    // Reminders: the vehicle's expired MOT surfaces as a banner reminder at
    // the top of the dashboard (Alex's own driver status is all fine in
    // this fixture, so this is the only reminder).
    expect(within(mainContent()).getByText("AB12CDE: MOT has expired")).toBeInTheDocument();
  });

  it("Add Driver end to end: create, edit, archive, and restore, all through the real UI with real persistence", async () => {
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, "person-demo");
    const membership = (await db.memberships.query({ where: { workspaceId: "workspace-demo-agency", personId: "person-demo" } }))[0];
    await db.memberships.update(membership.id, { roles: [...membership.roles, "owner"] });

    render(<App />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Switch workspace"), screen.getByText("Example Driver Agency"));
    await user.click(within(sidebarNav()).getByText("Drivers"));
    await screen.findByRole("heading", { name: "Drivers" });

    // Create.
    await user.click(screen.getByText("Add driver"));
    await screen.findByRole("heading", { name: "Add driver" });
    await user.type(screen.getByLabelText("First name"), "New");
    await user.type(screen.getByLabelText("Last name"), "Driver");
    await user.click(screen.getByText("Save"));
    await screen.findByRole("heading", { name: "Drivers" });
    expect(await within(mainContent()).findByText("New Driver")).toBeInTheDocument();

    const created = await db.people.query({ where: { firstName: "New", lastName: "Driver" } });
    expect(created).toHaveLength(1);
    const createdProfiles = await db.driverProfiles.query({ where: { personId: created[0].id, workspaceId: "workspace-demo-agency" } });
    expect(createdProfiles).toHaveLength(1);

    // Edit.
    const card = within(mainContent()).getByText("New Driver").closest("div").parentElement.parentElement;
    await user.click(within(card).getByLabelText("Edit"));
    await screen.findByRole("heading", { name: "Edit driver" });
    const lastNameInput = screen.getByLabelText("Last name");
    await user.clear(lastNameInput);
    await user.type(lastNameInput, "Renamed");
    await user.click(screen.getByText("Save"));
    await screen.findByRole("heading", { name: "Drivers" });
    expect(await within(mainContent()).findByText("New Renamed")).toBeInTheDocument();
    expect((await db.people.getById(created[0].id)).id).toBe(created[0].id); // same Person id preserved

    // Archive.
    const cardAfterEdit = within(mainContent()).getByText("New Renamed").closest("div").parentElement.parentElement;
    await user.click(within(cardAfterEdit).getByText("Archive"));
    await screen.findByText("Archive this driver?");
    await user.click(screen.getAllByText("Archive").at(-1));
    expect(await within(mainContent()).findByText("Archived")).toBeInTheDocument();
    expect((await db.driverProfiles.getById(createdProfiles[0].id)).archivedAt).toBeTruthy();

    // Restore.
    const cardAfterArchive = within(mainContent()).getByText("New Renamed").closest("div").parentElement.parentElement;
    await user.click(within(cardAfterArchive).getByText("Restore"));
    await screen.findByText("Restore driver");
    await user.click(screen.getAllByText("Restore").at(-1));
    // Alex's own card is ALSO "Active" by default (he has no DriverProfile
    // for Example Driver Agency yet — absence means active) — scope to this driver's card.
    await waitFor(() => {
      const cardAfterRestore = within(mainContent()).getByText("New Renamed").closest("div").parentElement.parentElement;
      expect(within(cardAfterRestore).getByText("Active")).toBeInTheDocument();
      expect(within(cardAfterRestore).getByText("Archive")).toBeInTheDocument(); // button flipped back from Restore
    });
    expect((await db.driverProfiles.getById(createdProfiles[0].id)).archivedAt).toBeNull();
  });

  it("Work Placements: create, assign a driver, end, and archive all work end to end through the real UI", async () => {
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, "person-demo");
    const membership = (await db.memberships.query({ where: { workspaceId: "workspace-demo-agency", personId: "person-demo" } }))[0];
    await db.memberships.update(membership.id, { roles: [...membership.roles, "owner"] });

    render(<App />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Switch workspace"), screen.getByText("Example Driver Agency"));
    await user.click(within(sidebarNav()).getByText("Work placements"));
    await screen.findByRole("heading", { name: "Work placements" });

    // The real, migrated placement shows with Alex as its one active driver -- open it.
    expect(await within(mainContent()).findByText(/1 driver/)).toBeInTheDocument();
    await user.click(within(mainContent()).getByText(/Example Driver Agency.*Example Logistics Depot A/));
    await screen.findByText(/Agency worker/);

    // End Alex's assignment, then archive it (would have been blocked while active).
    await user.click(screen.getByText("End"));
    await waitFor(() => {
      expect(within(mainContent()).getByText("No drivers currently assigned to this placement.")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Archive"));
    await screen.findByText("Archive this placement?");
    await user.click(screen.getAllByText("Archive").at(-1));
    await waitFor(() => {
      expect(within(mainContent()).getByText("Archived")).toBeInTheDocument();
    });

    const placement = await db.placements.getById("placement-demo-agency-client");
    expect(placement.archivedAt).toBeTruthy();
    const originalAssignment = await db.assignments.getById("assignment-demo-agency-client");
    expect(originalAssignment.endDate).toBeTruthy();

    // Back to the list, create a new placement (same site/provider/rate lineage -- proves the create flow end to end).
    await user.click(screen.getByLabelText("Back to work placements"));
    await screen.findByRole("heading", { name: "Work placements" });

    await user.click(screen.getByText("Add placement"));
    await screen.findByRole("heading", { name: "Add work placement" });

    const providerSelect = screen.getByLabelText("Provider");
    await user.selectOptions(providerSelect, within(providerSelect).getByText("Example Driver Agency"));
    const siteSelect = screen.getByLabelText("Site");
    await user.selectOptions(siteSelect, within(siteSelect).getByText(/Example Logistics Depot A/));
    const rateCardSelect = screen.getByLabelText("Rate card");
    await user.selectOptions(rateCardSelect, within(rateCardSelect).getByText(/Example Driver Agency/));
    const dateInput = document.querySelector('input[type="date"]');
    await user.clear(dateInput);
    await user.type(dateInput, "2026-01-01");
    await user.click(screen.getByText("Save"));

    await screen.findByRole("heading", { name: "Work placements" });
    // Both the archived original and the new placement show -- only the new one is Active.
    await waitFor(() => {
      expect(within(mainContent()).getAllByText(/Example Driver Agency.*Example Logistics Depot A/).length).toBe(2);
    });

    // Open the new one (Active, 0 drivers) and assign Alex to it -- his Engagement is still
    // active (only the old Assignment was ended above), so he's eligible.
    const activeBadges = within(mainContent()).getAllByText("Active");
    // The badge <span> is a direct child of the card's flex-row <div> -- unlike the text-node
    // lookups elsewhere in this file, no extra .parentElement hops are needed here.
    const newCard = activeBadges[0].closest("div");
    await user.click(within(newCard).getByText(/Example Driver Agency.*Example Logistics Depot A/));
    await screen.findByText("No drivers currently assigned to this placement.");

    const assignSelect = within(mainContent()).getByRole("combobox");
    await user.selectOptions(assignSelect, within(assignSelect).getByText("Alex"));
    await user.click(screen.getByText("Assign"));
    await waitFor(() => {
      expect(within(mainContent()).getByText(/Agency worker/)).toBeInTheDocument();
    });
  });
});
