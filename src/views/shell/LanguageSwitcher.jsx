import React from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, changeLanguage } from "../../i18n/index.js";

/**
 * Compact language switcher — lives in the sidebar footer (see
 * Sidebar.jsx), which is shared between the persistent desktop rail and
 * the mobile drawer, so this is automatically available in both without
 * cluttering the mobile bottom nav. Switching updates the UI immediately
 * (i18next re-renders subscribed components) and persists via
 * appSettings — no page reload.
 */
export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation("common");

  return (
    <div className="shell-language-switcher">
      <label htmlFor="language-switcher-select" className="shell-language-label">
        {t("language.label")}
      </label>
      <select
        id="language-switcher-select"
        className="shell-language-select"
        value={i18n.language}
        onChange={(e) => changeLanguage(i18n, e.target.value)}
      >
        {SUPPORTED_LANGUAGES.map((lng) => (
          <option key={lng} value={lng}>
            {t(`language.${lng}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
