import React from "react";
import { useTranslation } from "react-i18next";
import { Menu } from "lucide-react";

/**
 * Mobile chrome for the sidebar: a hamburger toggle (hidden ≥1024px via
 * CSS) and a dismiss overlay. The Sidebar itself is a single shared
 * component (see Sidebar.jsx) that becomes an off-canvas drawer below
 * 1024px and a persistent rail at/above it — this component only owns
 * the open/close affordances, not a second copy of the nav markup.
 */
export default function MobileDrawer({ open, onToggle, onClose }) {
  const { t } = useTranslation("common");
  return (
    <>
      <button
        type="button"
        className="shell-hamburger"
        onClick={onToggle}
        aria-label={open ? t("mobileNav.closeNavigation") : t("mobileNav.openNavigation")}
        aria-expanded={open}
        aria-controls="app-sidebar"
      >
        <Menu size={19} />
      </button>
      {open && <div className="shell-overlay" onClick={onClose} aria-hidden="true" />}
    </>
  );
}
