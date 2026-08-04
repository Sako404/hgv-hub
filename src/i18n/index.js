import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { getAppSetting, setAppSetting } from "../settings/appSettings.js";

import enCommon from "./locales/en-GB/common.json";
import enDriver from "./locales/en-GB/driver.json";
import enCompany from "./locales/en-GB/company.json";
import enCompliance from "./locales/en-GB/compliance.json";
import enPay from "./locales/en-GB/pay.json";
import enManagement from "./locales/en-GB/management.json";
import enRateCards from "./locales/en-GB/rateCards.json";
import enPlacements from "./locales/en-GB/placements.json";
import enVehicleCheck from "./locales/en-GB/vehicleCheck.json";
import enDriverDocument from "./locales/en-GB/driverDocument.json";
import enCpcTraining from "./locales/en-GB/cpcTraining.json";
import enTransportManager from "./locales/en-GB/transportManager.json";
import enReminders from "./locales/en-GB/reminders.json";
import enAuth from "./locales/en-GB/auth.json";

import plCommon from "./locales/pl-PL/common.json";
import plDriver from "./locales/pl-PL/driver.json";
import plCompany from "./locales/pl-PL/company.json";
import plCompliance from "./locales/pl-PL/compliance.json";
import plPay from "./locales/pl-PL/pay.json";
import plManagement from "./locales/pl-PL/management.json";
import plRateCards from "./locales/pl-PL/rateCards.json";
import plPlacements from "./locales/pl-PL/placements.json";
import plVehicleCheck from "./locales/pl-PL/vehicleCheck.json";
import plDriverDocument from "./locales/pl-PL/driverDocument.json";
import plCpcTraining from "./locales/pl-PL/cpcTraining.json";
import plTransportManager from "./locales/pl-PL/transportManager.json";
import plReminders from "./locales/pl-PL/reminders.json";
import plAuth from "./locales/pl-PL/auth.json";

export const SUPPORTED_LANGUAGES = ["en-GB", "pl-PL"];
export const DEFAULT_LANGUAGE = "en-GB";

const resources = {
  "en-GB": { common: enCommon, driver: enDriver, company: enCompany, compliance: enCompliance, pay: enPay, management: enManagement, rateCards: enRateCards, placements: enPlacements, vehicleCheck: enVehicleCheck, driverDocument: enDriverDocument, cpcTraining: enCpcTraining, transportManager: enTransportManager, reminders: enReminders, auth: enAuth },
  "pl-PL": { common: plCommon, driver: plDriver, company: plCompany, compliance: plCompliance, pay: plPay, management: plManagement, rateCards: plRateCards, placements: plPlacements, vehicleCheck: plVehicleCheck, driverDocument: plDriverDocument, cpcTraining: plCpcTraining, transportManager: plTransportManager, reminders: plReminders, auth: plAuth },
};

/**
 * English is the default for every new/existing user regardless of
 * browser/system locale — we deliberately do not use a browser-locale
 * detector plugin. Only an explicit user choice (persisted via
 * appSettings) changes it. Existing users with no stored "language"
 * setting resolve to DEFAULT_LANGUAGE, same as a first launch.
 */
export function resolveInitialLanguage() {
  const stored = getAppSetting("language", DEFAULT_LANGUAGE);
  return SUPPORTED_LANGUAGES.includes(stored) ? stored : DEFAULT_LANGUAGE;
}

export function createI18n() {
  const instance = i18next.createInstance();
  instance.use(initReactI18next).init({
    resources,
    lng: resolveInitialLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES,
    ns: ["common", "driver", "company", "compliance", "pay", "management", "rateCards", "placements", "vehicleCheck", "driverDocument", "cpcTraining", "transportManager", "reminders", "auth"],
    defaultNS: "common",
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  });
  return instance;
}

export function changeLanguage(instance, language) {
  if (!SUPPORTED_LANGUAGES.includes(language)) return;
  setAppSetting("language", language);
  instance.changeLanguage(language);
}
