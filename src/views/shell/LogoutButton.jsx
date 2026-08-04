import React from "react";
import { useTranslation } from "react-i18next";
import { LogOut } from "lucide-react";
import { useSession } from "../../context/SessionContext.jsx";

/**
 * Server-mode-only — local (IndexedDB) mode has no real "signed in"
 * concept to sign out of (see SessionContext.jsx's apiMode split), so
 * this renders nothing there.
 */
export default function LogoutButton() {
  const { t } = useTranslation("common");
  const { apiMode, isAuthenticated, logout } = useSession();

  if (!apiMode || !isAuthenticated) return null;

  return (
    <button type="button" className="shell-collapse-btn" onClick={logout}>
      <LogOut size={16} />
      <span className="shell-nav-label">{t("nav.signOut")}</span>
    </button>
  );
}
