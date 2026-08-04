import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./views/shell/shell.css";
import { createIndexedDbDb } from "./storage/db.js";
import { STORAGE_KEYS } from "./storage/keys.js";
import { seedSecondCompany } from "./services/seed/seedSecondCompany.js";

if (import.meta.env.DEV) {
  // Dev-only console hooks proving the multi-driver/multi-org shape of the
  // domain model without a full company-management UI:
  //   await window.__seedSecondCompany() -> logs the seeded owner/driver ids
  //   window.__setCurrentPerson(id) -> switch + reload as that person
  // See docs/ARCHITECTURE.md for the verification walkthrough.
  window.__seedSecondCompany = async () => {
    const db = await createIndexedDbDb();

    const currentPersonId =
    globalThis.localStorage.getItem(STORAGE_KEYS.CURRENT_PERSON_ID);

    const result = await seedSecondCompany(db, {
      grantAccessToPersonId: currentPersonId,
    });

    console.log("Seeded Northline Transport Ltd:", result);
    return result;
  };

  // Dumps every collection's full contents (this is a single-tenant
  // local install — no other person's data to filter out) into one
  // JSON file, for migrating a local install's real data into a new
  // self-hosted (server-mode) account. See
  // scripts/import-full-account.mjs for the other half. Not exposed in
  // any UI on purpose — this moves real personal data, so it stays a
  // deliberate console action, not a button someone could click by
  // accident.
  window.__exportAllData = async () => {
    const db = await createIndexedDbDb();
    const collections = [
      "workspaces", "people", "memberships", "organisations", "sites",
      "driverProfiles", "engagements", "assignments", "shifts",
      "rateCardLineages", "rateCards", "placements", "complianceProfiles",
      "vehicles", "checklistTemplates", "vehicleChecks", "defects", "loads",
      "driverDocuments", "cpcTrainingRecords",
    ];
    const bundle = {};
    for (const collection of collections) {
      bundle[collection] = await db[collection].getAll();
    }
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hgv-hub-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    console.log("Exported", Object.fromEntries(collections.map((c) => [c, bundle[c].length])));
    return bundle;
  };
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
