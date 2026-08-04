import React from "react";

/**
 * Consistent per-screen header: title + optional subtitle + optional
 * leading element (e.g. a back button) + optional primary action.
 * Used *inside* screen content (DriverApp/CompanyApp/DriverDrilldown),
 * not by AppShell — global navigation lives in the sidebar, not on the
 * page, so this component only ever renders page-local context.
 */
export default function PageHeader({ leading, title, subtitle, action }) {
  return (
    <div className="shell-page-header">
      <div className="shell-page-header-text">
        {leading && <div className="shell-page-header-leading">{leading}</div>}
        <div>
          <h1 className="shell-page-title">{title}</h1>
          {subtitle && <p className="shell-page-subtitle">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shell-page-header-action">{action}</div>}
    </div>
  );
}
