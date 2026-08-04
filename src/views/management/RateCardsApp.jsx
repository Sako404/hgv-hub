import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, ChevronLeft } from "lucide-react";
import {
  createRateCard,
  reviseRateCard,
  renameRateCardLineage,
  archiveRateCardLineage,
  restoreRateCardLineage,
  listRateCardLineagesForWorkspace,
  getRateCardLineageSummary,
} from "../../services/rateCardService.js";
import { Card, Field, EmptyState, StatusBadge, ArchiveConfirmDialog } from "../shared/atoms.jsx";
import { inputStyle, primaryBtnStyle, secondaryBtnStyle, navBtnStyle } from "../shared/styles.js";
import PageHeader from "../shell/PageHeader.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import RateGridField, { emptyRates } from "./RateGridField.jsx";

const PAY_TYPES = ["hourly", "per_load"];
const EMPTY_FORM = { name: "", effectiveFrom: "", rates: emptyRates(), payType: "hourly" };

/**
 * Rate Cards management screen: one card per LINEAGE (never per
 * version), a detail view showing the current version prominently plus
 * a "Previous rates" history, and Create/Revise forms that share the
 * same fixed rate grid. All writes go through rateCardService — never
 * db.rateCards.insert()/update() directly, per the append-only
 * guarantee from Part 3.
 */
