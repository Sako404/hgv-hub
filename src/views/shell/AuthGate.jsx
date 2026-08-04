import React from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../context/SessionContext.jsx";
import LoginScreen from "./LoginScreen.jsx";
import AppShell from "./AppShell.jsx";

const bootScreenStyle = {
  padding: 24,
  color: "#8B909A",
  background: "#14161A",
  minHeight: "100vh",
  fontFamily: "'Barlow', sans-serif",
};

/**
 * Local mode: apiMode is false, authChecked starts true — falls
 * straight through to AppShell, unchanged from before server mode
 * existed. Server mode: waits for the one-time /api/auth/me check,
 * then shows LoginScreen until a session exists.
 */
export default function AuthGate() {
  const { t } = useTranslation("common");
  const { apiMode, authChecked, isAuthenticated } = useSession();

  if (apiMode && !authChecked) {
    return <div style={bootScreenStyle}>{t("common:loading")}</div>;
  }
  if (apiMode && !isAuthenticated) {
    return <LoginScreen />;
  }
  return <AppShell />;
}
