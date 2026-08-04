// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";
import { STORAGE_KEYS } from "./storage/keys.js";
import { runMigrations } from "./migrations/index.js";
import { createIndexedDbDb } from "./storage/db.js";
import { seedSecondCompany } from "./services/seed/seedSecondCompany.js";
import { getAppSetting, setAppSetting } from "./settings/appSettings.js";
import { DEFAULT_LANGUAGE, resolveInitialLanguage } from "./i18n/index.js";
import { fmtRange, money } from "./services/shiftMath.js";
import { computeShiftBreakdown } from "./services/payEngine.js";
import { computeCompliance } from "./services/complianceEngine.js";
import { resolveComplianceProfileForDriver } from "./services/complianceProfileService.js";
import { resetIndexedDb } from "../test/resetIndexedDb.js";

// English (en-GB) must be the default regardless of the fake browser
// locale jsdom reports — this suite proves that end to end (App renders
// English on first launch, and switching languages updates the whole
// tree live, without a reload) as well as at the pure appSettings level.

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
  // has resolved) before handing control back to callers.
  await screen.findByRole("heading", { name: "Dashboard" });
  return db;
}

async function switchLanguage(user, languageValue) {
  // Targeted by stable id rather than label text, since the label text
  // itself is translated ("Language" / "Język") and changes with the
  // very state this helper is switching. Polls rather than a plain
  // getElementById, since callers may invoke this before the app has
  // finished its async boot.
  const select = await waitFor(() => {
    const el = document.getElementById("language-switcher-select");
    if (!el) throw new Error("language switcher not rendered yet");
    return el;
  });
  await user.selectOptions(select, languageValue);
}

describe("i18n — default language and appSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("1. English is the default on first launch (no appSettings at all)", () => {
    expect(resolveInitialLanguage()).toBe("en-GB");
    expect(DEFAULT_LANGUAGE).toBe("en-GB");
  });

  it("2. Existing users without a language field migrate/default to en-GB", () => {
    // Simulate a pre-existing appSettings blob (from an earlier feature)
    // that predates the language setting entirely.
    setAppSetting("someUnrelatedPreference", "x");
    expect(getAppSetting("language", DEFAULT_LANGUAGE)).toBe("en-GB");
    expect(resolveInitialLanguage()).toBe("en-GB");
  });
});

