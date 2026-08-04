import React from "react";
import { useTranslation } from "react-i18next";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { bootstrapDb, isServerMode } from "../../storage/bootstrap.js";
import { SessionProvider } from "../../context/SessionContext.jsx";
import AuthGate from "./AuthGate.jsx";

const bootScreenStyle = {
  padding: 24,
  color: "#8B909A",
  background: "#14161A",
  minHeight: "100vh",
  fontFamily: "'Barlow', sans-serif",
};

/**
 * Opens IndexedDB and runs pending migrations before anything else
 * renders — avoids a blank white screen on first load (which also runs
 * the one-time localStorage->IndexedDB copy) and surfaces a clear
 * fatal state if storage is unavailable (e.g. some private-browsing
 * modes) rather than a silently empty app.
 */
export default function AppBootstrap() {
  const { t } = useTranslation("common");
  const { data: db, loading, error } = useAsyncData(() => bootstrapDb(), []);

  if (error) {
    return <div style={bootScreenStyle}>{t("common:storageUnavailable")}</div>;
  }
  if (loading || !db) {
    return <div style={bootScreenStyle}>{t("common:loading")}</div>;
  }
  return (
    <SessionProvider db={db} apiBaseUrl={isServerMode() ? import.meta.env.VITE_API_BASE_URL : undefined}>
      <AuthGate />
    </SessionProvider>
  );
}
