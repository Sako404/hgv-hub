import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { useSession } from "../../context/SessionContext.jsx";
import { fetchUpdateStatus, applyUpdate, fetchApplyStatus } from "../../storage/updateClient.js";
import { Card } from "../shared/atoms.jsx";
import { primaryBtnStyle } from "../shared/styles.js";

const POLL_INTERVAL_MS = 3000;
const TERMINAL_STATUSES = new Set(["success", "failed"]);

/**
 * Server-mode-only, and only for whoever can actually manage this
 * deployment (session.canManageServer — owner/admin in ANY workspace,
 * personal included, see workspaceService.js). Checks once on mount;
 * the server itself only re-checks GitHub at most once a day
 * (updateService.js's own cache), so there's no need to poll that part.
 *
 * Clicking "Update now" only confirms the request was ACCEPTED — the
 * actual outcome (success/failed, and which stage it's at) is polled
 * separately via /api/updates/apply/status, since accepting the request
 * is not the same as the update having actually happened (see
 * updater/src/lib.js's mergeStatus for why that endpoint keeps working
 * correctly even across the updater sidecar's own container being
 * recreated mid-update on a TrueNAS deployment).
 */
export default function UpdateBanner() {
  const { t } = useTranslation("common");
  const { apiMode, apiBaseUrl, canManageServer } = useSession();
  const [status, setStatus] = useState(null);
  const [applyState, setApplyState] = useState(null);
  const [error, setError] = useState(null);
  const pollTimer = useRef(null);

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

  useEffect(() => () => clearTimeout(pollTimer.current), []);

  const pollApplyStatus = () => {
    fetchApplyStatus(apiBaseUrl)
      .then((result) => {
        setApplyState(result);
        if (!TERMINAL_STATUSES.has(result.status)) {
          pollTimer.current = setTimeout(pollApplyStatus, POLL_INTERVAL_MS);
        }
      })
      .catch(() => {
        // Expected mid-redeploy: the server/client containers this
        // request itself goes through may be recreating right now.
        // Keep polling rather than treating one failed request as a
        // final outcome.
        pollTimer.current = setTimeout(pollApplyStatus, POLL_INTERVAL_MS);
      });
  };

  if (!apiMode || !canManageServer) return null;

  const handleApply = async () => {
    setError(null);
    setApplyState({ status: "updating", stage: "checkout" });
    try {
      await applyUpdate(apiBaseUrl);
      pollApplyStatus();
    } catch (err) {
      if (err.message === "update already in progress") {
        // Not our click's fault -- someone/something else already has one
        // running. Watch the real thing instead of dead-ending on an error.
        pollApplyStatus();
        return;
      }
      setError(err.message);
      setApplyState(null);
    }
  };

  if (!status?.updateAvailable && !applyState) return null;

  const isTerminal = applyState && TERMINAL_STATUSES.has(applyState.status);
  const isApplying = applyState && !isTerminal;

  let message;
  if (applyState?.status === "success") {
    message = t("update.success", { version: (applyState.targetTag ?? "").replace(/^v/, "") });
  } else if (applyState?.status === "failed") {
    message = t("update.failed", { error: applyState.error ?? "unknown error" });
  } else if (isApplying) {
    message = t(`update.stage.${applyState.stage}`, { defaultValue: t("update.applying") });
  } else {
    message = t("update.available", { version: status.latestVersion });
  }

  return (
    <Card style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <RefreshCw size={14} color="#4DD9E8" />
        <span style={{ fontSize: 12.5, color: "#EDEEF0" }}>{message}</span>
        {error && <span style={{ fontSize: 12, color: "#FF5A5F" }}>{error}</span>}
      </div>
      {applyState?.status === "success" ? (
        <button
          type="button"
          style={{ ...primaryBtnStyle, flex: "none", padding: "6px 14px" }}
          onClick={() => window.location.reload()}
        >
          {t("update.reload")}
        </button>
      ) : (
        <button
          type="button"
          style={{ ...primaryBtnStyle, flex: "none", padding: "6px 14px" }}
          onClick={handleApply}
          disabled={isApplying}
        >
          {isApplying ? t("update.applying") : t("update.confirm")}
        </button>
      )}
    </Card>
  );
}