export default function RateCardsApp({ workspace, db }) {
  const { t } = useTranslation(["rateCards", "common"]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [mode, setMode] = useState("list"); // "list" | "create" | "detail" | "revise"
  const [selectedLineageId, setSelectedLineageId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null); // {id, active} | null
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const { data: lineages, loading: listLoading } = useAsyncData(
    () => listRateCardLineagesForWorkspace(workspace.id, db),
    [workspace.id, db, refreshTick]
  );

  const { data: detail, loading: detailLoading } = useAsyncData(
    () => (selectedLineageId ? getRateCardLineageSummary(selectedLineageId, db) : Promise.resolve(null)),
    [selectedLineageId, db, refreshTick]
  );

  function startCreate() {
    setForm(EMPTY_FORM);
    setSaveError("");
    setMode("create");
  }

  function openDetail(lineageId) {
    setSelectedLineageId(lineageId);
    setRenaming(false);
    setMode("detail");
  }

  function startRevise() {
    if (!detail?.currentVersion) return;
    setForm({ name: detail.lineage.name, effectiveFrom: "", rates: detail.currentVersion.rates });
    setSaveError("");
    setMode("revise");
  }

  async function saveCreate() {
    if (!form.name || !form.effectiveFrom) return;
    setSaving(true);
    try {
      await createRateCard(
        { workspaceId: workspace.id, name: form.name, effectiveFrom: form.effectiveFrom, rates: form.rates, payType: form.payType },
        db
      );
      setRefreshTick((t2) => t2 + 1);
      setForm(EMPTY_FORM);
      setMode("list");
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveRevise() {
    if (!form.effectiveFrom) return;
    setSaving(true);
    try {
      await reviseRateCard(selectedLineageId, { effectiveFrom: form.effectiveFrom, rates: form.rates }, db);
      setRefreshTick((t2) => t2 + 1);
      setSaveError("");
      setMode("detail");
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveRename() {
    if (!renameValue.trim()) return;
    await renameRateCardLineage(selectedLineageId, renameValue.trim(), db);
    setRenaming(false);
    setRefreshTick((t2) => t2 + 1);
  }

  async function confirmArchiveToggle() {
    if (!archiveTarget) return;
    if (archiveTarget.active) {
      await archiveRateCardLineage(archiveTarget.id, db);
    } else {
      await restoreRateCardLineage(archiveTarget.id, db);
    }
    setArchiveTarget(null);
    setRefreshTick((t2) => t2 + 1);
  }

  if (mode === "create" || mode === "revise") {
    // In "revise", payType is inherited from the lineage — locked once
    // set at creation (rateCardService.reviseRateCard enforces this
    // server-side too), so there's no selector for it here, only in
    // "create". Either way, a per_load lineage has nothing to
    // configure in the rate grid — see the architecture proposal §2.2.
    const effectivePayType = mode === "create" ? form.payType : detail?.lineage?.payType;
    return (
      <div style={{ color: "#EDEEF0", fontFamily: "'Barlow', sans-serif" }}>
        <PageHeader
          leading={
            mode === "revise" ? (
              <button onClick={() => setMode("detail")} style={navBtnStyle} aria-label={t("rateCards:detail.backToList")}>
                <ChevronLeft size={18} />
              </button>
            ) : null
          }
          title={mode === "revise" ? t("rateCards:form.reviseTitle") : t("rateCards:form.createTitle")}
          subtitle={mode === "revise" ? detail?.lineage?.name : undefined}
        />
        <div className="shell-content" style={{ padding: 16 }}>
          {mode === "revise" && (
            <div style={{ fontSize: 12, color: "#8B909A", marginBottom: 12 }}>{t("rateCards:form.reviseIntro")}</div>
          )}

          <Card>
            {mode === "create" && (
              <>
                <Field label={t("rateCards:form.name")}>
                  <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Field>
                <Field label={t("rateCards:form.payType")}>
                  <select style={inputStyle} value={form.payType} onChange={(e) => setForm({ ...form, payType: e.target.value })}>
                    {PAY_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`rateCards:form.payTypeOptions.${type}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <div style={{ fontSize: 11, color: "#8B909A", marginTop: -8, marginBottom: 14 }}>{t("rateCards:form.payTypeHint")}</div>
              </>
            )}
            <Field label={t("rateCards:form.effectiveFrom")}>
              <input
                type="date"
                style={inputStyle}
                value={form.effectiveFrom}
                onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
              />
              {mode === "revise" && detail?.currentVersion && (
                <div style={{ fontSize: 11, color: "#8B909A", marginTop: 6 }}>
                  {t("rateCards:form.effectiveFromMustBeLater", { date: detail.currentVersion.effectiveFrom })}
                </div>
              )}
            </Field>
          </Card>

          {effectivePayType === "per_load" ? (
            <Card style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, color: "#B8BCC4" }}>{t("rateCards:form.perLoadNoGrid")}</div>
            </Card>
          ) : (
            <Card style={{ marginTop: 12 }}>
              <Field label={t("rateCards:form.rates")}>
                <RateGridField rates={form.rates} onChange={(rates) => setForm({ ...form, rates })} />
              </Field>
            </Card>
          )}

          {saveError && <div style={{ color: "#FF5A5F", fontSize: 13, marginTop: 10 }}>{saveError}</div>}

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              onClick={mode === "revise" ? saveRevise : saveCreate}
              disabled={saving}
              style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}
            >
              {t("common:save")}
            </button>
            <button onClick={() => setMode(mode === "revise" ? "detail" : "list")} style={secondaryBtnStyle}>
              {t("common:cancel")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "detail") {
    if (detailLoading && !detail) {
      return (
        <div className="shell-content" style={{ padding: 16, color: "#8B909A", fontFamily: "'Barlow', sans-serif" }}>
          {t("common:loading")}
        </div>
      );
    }
    if (!detail) return null;
    const { lineage, versions, currentVersion } = detail;
    const previousVersions = versions.slice(1); // versions is newest-first; [0] is currentVersion

    return (
      <div style={{ color: "#EDEEF0", fontFamily: "'Barlow', sans-serif" }}>
        <PageHeader
          leading={
            <button onClick={() => setMode("list")} style={navBtnStyle} aria-label={t("rateCards:detail.backToList")}>
              <ChevronLeft size={18} />
            </button>
          }
          title={lineage.name}
          action={<StatusBadge active={!lineage.archivedAt} />}
        />
        <div className="shell-content" style={{ padding: 16 }}>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
              {t("rateCards:detail.currentRate")}
            </div>
            {currentVersion ? (
              <>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15, marginBottom: 10 }}>
                  {t("rateCards:detail.effectiveFrom", { date: currentVersion.effectiveFrom })}
                </div>
                {lineage.payType === "per_load" ? (
                  <div style={{ fontSize: 13, color: "#B8BCC4" }}>{t("rateCards:form.perLoadNoGrid")}</div>
                ) : (
                  <RateGridField rates={currentVersion.rates} onChange={() => {}} readOnly />
                )}
              </>
            ) : (
              <div style={{ color: "#8B909A", fontSize: 13 }}>{t("rateCards:list.noVersionsYet")}</div>
            )}
          </Card>

          {renaming ? (
            <Card style={{ marginBottom: 16 }}>
              <Field label={t("rateCards:form.name")}>
                <input style={inputStyle} value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
              </Field>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={saveRename} style={primaryBtnStyle}>
                  {t("common:save")}
                </button>
                <button onClick={() => setRenaming(false)} style={secondaryBtnStyle}>
                  {t("common:cancel")}
                </button>
              </div>
            </Card>
          ) : (
            <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
              {!lineage.archivedAt && (
                <button onClick={startRevise} style={{ ...primaryBtnStyle, flex: "0 0 auto", padding: "10px 16px" }}>
                  {t("rateCards:detail.reviseAction")}
                </button>
              )}
              <button
                onClick={() => { setRenaming(true); setRenameValue(lineage.name); }}
                style={{ ...secondaryBtnStyle, padding: "10px 16px" }}
              >
                {t("rateCards:detail.renameAction")}
              </button>
              <button
                onClick={() => setArchiveTarget({ id: lineage.id, active: !lineage.archivedAt })}
                style={{ ...secondaryBtnStyle, padding: "10px 16px" }}
              >
                {lineage.archivedAt ? t("common:restore") : t("common:archive")}
              </button>
            </div>
          )}

          <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
            {t("rateCards:detail.previousRates")}
          </div>
          {previousVersions.length === 0 && (
            <div style={{ color: "#8B909A", fontSize: 13 }}>{t("rateCards:detail.noPreviousRates")}</div>
          )}
          {previousVersions.map((version) => (
            <details key={version.id} style={{ marginBottom: 10 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, color: "#B8BCC4" }}>
                {t("rateCards:detail.effectiveFrom", { date: version.effectiveFrom })}
              </summary>
              <Card style={{ marginTop: 8 }}>
                {lineage.payType === "per_load" ? (
                  <div style={{ fontSize: 13, color: "#B8BCC4" }}>{t("rateCards:form.perLoadNoGrid")}</div>
                ) : (
                  <RateGridField rates={version.rates} onChange={() => {}} readOnly />
                )}
              </Card>
            </details>
          ))}
        </div>

        <ArchiveConfirmDialog
          open={Boolean(archiveTarget)}
          title={archiveTarget?.active ? t("rateCards:form.archiveConfirmTitle") : t("rateCards:form.restoreConfirmTitle")}
          body={archiveTarget?.active ? t("rateCards:form.archiveConfirmBody") : null}
          confirmLabel={archiveTarget?.active ? t("common:archive") : t("common:restore")}
          onConfirm={confirmArchiveToggle}
          onCancel={() => setArchiveTarget(null)}
        />
      </div>
    );
  }

  // mode === "list"
  if (listLoading && !lineages) {
    return (
      <div className="shell-content" style={{ padding: 16, color: "#8B909A", fontFamily: "'Barlow', sans-serif" }}>
        {t("common:loading")}
      </div>
    );
  }
  const lineageSummaries = lineages ?? [];

  return (
    <div style={{ color: "#EDEEF0", fontFamily: "'Barlow', sans-serif" }}>
      <PageHeader
        title={t("rateCards:list.title")}
        subtitle={t("rateCards:list.subtitle", { count: lineageSummaries.length })}
        action={
          <button onClick={startCreate} style={{ ...primaryBtnStyle, display: "flex", alignItems: "center", gap: 6, padding: "10px 16px" }}>
            <Plus size={16} /> {t("rateCards:list.addRateCard")}
          </button>
        }
      />
      <div className="shell-content" style={{ padding: 16 }}>
        {lineageSummaries.length === 0 && <EmptyState title={t("rateCards:list.empty")} />}

        {lineageSummaries.map(({ lineage, currentVersion, versionCount }) => (
          <Card
            key={lineage.id}
            style={{ marginBottom: 10, cursor: "pointer" }}
            onClick={() => openDetail(lineage.id)}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15 }}>{lineage.name}</div>
                <div style={{ fontSize: 12, color: "#8B909A", marginTop: 2 }}>
                  {currentVersion
                    ? t("rateCards:list.effectiveFrom", { date: currentVersion.effectiveFrom })
                    : t("rateCards:list.noVersionsYet")}
                  {" · "}
                  {t("rateCards:list.versionCount", { count: versionCount })}
                  {lineage.payType === "per_load" && ` · ${t("rateCards:form.payTypeOptions.per_load")}`}
                </div>
              </div>
              <StatusBadge active={!lineage.archivedAt} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
