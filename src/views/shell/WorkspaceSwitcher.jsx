import React from "react";
import { useTranslation } from "react-i18next";

/**
 * Renders near the top of the sidebar. Disappears completely when there
 * is only one accessible view (the common case: a solo driver, or a
 * driver-only membership like Alex's Example Driver Agency placement — see
 * resolveSession()/needsSwitcher in services/workspaceService.js, which
 * this component treats as the single source of truth and never
 * duplicates).
 */
export default function WorkspaceSwitcher({ options, activeId, onChange }) {
  const { t } = useTranslation("common");
  if (!options || options.length <= 1) return null;
  return (
    <div className="shell-switcher-wrap">
      <select
        aria-label={t("workspaceSwitcher.label")}
        className="shell-switcher"
        value={activeId ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