describe("i18n — live switching and persistence (full render)", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await resetIndexedDb();
  });
  afterEach(() => {
    cleanup();
  });

  it("1/8. boots in English by default — Dashboard heading and KPI labels are English", async () => {
    await bootAppWithLegacyData();
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Hours")).toBeInTheDocument();
    expect(screen.getByText("Driving")).toBeInTheDocument();
    expect(screen.getByText("Expected gross")).toBeInTheDocument();
  });

  it("3. switching to Polish updates the visible UI immediately (no reload)", async () => {
    await bootAppWithLegacyData();
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();

    await switchLanguage(user, "pl-PL");

    expect(await screen.findByRole("heading", { name: "Panel" })).toBeInTheDocument();
    expect(within(await screen.findByLabelText("Menu główne")).getByText("Kierowca")).toBeInTheDocument();
  });

  it("4. switching back to English works", async () => {
    await bootAppWithLegacyData();
    const user = userEvent.setup();
    await switchLanguage(user, "pl-PL");
    expect(await screen.findByRole("heading", { name: "Panel" })).toBeInTheDocument();

    await switchLanguage(user, "en-GB");
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("5. preference survives application reload", async () => {
    await bootAppWithLegacyData();
    const user = userEvent.setup();
    await switchLanguage(user, "pl-PL");
    expect(await screen.findByRole("heading", { name: "Panel" })).toBeInTheDocument();

    // Simulate a reload: unmount and render a fresh <App/> (a fresh
    // i18n instance is created at mount time — see App.jsx — so this
    // only stays Polish if the preference was actually persisted).
    cleanup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Panel" })).toBeInTheDocument();
  });

  it("6. driver navigation is translated", async () => {
    await bootAppWithLegacyData();
    const user = userEvent.setup();
    await switchLanguage(user, "pl-PL");

    const nav = await screen.findByLabelText("Menu główne");
    expect(within(nav).getByText("Kierowca")).toBeInTheDocument();
    expect(within(nav).getByText("Panel")).toBeInTheDocument();
    expect(within(nav).getByText("Dodaj zmianę")).toBeInTheDocument();
    expect(within(nav).getByText("Historia")).toBeInTheDocument();
  });

  it("7. company navigation is translated", async () => {
    window.localStorage.clear();
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    const seed = await seedSecondCompany(db);
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, seed.ownerPersonId);
    render(<App />);
    const user = userEvent.setup();

    await switchLanguage(user, "pl-PL");
    const switcher = await screen.findByLabelText("Przełącz workspace");
    await user.selectOptions(switcher, screen.getByText("Northline Transport Ltd"));

    const nav = await screen.findByLabelText("Menu główne");
    expect(within(nav).getByText("Zarządzanie")).toBeInTheDocument();
    expect(within(nav).getByText("Kierowcy")).toBeInTheDocument();
  });

  it("7b. Organisations/Sites management screens are translated", async () => {
    window.localStorage.clear();
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, "person-demo");
    const membership = (await db.memberships.query({ where: { workspaceId: "workspace-demo-agency", personId: "person-demo" } }))[0];
    await db.memberships.update(membership.id, { roles: [...membership.roles, "owner"] });

    render(<App />);
    const user = userEvent.setup();
    await switchLanguage(user, "pl-PL");

    const switcher = await screen.findByLabelText("Przełącz workspace");
    await user.selectOptions(switcher, screen.getByText("Example Driver Agency"));

    const nav = await screen.findByLabelText("Menu główne");
    expect(within(nav).getByText("Zarządzanie")).toBeInTheDocument();

    await user.click(within(nav).getByText("Organizacje"));
    expect(await screen.findByRole("heading", { name: "Organizacje" })).toBeInTheDocument();

    await user.click(within(nav).getByText("Lokalizacje"));
    expect(await screen.findByRole("heading", { name: "Lokalizacje" })).toBeInTheDocument();

    await user.click(within(nav).getByText("Cenniki"));
    expect(await screen.findByRole("heading", { name: "Cenniki" })).toBeInTheDocument();
    expect(screen.getByText("Utwórz cennik")).toBeInTheDocument();
  });

  it("7c. Drivers management screen (create/edit/archive/status) is translated", async () => {
    window.localStorage.clear();
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, "person-demo");
    const membership = (await db.memberships.query({ where: { workspaceId: "workspace-demo-agency", personId: "person-demo" } }))[0];
    await db.memberships.update(membership.id, { roles: [...membership.roles, "owner"] });

    render(<App />);
    const user = userEvent.setup();
    await switchLanguage(user, "pl-PL");

    await user.selectOptions(await screen.findByLabelText("Przełącz workspace"), screen.getByText("Example Driver Agency"));
    const nav = await screen.findByLabelText("Menu główne");
    await user.click(within(nav).getByText("Kierowcy"));
    expect(await screen.findByRole("heading", { name: "Kierowcy" })).toBeInTheDocument();
    expect(screen.getByText("Dodaj kierowcę")).toBeInTheDocument();
    // Alex has no DriverProfile for Example Driver Agency yet -> treated as active by default.
    expect(screen.getByText("Aktywny")).toBeInTheDocument();

    await user.click(screen.getByText("Dodaj kierowcę"));
    expect(await screen.findByRole("heading", { name: "Dodaj kierowcę" })).toBeInTheDocument();
    expect(screen.getByText("Imię")).toBeInTheDocument();
    expect(screen.getByText("Nazwisko")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Imię"), "Polski");
    await user.type(screen.getByLabelText("Nazwisko"), "Kierowca");
    await user.click(screen.getByText("Zapisz"));

    await screen.findByRole("heading", { name: "Kierowcy" });
    expect(await screen.findByText("Polski Kierowca")).toBeInTheDocument();
  });

  it("7d. Work Placements screen and the driver Employment section are translated", async () => {
    window.localStorage.clear();
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    window.localStorage.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, "person-demo");
    const membership = (await db.memberships.query({ where: { workspaceId: "workspace-demo-agency", personId: "person-demo" } }))[0];
    await db.memberships.update(membership.id, { roles: [...membership.roles, "owner"] });

    render(<App />);
    const user = userEvent.setup();
    await switchLanguage(user, "pl-PL");

    await user.selectOptions(await screen.findByLabelText("Przełącz workspace"), screen.getByText("Example Driver Agency"));
    const nav = await screen.findByLabelText("Menu główne");
    expect(within(nav).getByText("Praca")).toBeInTheDocument();
    await user.click(within(nav).getByText("Miejsca pracy"));
    expect(await screen.findByRole("heading", { name: "Miejsca pracy" })).toBeInTheDocument();
    expect(screen.getByText("Dodaj miejsce pracy")).toBeInTheDocument();

    await user.click(await screen.findByText(/Example Driver Agency.*Example Logistics Depot A/));
    expect(await screen.findByText(/Pracownik agencyjny/)).toBeInTheDocument();
    expect(screen.getByText("Zakończ")).toBeInTheDocument();

    // The driver drilldown's Employment section is also translated.
    await user.click(within(nav).getByText("Kierowcy"));
    await screen.findByRole("heading", { name: "Kierowcy" });
    await user.click(screen.getByText("Alex"));
    expect(await screen.findByText("Zatrudnienie")).toBeInTheDocument();
    expect(screen.getByText("Zakończ zatrudnienie")).toBeInTheDocument();
  });

  it("9. Add Shift form is translated", async () => {
    await bootAppWithLegacyData();
    const user = userEvent.setup();
    await switchLanguage(user, "pl-PL");

    await user.click(within(await screen.findByLabelText("Menu główne")).getByText("Dodaj zmianę"));
    expect(await screen.findByRole("heading", { name: "Dodaj zmianę" })).toBeInTheDocument();
    expect(screen.getByText("Data")).toBeInTheDocument();
    expect(screen.getByText("Koniec")).toBeInTheDocument();
  });

  it("10. Payslip UI is translated", async () => {
    await bootAppWithLegacyData();
    const user = userEvent.setup();
    await switchLanguage(user, "pl-PL");

    await user.click(within(await screen.findByLabelText("Menu główne")).getByText("Payslip"));
    expect(await screen.findByRole("heading", { name: "Payslip" })).toBeInTheDocument();
    expect(screen.getByText("Mój total")).toBeInTheDocument();
  });

  it("11. compliance UI is translated", async () => {
    await bootAppWithLegacyData();
    const user = userEvent.setup();
    await switchLanguage(user, "pl-PL");

    expect(await screen.findByText("Wydłużone zmiany")).toBeInTheDocument();
    expect(screen.getByText("Wydłużona jazda")).toBeInTheDocument();
    expect(screen.getByText("Skrócone odpoczynki")).toBeInTheDocument();
    expect(screen.getAllByText("OK").length).toBeGreaterThan(0);
  });

  it("12. empty/error states are translated", async () => {
    window.localStorage.clear();
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage); // no legacy data -> Alex has zero shifts
    render(<App />);
    const user = userEvent.setup();
    await switchLanguage(user, "pl-PL");

    expect(await screen.findByText("Brak zmian w tym tygodniu")).toBeInTheDocument();
  });

  it("13. organisation/site names are NOT translated in either language", async () => {
    await bootAppWithLegacyData();
    expect(await screen.findByText(/Example Driver Agency/)).toBeInTheDocument();

    const user = userEvent.setup();
    await switchLanguage(user, "pl-PL");
    expect(await screen.findByText(/Example Driver Agency/)).toBeInTheDocument();
    expect(screen.getByText(/Example Logistics Depot A/)).toBeInTheDocument();
  });

  it("14. currency stays GBP (£) in both locales", async () => {
    await bootAppWithLegacyData();
    // £0.00 still renders when the week has no gross yet — assert the symbol is present.
    expect(await screen.findByText(/£/)).toBeInTheDocument();

    const user = userEvent.setup();
    await switchLanguage(user, "pl-PL");
    expect(await screen.findByText(/£/)).toBeInTheDocument();
  });

  it("16. UI language does not affect the numeric KPI value shown", async () => {
    await bootAppWithLegacyData();
    const user = userEvent.setup();

    const hoursCardValueBefore = (await screen.findByText("Hours")).parentElement.textContent;

    await switchLanguage(user, "pl-PL");
    // "Hours" becomes "Godziny" but the underlying digits are unchanged.
    const hoursCardValueAfter = (await screen.findByText("Godziny")).parentElement.textContent;

    const digitsOf = (s) => s.replace(/[^\d:]/g, "");
    expect(digitsOf(hoursCardValueAfter)).toBe(digitsOf(hoursCardValueBefore));
  });

  it("17. switching language does not change any stored domain data", async () => {
    const db = await bootAppWithLegacyData();
    const before = JSON.parse(JSON.stringify(await db.shifts.getAll()));

    const user = userEvent.setup();
    await switchLanguage(user, "pl-PL");
    await switchLanguage(user, "en-GB");

    const after = await db.shifts.getAll();
    expect(after).toEqual(before);
  });
});

