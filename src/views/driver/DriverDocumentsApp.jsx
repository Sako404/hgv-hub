import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Pencil, Archive as ArchiveIcon, RotateCcw, RefreshCw } from "lucide-react";
import {
  archiveDriverDocument,
  createDriverDocument,
  listDriverDocuments,
  renewDriverDocument,
  restoreDriverDocument,
  updateDriverDocument,
} from "../../services/driverDocumentService.js";
import { resolveDocumentStatus } from "../../services/documentExpiryEngine.js";
import { Card, Field, EmptyState, DocumentStatusBadge } from "../shared/atoms.jsx";
import { inputStyle, primaryBtnStyle, secondaryBtnStyle, iconBtnStyle } from "../shared/styles.js";
import PageHeader from "../shell/PageHeader.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";

const DOCUMENT_TYPES = ["driving_licence", "tacho_card", "cpc_card", "tm_cpc", "other"];
const EMPTY_FORM = { documentType: "driving_licence", label: "", referenceNumber: "", expiryDate: "", notes: "" };
const EMPTY_RENEW_FORM = { expiryDate: "", referenceNumber: "", notes: "" };

async function loadDriverDocumentsData(personId, db) {
  const documents = await listDriverDocuments(personId, db);
  return { documents };
}

export default function DriverDocumentsApp({ personId, db }) {
  const { t } = useTranslation(["driverDocument", "common"]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [mode, setMode] = useState("list");
  const [form, setForm] = useState(EMPTY_FORM);
  const [renewForm, setRenewForm] = useState(EMPTY_RENEW_FORM);
  const [editingId, setEditingId] = useState(null);
  const [renewingId, setRenewingId] = useState(null);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, loading } = useAsyncData(() => loadDriverDocumentsData(personId, db), [personId, db, refreshTick]);
  const documents = data?.documents ?? [];
  const activeDocuments = documents.filter((d) => !d.archivedAt);
  const archivedDocuments = documents.filter((d) => d.archivedAt);
  const today = new Date();

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setSaveError("");
  }

  function startCreate() {
    resetForm();
    setMode("create");
  }

  function startEdit(document) {
    setForm({
      documentType: document.documentType,
      label: document.label ?? "",
      referenceNumber: document.referenceNumber ?? "",
      expiryDate: document.expiryDate ?? "",
      notes: document.notes ?? "",
    });
    setEditingId(document.id);
    setSaveError("");
    setMode("edit");
  }

  function startRenew(document) {
    setRenewForm({
      expiryDate: "",
      referenceNumber: document.referenceNumber ?? "",
      notes: document.notes ?? "",
    });
    setRenewingId(document.id);
    setSaveError("");
    setMode("renew");
  }

  async function save() {
    if (form.documentType === "other" && !form.label) return;
    setSaving(true);
    try {
      const patch = {
        label: form.documentType === "other" ? form.label : null,
        referenceNumber: form.referenceNumber || null,
        expiryDate: form.expiryDate || null,
        notes: form.notes || null,
      };
      if (editingId) {
        await updateDriverDocument(editingId, patch, db);
      } else {
        await createDriverDocument({ personId, documentType: form.documentType, ...patch }, db);
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

  async function saveRenew() {
    if (!renewForm.expiryDate) return;
    setSaving(true);
    try {
      await renewDriverDocument(
        renewingId,
        { expiryDate: renewForm.expiryDate, referenceNumber: renewForm.referenceNumber || null, notes: renewForm.notes || null },
        db
      );
      setRefreshTick((t2) => t2 + 1);
      setRenewForm(EMPTY_RENEW_FORM);
      setRenewingId(null);
      setMode("list");
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(id) {
    await archiveDriverDocument(id, db);
    setRefreshTick((t2) => t2 + 1);
  }

  async function handleRestore(id) {
    await restoreDriverDocument(id, db);
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
        <PageHeader title={mode === "edit" ? t("driverDocument:editTitle") : t("driverDocument:addTitle")} />
        <div className="shell-content" style={{ padding: 16 }}>
          <Card>
            <Field label={t("driverDocument:form.documentType")}>
              <select
                style={inputStyle}
                value={form.documentType}
                disabled={mode === "edit"}
                onChange={(e) => setForm({ ...form, documentType: e.target.value })}
              >
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`driverDocument:types.${type}`)}
                  </option>
                ))}
              </select>
            </Field>
            {form.documentType === "other" && (
              <Field label={t("driverDocument:form.label")}>
                <input style={inputStyle} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </Field>
            )}
            <Field label={t("driverDocument:form.referenceNumber")}>
              <input
                style={inputStyle}
                value={form.referenceNumber}
                onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })}
              />
            </Field>
            <Field label={t("driverDocument:form.expiryDate")}>
              <input
                type="date"
                style={inputStyle}
                value={form.expiryDate}
                onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
              />
            </Field>
            <Field label={t("driverDocument:form.notes")}>
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

  if (mode === "renew") {
    const renewingDoc = documents.find((d) => d.id === renewingId);
    return (
      <div style={{ color: "#EDEEF0", fontFamily: "'Barlow', sans-serif" }}>
        <PageHeader
          title={t("driverDocument:renewTitle")}
          subtitle={renewingDoc ? t(`driverDocument:types.${renewingDoc.documentType}`) : undefined}
        />
        <div className="shell-content" style={{ padding: 16 }}>
          <Card>
            <Field label={t("driverDocument:form.newExpiryDate")}>
              <input
                type="date"
                style={inputStyle}
                value={renewForm.expiryDate}
                onChange={(e) => setRenewForm({ ...renewForm, expiryDate: e.target.value })}
              />
            </Field>
            <Field label={t("driverDocument:form.referenceNumber")}>
              <input
                style={inputStyle}
                value={renewForm.referenceNumber}
                onChange={(e) => setRenewForm({ ...renewForm, referenceNumber: e.target.value })}
              />
            </Field>
            <Field label={t("driverDocument:form.notes")}>
              <input style={inputStyle} value={renewForm.notes} onChange={(e) => setRenewForm({ ...renewForm, notes: e.target.value })} />
            </Field>
          </Card>
          <div style={{ fontSize: 11, color: "#8B909A", marginTop: -4, marginBottom: 4 }}>{t("driverDocument:renewHint")}</div>

          {saveError && <div style={{ color: "#FF5A5F", fontSize: 13, marginTop: 10 }}>{saveError}</div>}

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button onClick={saveRenew} disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>
              {t("driverDocument:confirmRenew")}
            </button>
            <button onClick={() => { setRenewForm(EMPTY_RENEW_FORM); setRenewingId(null); setMode("list"); }} style={secondaryBtnStyle}>
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
        title={t("driverDocument:title")}
        subtitle={t("driverDocument:subtitle", { count: activeDocuments.length })}
        action={
          <button onClick={startCreate} style={{ ...primaryBtnStyle, display: "flex", alignItems: "center", gap: 6, padding: "10px 16px" }}>
            <Plus size={16} /> {t("driverDocument:addDocument")}
          </button>
        }
      />
      <div className="shell-content" style={{ padding: 16 }}>
        {activeDocuments.length === 0 && archivedDocuments.length === 0 && <EmptyState title={t("driverDocument:empty")} />}

        {activeDocuments.map((document) => {
          const status = resolveDocumentStatus(document, today);
          return (
            <Card key={document.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
                    {document.documentType === "other" ? document.label : t(`driverDocument:types.${document.documentType}`)}
                    <DocumentStatusBadge status={status} />
                  </div>
                  <div style={{ fontSize: 12, color: "#8B909A", marginTop: 2 }}>
                    {document.expiryDate
                      ? t("driverDocument:expiresOn", { date: document.expiryDate })
                      : t("driverDocument:noExpiryDate")}
                    {document.referenceNumber ? ` · ${document.referenceNumber}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => startRenew(document)} style={iconBtnStyle} aria-label={t("driverDocument:renew")} title={t("driverDocument:renew")}>
                    <RefreshCw size={14} />
                  </button>
                  <button onClick={() => startEdit(document)} style={iconBtnStyle} aria-label={t("common:edit")} title={t("common:edit")}>
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => handleArchive(document.id)} style={iconBtnStyle} aria-label={t("common:archive")} title={t("common:archive")}>
                    <ArchiveIcon size={14} color="#FF5A5F" />
                  </button>
                </div>
              </div>
            </Card>
          );
        })}

        {archivedDocuments.length > 0 && (
          <details style={{ marginTop: 16 }}>
            <summary style={{ fontSize: 11, color: "#8B909A", cursor: "pointer" }}>{t("driverDocument:archivedToggle")}</summary>
            <div style={{ marginTop: 10 }}>
              {archivedDocuments.map((document) => (
                <Card key={document.id} style={{ marginBottom: 10, opacity: 0.7 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14 }}>
                        {document.documentType === "other" ? document.label : t(`driverDocument:types.${document.documentType}`)}
                      </div>
                      <div style={{ fontSize: 12, color: "#8B909A", marginTop: 2 }}>
                        {document.expiryDate ? t("driverDocument:expiresOn", { date: document.expiryDate }) : t("driverDocument:noExpiryDate")}
                      </div>
                    </div>
                    <button onClick={() => handleRestore(document.id)} style={iconBtnStyle} aria-label={t("common:restore")} title={t("common:restore")}>
                      <RotateCcw size={14} />
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
