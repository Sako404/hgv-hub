import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Pencil } from "lucide-react";
import {
  createVehicle,
  updateVehicle,
  archiveVehicle,
  restoreVehicle,
  listVehiclesForWorkspace,
} from "../../services/vehicleService.js";
import { Card, Field, EmptyState, StatusBadge, ArchiveConfirmDialog, DocumentStatusBadge } from "../shared/atoms.jsx";
import { inputStyle, primaryBtnStyle, secondaryBtnStyle, iconBtnStyle } from "../shared/styles.js";
import PageHeader from "../shell/PageHeader.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { resolveDocumentStatus } from "../../services/documentExpiryEngine.js";

const VEHICLE_TYPES = ["rigid", "tractor_unit", "trailer", "van", "other"];
const EMPTY_FORM = { registration: "", vehicleType: "rigid", make: "", model: "", notes: "", motExpiryDate: "", insuranceExpiryDate: "" };

/**
 * Vehicles management screen: list + create/edit form + archive/
 * restore, all workspace-scoped. Identity-only records for the Vehicle
 * Check module (VC-1) — no scheduling/allocation/maintenance, see
 * docs/ARCHITECTURE.md.
 */
export default function VehiclesApp({ workspace, db }) {
  const { t } = useTranslation(["management", "common"]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [mode, setMode] = useState("list");
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);

  const { data, loading } = useAsyncData(
    () => listVehiclesForWorkspace(workspace.id, db),
    [workspace.id, db, refreshTick]
  );
  const vehicles = data ?? [];

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setSaveError("");
  }

  function startCreate() {
    resetForm();
    setMode("create");
  }

  function startEdit(vehicle) {
    setForm({
      registration: vehicle.registration,
      vehicleType: vehicle.vehicleType,
      make: vehicle.make ?? "",
      model: vehicle.model ?? "",
      notes: vehicle.notes ?? "",
      motExpiryDate: vehicle.motExpiryDate ?? "",
      insuranceExpiryDate: vehicle.insuranceExpiryDate ?? "",
    });
    setEditingId(vehicle.id);
    setSaveError("");
    setMode("edit");
  }

  async function save() {
    if (!form.registration) return;
    setSaving(true);
    try {
      const patch = {
        registration: form.registration,
        vehicleType: form.vehicleType,
        make: form.make || null,
        model: form.model || null,
        notes: form.notes || null,
        motExpiryDate: form.motExpiryDate || null,
        insuranceExpiryDate: form.insuranceExpiryDate || null,
      };
      if (editingId) {
        await updateVehicle(editingId, patch, db);
      } else {
        await createVehicle({ workspaceId: workspace.id, ...patch }, db);
      }
      setRefreshTick((t2) => t2 + 1);
      resetForm();
      setMode("list");
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmArchiveToggle() {
    if (!archiveTarget) return;
    if (archiveTarget.active) {
      await archiveVehicle(archiveTarget.id, db);
    } else {
      await restoreVehicle(archiveTarget.id, db);
    }
    setArchiveTarget(null);
    setRefreshTick((t2) => t2 + 1);
  }

  if (loading && !data) {
    return (
      <div className="shell-content" style={{ padding: 16, color: "#8B909A", fontFamily: "'Barlow', sans-serif" }}>
        {t("common:loading")}
      </div>
    );
  }

  if (mode === "create" || mode === "edit") {
    return (
      <div style={{ color: "#EDEEF0", fontFamily: "'Barlow', sans-serif" }}>
        <PageHeader title={mode === "edit" ? t("management:vehicles.editVehicle") : t("management:vehicles.addVehicle")} />
        <div className="shell-content" style={{ padding: 16 }}>
          <Card>
            <Field label={t("management:vehicles.registration")}>
              <input
                style={inputStyle}
                value={form.registration}
                onChange={(e) => setForm({ ...form, registration: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label={t("management:vehicles.vehicleType")}>
              <select style={inputStyle} value={form.vehicleType} onChange={(e) => setForm({ ...form, vehicleType: e.target.value })}>
                {VEHICLE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`management:vehicles.typeOptions.${type}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("management:vehicles.make")}>
              <input style={inputStyle} value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
            </Field>
            <Field label={t("management:vehicles.model")}>
              <input style={inputStyle} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </Field>
            <Field label={t("management:vehicles.notes")}>
              <input style={inputStyle} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
            <Field label={t("management:vehicles.motExpiryDate")}>
              <input
                type="date"
                style={inputStyle}
                value={form.motExpiryDate}
                onChange={(e) => setForm({ ...form, motExpiryDate: e.target.value })}
              />
            </Field>
            <Field label={t("management:vehicles.insuranceExpiryDate")}>
              <input
                type="date"
                style={inputStyle}
                value={form.insuranceExpiryDate}
                onChange={(e) => setForm({ ...form, insuranceExpiryDate: e.target.value })}
              />
            </Field>
          </Card>

          {saveError && <div style={{ color: "#FF5A5F", fontSize: 13, marginTop: 10 }}>{saveError}</div>}

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button onClick={save} disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>
              {t("common:save")}
            </button>
            <button onClick={() => { resetForm(); setMode("list"); }} style={secondaryBtnStyle}>
              {t("common:cancel")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ color: "#EDEEF0", fontFamily: "'Barlow', sans-serif" }}>
      <PageHeader
        title={t("management:vehicles.title")}
        subtitle={t("management:vehicles.subtitle", { count: vehicles.length })}
        action={
          <button onClick={startCreate} style={{ ...primaryBtnStyle, display: "flex", alignItems: "center", gap: 6, padding: "10px 16px" }}>
            <Plus size={16} /> {t("management:vehicles.addVehicle")}
          </button>
        }
      />
      <div className="shell-content" style={{ padding: 16 }}>
        {vehicles.length === 0 && <EmptyState title={t("management:vehicles.empty")} />}

        {vehicles.map((vehicle) => (
          <Card key={vehicle.id} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15 }}>{vehicle.registration}</div>
                <div style={{ fontSize: 12, color: "#8B909A", marginTop: 2 }}>
                  {t(`management:vehicles.typeOptions.${vehicle.vehicleType}`)}
                  {(vehicle.make || vehicle.model) ? ` · ${[vehicle.make, vehicle.model].filter(Boolean).join(" ")}` : ""}
                </div>
                <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, color: "#8B909A" }}>{t("management:vehicles.mot")}</span>
                    <DocumentStatusBadge status={resolveDocumentStatus({ expiryDate: vehicle.motExpiryDate }, new Date())} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, color: "#8B909A" }}>{t("management:vehicles.insurance")}</span>
                    <DocumentStatusBadge status={resolveDocumentStatus({ expiryDate: vehicle.insuranceExpiryDate }, new Date())} />
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <StatusBadge active={!vehicle.archivedAt} />
                <button onClick={() => startEdit(vehicle)} style={iconBtnStyle} aria-label={t("common:edit")}>
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => setArchiveTarget({ id: vehicle.id, active: !vehicle.archivedAt })}
                  style={{ ...secondaryBtnStyle, padding: "6px 10px", fontSize: 12 }}
                >
                  {vehicle.archivedAt ? t("common:restore") : t("common:archive")}
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <ArchiveConfirmDialog
        open={Boolean(archiveTarget)}
        title={archiveTarget?.active ? t("management:vehicles.archiveConfirmTitle") : t("management:vehicles.restoreConfirmTitle")}
        body={archiveTarget?.active ? t("management:vehicles.archiveConfirmBody") : null}
        confirmLabel={archiveTarget?.active ? t("common:archive") : t("common:restore")}
        onConfirm={confirmArchiveToggle}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
}