describe("i18n — locale-aware formatting is presentation-only", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await resetIndexedDb();
  });

  it("15. date formatting follows en-GB vs pl-PL (month name differs), same underlying date", () => {
    const monday = new Date(2026, 6, 27); // 2026-07-27, a Monday
    const en = fmtRange(monday, "en-GB");
    const pl = fmtRange(monday, "pl-PL");
    expect(en).not.toBe(pl);
    expect(en).toMatch(/Jul/);
    expect(pl).toMatch(/lip/);
  });

  it("currency formatting stays GBP regardless of locale", () => {
    const en = money(206.56, "en-GB");
    const pl = money(206.56, "pl-PL");
    expect(en).toMatch(/£/);
    expect(pl).toMatch(/£/);
    // Only digit-grouping conventions may differ; the numeric value is identical.
    expect(en.replace(/[^\d.,]/g, "")).toContain("206");
    expect(pl.replace(/[^\d.,]/g, "")).toContain("206");
  });

  it("16b. business calculations (pay + compliance engines) are locale-independent by construction", async () => {
    const db = await createIndexedDbDb();
    await runMigrations(db, window.localStorage);
    const shift = { date: "2026-07-14", start: "08:00", end: "16:00", breakMinutes: 45, drivingHours: 5 };
    const rateCard = {
      rates: {
        MonThu: { Days: [12.00, 14.00], Lates: [12.50, 14.50], Nights: [13.50, 15.50] },
        Fri: { Days: [12.75, 14.75], Lates: [13.25, 15.25], Nights: [14.25, 16.25] },
        Sat: { Days: [13.50, 15.50], Lates: [14.00, 16.00], Nights: [16.00, 18.00] },
        Sun: { Days: [14.00, 16.00], Lates: [14.50, 16.50], Nights: [17.00, 19.00] },
      },
    };
    // Neither computeShiftBreakdown nor computeCompliance takes a
    // locale/language argument at all — there is no code path for UI
    // language to influence the numbers.
    expect(computeShiftBreakdown.length).toBe(2);
    expect(computeCompliance.length).toBe(2);

    const a = computeShiftBreakdown(shift, rateCard);
    const b = computeShiftBreakdown(shift, rateCard);
    expect(a).toEqual(b);

    const profile = (await resolveComplianceProfileForDriver("person-demo", db)) ?? {
      rules: {
        reducedRestMaxPerCycle: 3, minRestHardHours: 9, reducedRestUpperHours: 11, cycleResetGapHours: 24,
        absoluteMaxDailyHours: 15, longShiftThresholdHours: 13, longShiftMaxPerCycle: 3,
        drivingHardLimitHours: 10, extendedDrivingThresholdHours: 9, extendedDrivingMaxPerWeek: 2,
      },
    };
    const c1 = computeCompliance([shift], profile);
    const c2 = computeCompliance([shift], profile);
    expect(c1).toEqual(c2);
    // Alert codes are translation keys, not language text.
    for (const alert of c1.alerts) {
      expect(alert).toHaveProperty("code");
      expect(typeof alert.code).toBe("string");
      expect(alert.message).toBeUndefined();
    }
  });
});
