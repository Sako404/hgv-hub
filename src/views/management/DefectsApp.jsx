import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { advanceDefectStatus, listDefectsForWorkspace } from "../../services/defectService.js";
import { resolvePersonDisplayName } from "../../services/driverService.js";
import { Card, EmptyState } from "../shared/atoms.jsx";
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from "../shared/styles.js";
import PageHeader from "../shell/PageHeader.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";

const SEVERITY_COLORS = { minor: "#8B909A", major: "#FF8A00", dangerous: "#FF5A5F" };
const STATUS_COLORS = { open: "#FF5A5F", reported: "#FF8A00", in_progress: "#4DD9E8", resolved: "#3FBE63" };
const NEXT_STATUS = { open: "reported", reported: "in_progress", in_progress: "resolved" };

function Badge({ color, children }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        color,
        border: `1px solid ${color}`,
        borderRadius: 4,
        padding: "2px 6px",
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

async function loadDefectsData(workspaceId, db) {
  const defects = await listDefectsForWorkspace(workspaceId, db);
  const vehicleIds = [...new Set(defects.map((d) => d.vehicleId))];
  const driverIds = [...new Set(defects.map((d) => d.raisedByDriverId))];
  const [vehicles, drivers] = await Promise.all([
    Promise.all(vehicleIds.map((id) => db.vehicles.getById(id))),
    Promise.all(driverIds.map((id) => db.people.getById(id))),
  ]);
  return {
    defects,
    vehicleById: new Map(vehicles.filter(Boolean).map((v) => [v.id, v])),
    driverById: new Map(drivers.filter(Boolean).map((p) => [p.id, p])),
  };
}

/**
 * Defects list + status workflow (Stage VC-3) — read-only creation
 * (every row here is auto-raised by vehicleCheckService.createVehicleCheck
 * from a failed check item; there's no standalone "report a defect" UI
 * in v1, see the module's architecture proposal). Reused identically
 * for a company workspace (Management nav) and a solo driver's own
 * personal workspace (Vehicle Setup nav) — same pattern as
 * VehiclesApp/ChecklistTemplatesApp.
 */
export default function DefectsApp({ workspace, db }) {
  const { t, i18n } = useTranslation(["management", "common"]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [resolveTargetId, setResolveTargetId] = useState(null);
  const [resolveNotes, setResolveNotes] = useState("");

  const { data, loading } = useAsyncData(() => loadDefectsData(workspace.id, db), [workspace.id, db, refreshTick]);
  const defects = data?.defects ?? [];
  const vehicleById = data?.vehicleById ?? new Map();
  const driverById = data?.driverById ?? new Map();

  const fmtDate = (iso) =>
    new Date(iso).toLocaleDateString(i18n.language, { day: "2-digit", month: "short", year: "numeric" });

  async function advance(defect) {
    if (NEXT_STATUS[defect.status] === "resolved") {
      setResolveTargetId(defect.id);
      setResolveNotes("");
      return;
    }
    await advanceDefectStatus(defect.id, null, db);
    setRefreshTick((t2) => t2 + 1);
  }

  async function confirmResolve() {
    await advanceDefectStatus(resolveTargetId, resolveNotes, db);
    setResolveTargetId(null);
    setResolveNotes("");
    setRefreshTick((t2) => t2 + 1);
  }

  if (loading && !data) {
    return (
      <div className="shell-content" style={{ padding: 16, color: "#8B909A", fontFamily: "'Barlow', sans-serif" }}>
        {t("common:loading")}
      </div>
    );
  }

  const sorted = [...defects].reverse();

  return (
    <div style={{ color: "#EDEEF0", fontFamily: "'Barlow', sans-serif" }}>
      <PageHeader title={t("management:defects.title")} subtitle={t("management:defects.subtitle", { count: defects.length })} />
      <div className="shell-content" style={{ padding: 16 }}>
        {defects.length === 0 && <EmptyState title={t("management:defects.empty")} />}

        {sorted.map((defect) => {
          const vehicle = vehicleById.get(defect.vehicleId);
          const driver = driverById.get(defect.raisedByDriverId);
          const nextStatus = NEXT_STATUS[defect.status];
          return (
            <Card key={defect.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15 }}>{vehicle?.registration ?? "—"}</div>
                  <div style={{ fontSize: 13, color: "#EDEEF0", marginTop: 4 }}>{defect.description}</div>
                  <div style={{ fontSize: 11, color: "#8B909A", marginTop: 4 }}>
                    {fmtDate(defect.createdAt)} · {resolvePersonDisplayName(driver)}
                  </div>
                  {defect.status === "resolved" && defect.resolvedNotes && (
                    <div style={{ fontSize: 12, color: "#4DD9E8", marginTop: 6 }}>
                      {t("management:defects.resolvedNote", { notes: defect.resolvedNotes })}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Badge color={SEVERITY_COLORS[defect.severity]}>
                      {t(`management:defects.severityOptions.${defect.severity}`)}
                    </Badge>
                    <Badge color={STATUS_COLORS[defect.status]}>{t(`management:defects.statusOptions.${defect.status}`)}</Badge>
                  </div>
                  {nextStatus &&
                    (resolveTargetId === defect.id ? (
                      <div style={{ width: 220 }}>
                        <input
                          style={{ ...inputStyle, fontSize: 12.5, padding: "6px 8px" }}
                          placeholder={t("management:defects.resolvedNotesPlaceholder")}
                          value={resolveNotes}
                          onChange={(e) => setResolveNotes(e.target.value)}
                        />
                        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                          <button onClick={confirmResolve} style={{ ...primaryBtnStyle, padding: "6px 10px", fontSize: 12 }}>
                            {t("management:defects.confirmResolve")}
                          </button>
                          <button
                            onClick={() => setResolveTargetId(null)}
                            style={{ ...secondaryBtnStyle, padding: "6px 10px", fontSize: 12 }}
                          >
                            {t("common:cancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => advance(defect)} style={{ ...secondaryBtnStyle, padding: "6px 10px", fontSize: 12 }}>
                        {t(`management:defects.advanceTo.${nextStatus}`)}
                      </button>
                    ))}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
