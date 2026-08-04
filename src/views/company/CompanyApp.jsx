import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Pencil } from "lucide-react";
import { listShiftsForWorkspace } from "../../services/shiftService.js";
import {
  archiveDriver,
  createDriver,
  listDriversForWorkspace,
  resolvePersonDisplayName,
  restoreDriver,
  updateDriver,
} from "../../services/driverService.js";
import { Card, Field, EmptyState, StatusBadge, ArchiveConfirmDialog } from "../shared/atoms.jsx";
import { ExportImportBar } from "../shared/ExportImportBar.jsx";
import { inputStyle, primaryBtnStyle, secondaryBtnStyle, iconBtnStyle } from "../shared/styles.js";
import PageHeader from "../shell/PageHeader.jsx";
import DriverDrilldown from "./DriverDrilldown.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";

const EMPTY_FORM = { firstName: "", lastName: "", displayName: "", email: "", referenceNumber: "" };

/**
 * Root data-fetch for this screen — drivers (via driverService, which
 * is Membership-rostered, DriverProfile-enriched) plus a per-driver
 * shift count. Everything downstream renders synchronously over the result.
 */
async function loadCompanyAppData(workspaceId, db) {
  const [drivers, shifts] = await Promise.all([
    listDriversForWorkspace(workspaceId, db),
    listShiftsForWorkspace(workspaceId, db),
  ]);
  const shiftCountByDriver = new Map();
  for (const s of shifts) shiftCountByDriver.set(s.driverId, (shiftCountByDriver.get(s.driverId) ?? 0) + 1);
  return { drivers, shiftCountByDriver };
}

/**
 * Company-side Drivers management: list (search, active/archived
 * status, per-row edit/archive) + Create/Edit forms + a read-only
 * click-through to DriverDrilldown for shift history. Proves the
 * multi-driver, shared-Shift architecture (DriverDrilldown reuses the
 * exact same ShiftHistoryList rendering DriverApp's own history tab
 * uses) while also being the real driver-management surface —
 * see docs/ARCHITECTURE.md for what's intentionally still out of scope
 * (rota, fleet, jobs, invoicing, ...).
 */
