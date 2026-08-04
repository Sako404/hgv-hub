import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Download, Upload } from "lucide-react";
import { exportWorkspace, importWorkspace } from "../../services/exportImportService.js";
import { secondaryBtnStyle } from "./styles.js";

/**
 * Export/import buttons for one workspace's owned data (client-side JSON
 * file, no backend). Deliberately workspace-scoped — see
 * exportWorkspace()/docs/ARCHITECTURE.md for why it never bundles data a
 * viewer can merely see via a cross-workspace query but doesn't own.
 */
export function ExportImportBar({ workspaceId, workspaceName, db, onImported }) {
  const { t } = useTranslation("common");
  const fileInputRef = useRef(null);

  async function handleExport() {
    const bundle = await exportWorkspace(workspaceId, db);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(workspaceName || "workspace").replace(/\s+/g, "-").toLowerCase()}-export.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const payload = JSON.parse(reader.result);
        await importWorkspace(payload, db);
        onImported?.();
      } catch (err) {
        console.error("Import failed:", err);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <div style={{ display: "flex", gap: 10 }}>
      <button onClick={handleExport} style={{ ...secondaryBtnStyle, display: "flex", alignItems: "center", gap: 6 }}>
        <Download size={14} /> {t("export")}
      </button>
      <button onClick={() => fileInputRef.current?.click()} style={{ ...secondaryBtnStyle, display: "flex", alignItems: "center", gap: 6 }}>
        <Upload size={14} /> {t("import")}
      </button>
      <input ref={fileInputRef} type="file" accept="application/json" onChange={handleImportFile} style={{ display: "none" }} />
    </div>
  );
}
