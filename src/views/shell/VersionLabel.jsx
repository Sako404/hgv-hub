import React, { useEffect, useState } from "react";
import { useSession } from "../../context/SessionContext.jsx";

/**
 * Server-mode-only — local (IndexedDB) mode has no server version to
 * show. Reads /api/health directly (unauthenticated, same endpoint
 * updateService.js's RUNNING_VERSION already backs) rather than the
 * admin-gated /api/updates/status — anyone signed in should be able
 * to see what version is running, not just an owner/admin.
 */
export default function VersionLabel() {
  const { apiMode, apiBaseUrl } = useSession();
  const [version, setVersion] = useState(null);

  useEffect(() => {
    if (!apiMode) return;
    let cancelled = false;
    fetch(`${apiBaseUrl}/api/health`)
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setVersion(body.version);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [apiMode, apiBaseUrl]);

  if (!apiMode || !version) return null;

  return <div className="shell-version-label">v{version}</div>;
}