export default function CompanyApp({ workspace, db }) {
  const { t } = useTranslation(["company", "common"]);
  const [selectedDriverId, setSelectedDriverId] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [mode, setMode] = useState("list"); // "list" | "create" | "edit"
  const [editingPersonId, setEditingPersonId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null); // {personId, active} | null
  const [search, setSearch] = useState("");

  const { data, loading } = useAsyncData(
    () => loadCompanyAppData(workspace.id, db),
    [workspace.id, db, refreshTick]
  );
  const drivers = data?.drivers ?? [];
  const shiftCountByDriver = data?.shiftCountByDriver ?? new Map();

  const searchLower = search.trim().toLowerCase();
  const filteredDrivers = searchLower
    ? drivers.filter((d) => resolvePersonDisplayName(d.person).toLowerCase().includes(searchLower))
    : drivers;

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingPersonId(null);
    setSaveError("");
  }

  function startCreate() {
    resetForm();
    setMode("create");
  }

  function startEdit(driver) {
    setForm({
      firstName: driver.person.firstName ?? "",
      lastName: driver.person.lastName ?? "",
      displayName: driver.person.displayName ?? "",
      email: driver.person.email ?? "",
      referenceNumber: driver.driverProfile?.referenceNumber ?? "",
    });
    setEditingPersonId(driver.person.id);
    setSaveError("");
    setMode("edit");
  }

  async function save() {
    setSaving(true);
    try {
      if (editingPersonId) {
        await updateDriver(
          workspace.id,
          editingPersonId,
          {
            person: {
              firstName: form.firstName.trim(),
              lastName: form.lastName.trim(),
              displayName: form.displayName.trim() || null,
              email: form.email.trim() || null,
            },
            driverProfile: { referenceNumber: form.referenceNumber.trim() || null },
          },
          db
        );
      } else {
        await createDriver(
          {
            workspaceId: workspace.id,
            firstName: form.firstName,
            lastName: form.lastName,
            displayName: form.displayName,
            email: form.email,
            referenceNumber: form.referenceNumber,
          },
          db
        );
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
      await archiveDriver(workspace.id, archiveTarget.personId, db);
    } else {
      await restoreDriver(workspace.id, archiveTarget.personId, db);
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

  if (selectedDriverId) {
    const driver = drivers.find((d) => d.person.id === selectedDriverId);
    return (
      <DriverDrilldown
        workspaceId={workspace.id}
        driverPerson={driver.person}
        driverProfile={driver.driverProfile}
        db={db}
        onBack={() => setSelectedDriverId(null)}
      />
    );
  }

  if (mode === "create" || mode === "edit") {
    return (
      <div style={{ color: "#EDEEF0", fontFamily: "'Barlow', sans-serif" }}>
        <PageHeader title={mode === "edit" ? t("company:drivers.editDriver") : t("company:drivers.addDriver")} />
        <div className="shell-content" style={{ padding: 16 }}>
          <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
            {t("company:drivers.personSection")}
          </div>
          <Card>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label={t("company:drivers.firstName")}>
                <input style={inputStyle} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
              </Field>
              <Field label={t("company:drivers.lastName")}>
                <input style={inputStyle} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
              </Field>
            </div>
            <Field label={t("company:drivers.displayName")}>
              <input style={inputStyle} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            </Field>
            <Field label={t("company:drivers.email")}>
              <input type="email" style={inputStyle} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
          </Card>

          <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, margin: "16px 0 8px" }}>
            {t("company:drivers.driverProfileSection")}
          </div>
          <Card>
            <Field label={t("company:drivers.referenceNumber")}>
              <input style={inputStyle} value={form.referenceNumber} onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })} />
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
        title={t("company:drivers.title")}
        subtitle={t("company:drivers.activeCount", { count: drivers.length, workspace: workspace.name })}
        action={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", maxWidth: "100%" }}>
            <button onClick={startCreate} style={{ ...primaryBtnStyle, display: "flex", alignItems: "center", gap: 6, padding: "10px 16px" }}>
              <Plus size={16} /> {t("company:drivers.addDriver")}
            </button>
            <ExportImportBar
              workspaceId={workspace.id}
              workspaceName={workspace.name}
              db={db}
              onImported={() => setRefreshTick((t2) => t2 + 1)}
            />
          </div>
        }
      />
      <div className="shell-content" style={{ padding: 16 }}>
        {drivers.length > 0 && (
          <Field label={t("company:drivers.search")}>
            <input
              style={inputStyle}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("company:drivers.searchPlaceholder")}
            />
          </Field>
        )}

        {drivers.length === 0 && <EmptyState title={t("company:drivers.empty")} />}
        {drivers.length > 0 && filteredDrivers.length === 0 && (
          <div style={{ color: "#8B909A", fontSize: 13 }}>{t("company:drivers.noSearchResults")}</div>
        )}

        {filteredDrivers.map((driver) => (
          <Card key={driver.person.id} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div onClick={() => setSelectedDriverId(driver.person.id)} style={{ flex: 1, cursor: "pointer", minWidth: 160 }}>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15 }}>{resolvePersonDisplayName(driver.person)}</div>
                <div style={{ fontSize: 12, color: "#8B909A", marginTop: 2 }}>
                  {t("company:drivers.shiftsLogged", { count: shiftCountByDriver.get(driver.person.id) ?? 0 })}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <StatusBadge active={!driver.driverProfile?.archivedAt} />
                <button onClick={() => startEdit(driver)} style={iconBtnStyle} aria-label={t("common:edit")}>
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => setArchiveTarget({ personId: driver.person.id, active: !driver.driverProfile?.archivedAt })}
                  style={{ ...secondaryBtnStyle, padding: "6px 10px", fontSize: 12 }}
                >
                  {driver.driverProfile?.archivedAt ? t("common:restore") : t("common:archive")}
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <ArchiveConfirmDialog
        open={Boolean(archiveTarget)}
        title={archiveTarget?.active ? t("company:drivers.archiveConfirmTitle") : t("company:drivers.restoreConfirmTitle")}
        body={archiveTarget?.active ? t("company:drivers.archiveConfirmBody") : null}
        confirmLabel={archiveTarget?.active ? t("common:archive") : t("common:restore")}
        onConfirm={confirmArchiveToggle}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
}
