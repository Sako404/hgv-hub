import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Pencil } from "lucide-react";
import {
  createSite,
  updateSite,
  archiveSite,
  restoreSite,
  listSitesForWorkspace,
  siteHasAssignmentHistory,
} from "../../services/siteService.js";
import { listOrganisationsForWorkspace } from "../../services/organisationService.js";
import { Card, Field, EmptyState, StatusBadge, ArchiveConfirmDialog } from "../shared/atoms.jsx";
import { inputStyle, primaryBtnStyle, secondaryBtnStyle, iconBtnStyle } from "../shared/styles.js";
import PageHeader from "../shell/PageHeader.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";

const SITE_KINDS = ["client_site", "depot", "hub"];
const EMPTY_FORM = { name: "", organisationId: "", kind: "client_site", address: "", notes: "" };

async function loadSitesData(workspaceId, db) {
  const [sites, organisations] = await Promise.all([
    listSitesForWorkspace(workspaceId, db),
    listOrganisationsForWorkspace(workspaceId, db),
  ]);
  return { sites, organisations };
}

/**
 * Sites management screen: list + create/edit form + archive/restore.
 * A Site's organisation locks permanently once any Assignment has ever
 * referenced it (see siteService.updateSite) — the edit form disables
 * the picker and explains why, rather than silently rejecting a save.
 */
export default function SitesApp({ workspace, db }) {
  const { t } = useTranslation(["management", "common"]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [mode, setMode] = useState("list");
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingLocked, setEditingLocked] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);

  const { data, loading } = useAsyncData(() => loadSitesData(workspace.id, db), [workspace.id, db, refreshTick]);
  const sites = data?.sites ?? [];
  const organisations = data?.organisations ?? [];
  const organisationById = new Map(organisations.map((o) => [o.id, o]));

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setEditingLocked(false);
    setSaveError("");
  }

  function startCreate() {
    resetForm();
    setForm((f) => ({ ...f, organisationId: organisations[0]?.id ?? "" }));
    setMode("create");
  }

  async function startEdit(site) {
    setForm({
      name: site.name,
      organisationId: site.organisationId,
      kind: site.kind,
      address: site.address ?? "",
      notes: site.notes ?? "",
    });
    setEditingId(site.id);
    setSaveError("");
    setEditingLocked(await siteHasAssignmentHistory(site.id, db));
    setMode("edit");
  }

  async function save() {
    if (!form.name || !form.organisationId) return;
    setSaving(true);
    try {
      const patch = { name: form.name, kind: form.kind, address: form.address || null, notes: form.notes || null };
      if (!editingLocked) patch.organisationId = form.organisationId;
      if (editingId) {
        await updateSite(editingId, patch, db);
      } else {
        await createSite({ ...form, address: form.address || null, notes: form.notes || null }, db);
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
      await archiveSite(archiveTarget.id, db);
    } else {
      await restoreSite(archiveTarget.id, db);
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
        <PageHeader title={mode === "edit" ? t("management:sites.editSite") : t("management:sites.addSite")} />
        <div className="shell-content" style={{ padding: 16 }}>
          <Card>
            <Field label={t("management:sites.name")}>
              <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t("management:sites.organisation")}>
              <select
                style={inputStyle}
                value={form.organisationId}
                disabled={editingLocked}
                onChange={(e) => setForm({ ...form, organisationId: e.target.value })}
              >
                {organisations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.tradingName}
                  </option>
                ))}
              </select>
              {editingLocked && (
                <div style={{ fontSize: 11, color: "#8B909A", marginTop: 6 }}>{t("management:sites.organisationLocked")}</div>
              )}
            </Field>
            <Field label={t("management:sites.kind")}>
              <select style={inputStyle} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {SITE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`management:sites.kindOptions.${kind}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("management:sites.address")}>
              <input style={inputStyle} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <Field label={t("management:sites.notes")}>
              <input style={inputStyle} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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
        title={t("management:sites.title")}
        subtitle={t("management:sites.subtitle", { count: sites.length })}
        action={
          <button
            onClick={startCreate}
            disabled={organisations.length === 0}
            style={{ ...primaryBtnStyle, display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", opacity: organisations.length === 0 ? 0.5 : 1 }}
          >
            <Plus size={16} /> {t("management:sites.addSite")}
          </button>
        }
      />
      <div className="shell-content" style={{ padding: 16 }}>
        {sites.length === 0 && <EmptyState title={t("management:sites.empty")} />}

        {sites.map((site) => (
          <Card key={site.id} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15 }}>{site.name}</div>
                <div style={{ fontSize: 12, color: "#8B909A", marginTop: 2 }}>
                  {organisationById.get(site.organisationId)?.tradingName ?? "—"} · {t(`management:sites.kindOptions.${site.kind}`)}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <StatusBadge active={!site.archivedAt} />
                <button onClick={() => startEdit(site)} style={iconBtnStyle} aria-label={t("common:edit")}>
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => setArchiveTarget({ id: site.id, active: !site.archivedAt })}
                  style={{ ...secondaryBtnStyle, padding: "6px 10px", fontSize: 12 }}
                >
                  {site.archivedAt ? t("common:restore") : t("common:archive")}
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <ArchiveConfirmDialog
        open={Boolean(archiveTarget)}
        title={archiveTarget?.active ? t("management:sites.archiveConfirmTitle") : t("management:sites.restoreConfirmTitle")}
        body={archiveTarget?.active ? t("management:sites.archiveConfirmBody") : null}
        confirmLabel={archiveTarget?.active ? t("common:archive") : t("common:restore")}
        onConfirm={confirmArchiveToggle}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
}
