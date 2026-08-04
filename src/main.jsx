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
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
