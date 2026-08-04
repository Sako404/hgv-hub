import React from "react";
import { useTranslation } from "react-i18next";
import { Truck, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import WorkspaceSwitcher from "./WorkspaceSwitcher.jsx";
import NavGroup from "./NavGroup.jsx";
import LanguageSwitcher from "./LanguageSwitcher.jsx";
import LogoutButton from "./LogoutButton.jsx";

export default function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, switcher, groups }) {
  const { t } = useTranslation("common");

  return (
    <aside
      id="app-sidebar"
      aria-label={t("nav.primaryNavigation")}
      className={`shell-sidebar${mobileOpen ? " shell-sidebar--mobile-open" : ""}`}
    >
      <div className="shell-brand">
        <div className="shell-brand-mark">
          <Truck size={17} color="#14161A" />
        </div>
        <span className="shell-brand-name">{t("appName")}</span>
      </div>

      {switcher && (
        <WorkspaceSwitcher options={switcher.options} activeId={switcher.activeId} onChange={switcher.onChange} />
      )}

      <nav className="shell-nav-scroll" aria-label={t("nav.mainNavigation")}>
        {groups.map((group) => (
          <NavGroup key={group.label} label={group.label} items={group.items} />
        ))}
      </nav>

      <div className="shell-sidebar-settings">
        <LanguageSwitcher />
        <LogoutButton />
      </div>

      <div className="shell-sidebar-footer">
        <button
          type="button"
          className="shell-collapse-btn"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          <span className="shell-nav-label">{t("sidebar.collapse")}</span>
        </button>
      </div>
    </aside>
  );
}
