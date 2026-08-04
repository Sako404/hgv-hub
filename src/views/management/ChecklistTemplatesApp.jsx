import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Pencil, Star } from "lucide-react";
import {
  createChecklistTemplate,
  updateChecklistTemplate,
  archiveChecklistTemplate,
  restoreChecklistTemplate,
  setDefaultChecklistTemplate,
  listChecklistTemplatesForWorkspace,
} from "../../services/checklistTemplateService.js";
import { Card, Field, EmptyState, StatusBadge, ArchiveConfirmDialog } from "../shared/atoms.jsx";
import { inputStyle, primaryBtnStyle, secondaryBtnStyle, iconBtnStyle } from "../shared/styles.js";
import ChecklistItemsField from "./ChecklistItemsField.jsx";
import PageHeader from "../shell/PageHeader.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";

const EMPTY_FORM = { name: "", items: [] };

/**
 * Checklist Templates management screen: list + create/edit form
 * (including the ordered items editor) + archive/restore + "set as
 * default" — exactly one template per workspace is the default a
 * VehicleCheck snapshots from (VC-2). Editing items here never touches
 * any already-saved VehicleCheck (snapshot, not live reference — see
 * decision-2026-08-03-working-time-vehicle-check-module-architecture).
 */
export default function ChecklistTemplatesApp({ workspace, db }) {
  const { t } = useTranslation(["management", "common"]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [mode, setMode] = useState("list");
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);

  const { data, loading } = useAsyncData(
    () => listChecklistTemplatesForWorkspace(workspace.id, db),
    [workspace.id, db, refreshTick]
  );
  const templates = data ?? [];

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setSaveError("");
  }

  function startCreate() {
    resetForm();
    setMode("create");
  }

  function startEdit(template) {
    setForm({ name: template.name, items: template.items });
    setEditingId(template.id);
    setSaveError("");
    setMode("edit");
  }

  async function save() {
    if (!form.name) return;
    setSaving(true);
    try {
      if (editingId) {
        await updateChecklistTemplate(editingId, { name: form.name, items: form.items }, db);
      } else {
        await createChecklistTemplate({ workspaceId: workspace.id, name: form.name, items: form.items }, db);
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

  async function makeDefault(id) {
    await setDefaultChecklistTemplate(id, workspace.id, db);
    setRefreshTick((t2) => t2 + 1);
  }

  async function confirmArchiveToggle() {
    if (!archiveTarget) return;
    if (archiveTarget.active) {
      await archiveChecklistTemplate(archiveTarget.id, db);
    } else {
      await restoreChecklistTemplate(archiveTarget.id, db);
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
          title={mode === "edit" ? t("management:checklistTemplates.editTemplate") : t("management:checklistTemplates.addTemplate")}
        />
        <div className="shell-content" style={{ padding: 16 }}>
          <Card>
            <Field label={t("management:checklistTemplates.name")}>
              <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
          </Card>

          <Card style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
              {t("management:checklistTemplates.items")}
            </div>
            <ChecklistItemsField items={form.items} onChange={(items) => setForm({ ...form, items })} />
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
        title={t("management:checklistTemplates.title")}
        subtitle={t("management:checklistTemplates.subtitle", { count: templates.length })}
        action={
          <button onClick={startCreate} style={{ ...primaryBtnStyle, display: "flex", alignItems: "center", gap: 6, padding: "10px 16px" }}>
            <Plus size={16} /> {t("management:checklistTemplates.addTemplate")}
          </button>
        }
      />
      <div className="shell-content" style={{ padding: 16 }}>
        {templates.length === 0 && <EmptyState title={t("management:checklistTemplates.empty")} />}

        {templates.map((template) => (
          <Card key={template.id} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
                  {template.isDefault && <Star size={13} color="#FF8A00" fill="#FF8A00" />}
                  {template.name}
                </div>
                <div style={{ fontSize: 12, color: "#8B909A", marginTop: 2 }}>
                  {t("management:checklistTemplates.itemCount", { count: template.items.length })}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
                <StatusBadge active={!template.archivedAt} />
                {!template.isDefault && !template.archivedAt && (
                  <button onClick={() => makeDefault(template.id)} style={{ ...secondaryBtnStyle, padding: "6px 10px", fontSize: 12 }}>
                    {t("management:checklistTemplates.setDefault")}
                  </button>
                )}
                <button onClick={() => startEdit(template)} style={iconBtnStyle} aria-label={t("common:edit")}>
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => setArchiveTarget({ id: template.id, active: !template.archivedAt })}
                  style={{ ...secondaryBtnStyle, padding: "6px 10px", fontSize: 12 }}
                >
                  {template.archivedAt ? t("common:restore") : t("common:archive")}
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
            ? t("management:checklistTemplates.archiveConfirmTitle")
            : t("management:checklistTemplates.restoreConfirmTitle")
        }
        body={archiveTarget?.active ? t("management:checklistTemplates.archiveConfirmBody") : null}
        confirmLabel={archiveTarget?.active ? t("common:archive") : t("common:restore")}
        onConfirm={confirmArchiveToggle}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
}
