import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { useSession } from "../../context/SessionContext.jsx";
import { fetchUpdateStatus, applyUpdate } from "../../storage/updateClient.js";
import { Card } from "../shared/atoms.jsx";
import { primaryBtnStyle } from "../shared/styles.js";

/**
 * Server-mode-only, and only for whoever can actually manage this
 * deployment (session.canManageServer — owner/admin in ANY workspace,
 * personal included, see workspaceService.js). Checks once on mount;
 * the server itself only re-checks GitHub at most once a day
 * (updateService.js's own cache), so there's no need to poll here.
 */
export default function UpdateBanner() {
  const { t } = useTranslation("common");
  const { apiMode, apiBaseUrl, canManageServer } = useSession();
  const [status, setStatus] = useState(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!apiMode || !canManageServer) return;
    let cancelled = false;
    fetchUpdateStatus(apiBaseUrl)
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [apiMode, canManageServer, apiBaseUrl]);

  if (!apiMode || !canManageServer || !status?.updateAvailable) return null;

  const handleApply = async () => {
    setApplying(true);
    setError(null);
    try {
      await applyUpdate(apiBaseUrl);
    } catch (err) {
      setError(err.message);
      setApplying(false);
    }
  };

  return (
    <Card style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <RefreshCw size={14} color="#4DD9E8" />
        <span style={{ fontSize: 12.5, color: "#EDEEF0" }}>
          {t("update.available", { version: status.latestVersion })}
        </span>
        {error && <span style={{ fontSize: 12, color: "#FF5A5F" }}>{error}</span>}
      </div>
      <button
        type="button"
        style={{ ...primaryBtnStyle, flex: "none", padding: "6px 14px" }}
        onClick={handleApply}
        disabled={applying}
      >
        {applying ? t("update.applying") : t("update.confirm")}
      </button>
    </Card>
  );
}
