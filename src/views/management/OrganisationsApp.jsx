import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Pencil } from "lucide-react";
import {
  createOrganisation,
  updateOrganisation,
  archiveOrganisation,
  restoreOrganisation,
  listOrganisationsForWorkspace,
} from "../../services/organisationService.js";
import { Card, Field, EmptyState, StatusBadge, ArchiveConfirmDialog } from "../shared/atoms.jsx";
import { inputStyle, primaryBtnStyle, secondaryBtnStyle, iconBtnStyle } from "../shared/styles.js";
import PageHeader from "../shell/PageHeader.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";

const ORGANISATION_TYPES = ["agency", "transport_company", "client", "customer", "subcontractor", "other"];
const EMPTY_FORM = { legalName: "", tradingName: "", types: [] };

/**
 * Organisations management screen: list + create/edit form + archive/
 * restore, all workspace-scoped. Company-management surface, reachable
 * only for MANAGER_ROLES (see AppShell.jsx's Management nav group).
 */
export default function OrganisationsApp({ workspace, db }) {
  const { t } = useTranslation(["management", "common"]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [mode, setMode] = useState("list"); // "list" | "create" | "edit"
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null); // {id, name, active} | null

  const { data, loading } = useAsyncData(
    () => listOrganisationsForWorkspace(workspace.id, db),
    [workspace.id, db, refreshTick]
  );
  const organisations = data ?? [];

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setSaveError("");
  }

  function startCreate() {
    resetForm();
    setMode("create");
  }

  function startEdit(org) {
    setForm({ legalName: org.legalName, tradingName: org.tradingName, types: org.types });
    setEditingId(org.id);
    setSaveError("");
    setMode("edit");
  }

  function toggleType(type) {
    setForm((f) => ({
      ...f,
      types: f.types.includes(type) ? f.types.filter((x) => x !== type) : [...f.types, type],
    }));
  }

  async function save() {
    if (!form.legalName || !form.tradingName) return;
    if (form.types.length === 0) {
      setSaveError(t("management:organisations.typesRequired"));
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await updateOrganisation(editingId, { legalName: form.legalName, tradingName: form.tradingName, types: form.types }, db);
      } else {
        await createOrganisation({ workspaceId: workspace.id, ...form }, db);
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
      await archiveOrganisation(archiveTarget.id, db);
    } else {
      await restoreOrganisation(archiveTarget.id, db);
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
        <PageHeader
          title={mode === "edit" ? t("management:organisations.editOrganisation") : t("management:organisations.addOrganisation")}
        />
        <div className="shell-content" style={{ padding: 16 }}>
          <Card>
            <Field label={t("management:organisations.legalName")}>
              <input style={inputStyle} value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
            </Field>
            <Field label={t("management:organisations.tradingName")}>
              <input style={inputStyle} value={form.tradingName} onChange={(e) => setForm({ ...form, tradingName: e.target.value })} />
            </Field>
            <Field label={t("management:organisations.types")}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {ORGANISATION_TYPES.map((type) => (
                  <label key={type} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#B8BCC4" }}>
                    <input type="checkbox" checked={form.types.includes(type)} onChange={() => toggleType(type)} />
                    {t(`management:organisations.typeOptions.${type}`)}
                  </label>
                ))}
              </div>
              <div style={{ fontSize: 11, color: "#8B909A", marginTop: 8 }}>{t("management:organisations.typesHint")}</div>
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
        title={t("management:organisations.title")}
        subtitle={t("management:organisations.subtitle", { count: organisations.length })}
        action={
          <button onClick={startCreate} style={{ ...primaryBtnStyle, display: "flex", alignItems: "center", gap: 6, padding: "10px 16px" }}>
            <Plus size={16} /> {t("management:organisations.addOrganisation")}
          </button>
        }
      />
      <div className="shell-content" style={{ padding: 16 }}>
        {organisations.length === 0 && <EmptyState title={t("management:organisations.empty")} />}

        {organisations.map((org) => (
          <Card key={org.id} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15 }}>{org.tradingName}</div>
                <div style={{ fontSize: 12, color: "#8B909A", marginTop: 2 }}>
                  {org.legalName !== org.tradingName ? `${org.legalName} · ` : ""}
                  {org.types.map((type) => t(`management:organisations.typeOptions.${type}`)).join(", ")}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <StatusBadge active={!org.archivedAt} />
                <button onClick={() => startEdit(org)} style={iconBtnStyle} aria-label={t("common:edit")}>
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => setArchiveTarget({ id: org.id, active: !org.archivedAt })}
                  style={{ ...secondaryBtnStyle, padding: "6px 10px", fontSize: 12 }}
                >
                  {org.archivedAt ? t("common:restore") : t("common:archive")}
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <ArchiveConfirmDialog
        open={Boolean(archiveTarget)}
        title={
          archiveTarget?.active
            ? t("management:organisations.archiveConfirmTitle")
            : t("management:organisations.restoreConfirmTitle")
        }
        body={archiveTarget?.active ? t("management:organisations.archiveConfirmBody") : null}
        confirmLabel={archiveTarget?.active ? t("common:archive") : t("common:restore")}
        onConfirm={confirmArchiveToggle}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
}
