import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { deleteCpcTrainingRecord, listCpcTrainingRecords, logCpcTraining, resolveCpcCycleStatusForDriver } from "../../services/cpcTrainingService.js";
import { Card, Field, EmptyState, ComplianceStatusCard } from "../shared/atoms.jsx";
import { inputStyle, primaryBtnStyle, secondaryBtnStyle, iconBtnStyle } from "../shared/styles.js";
import PageHeader from "../shell/PageHeader.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { toKey } from "../../services/shiftMath.js";

const EMPTY_FORM = { date: "", hours: "7", provider: "", notes: "" };

// Maps cpcTrainingEngine's ok/warning/problem/unknown_cycle onto the
// ok/warning/problem colour idiom ComplianceStatusCard already uses —
// 'unknown_cycle' (no active cpc_card document yet) is a "warning" nudge
// to add one under Documents, not a hard "problem".
const CPC_STATUS_TO_CARD_STATUS = { ok: "ok", warning: "warning", problem: "problem", unknown_cycle: "warning" };

async function loadCpcTrainingData(personId, db) {
  const [records, cycleStatus] = await Promise.all([
    listCpcTrainingRecords(personId, db),
    resolveCpcCycleStatusForDriver(personId, db),
  ]);
  const sortedRecords = [...records].sort((a, b) => b.date.localeCompare(a.date));
  return { records: sortedRecords, cycleStatus };
}

export default function CpcTrainingApp({ personId, db }) {
  const { t } = useTranslation(["cpcTraining", "common"]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [mode, setMode] = useState("list");
  const [form, setForm] = useState(EMPTY_FORM);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, loading } = useAsyncData(() => loadCpcTrainingData(personId, db), [personId, db, refreshTick]);
  const records = data?.records ?? [];
  const cycleStatus = data?.cycleStatus ?? { hoursCompleted: 0, hoursRequired: 35, status: "unknown_cycle", cycleEndDate: null };

  function startLog() {
    setForm({ ...EMPTY_FORM, date: toKey(new Date()) });
    setSaveError("");
    setMode("log");
  }

  async function save() {
    if (!form.date || !form.hours || Number(form.hours) <= 0) return;
    setSaving(true);
    try {
      await logCpcTraining(
        { personId, date: form.date, hours: Number(form.hours), provider: form.provider || null, notes: form.notes || null },
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

  async function handleDelete(id) {
    await deleteCpcTrainingRecord(id, db);
    setRefreshTick((t2) => t2 + 1);
  }

  if (loading && !data) {
    return (
      <div className="shell-content" style={{ padding: 16, color: "#8B909A", fontFamily: "'Barlow', sans-serif" }}>
        {t("common:loading")}
      </div>
    );
  }

  if (mode === "log") {
    return (
      <div style={{ color: "#EDEEF0", fontFamily: "'Barlow', sans-serif" }}>
        <PageHeader title={t("cpcTraining:logTitle")} />
        <div className="shell-content" style={{ padding: 16 }}>
          <Card>
            <Field label={t("cpcTraining:form.date")}>
              <input type="date" style={inputStyle} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label={t("cpcTraining:form.hours")}>
              <input
                type="number"
                step="0.5"
                min="0"
                style={inputStyle}
                value={form.hours}
                onChange={(e) => setForm({ ...form, hours: e.target.value })}
              />
            </Field>
            <Field label={t("cpcTraining:form.provider")}>
              <input style={inputStyle} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
            </Field>
            <Field label={t("cpcTraining:form.notes")}>
              <input style={inputStyle} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </Card>

          {saveError && <div style={{ color: "#FF5A5F", fontSize: 13, marginTop: 10 }}>{saveError}</div>}

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button onClick={save} disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>
              {t("common:save")}
            </button>
            <button onClick={() => { setForm(EMPTY_FORM); setMode("list"); }} style={secondaryBtnStyle}>
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
        title={t("cpcTraining:title")}
        subtitle={t("cpcTraining:subtitle", { count: records.length })}
        action={
          <button onClick={startLog} style={{ ...primaryBtnStyle, display: "flex", alignItems: "center", gap: 6, padding: "10px 16px" }}>
            <Plus size={16} /> {t("cpcTraining:logTraining")}
          </button>
        }
      />
      <div className="shell-content" style={{ padding: 16 }}>
        <div style={{ marginBottom: 16 }}>
          <ComplianceStatusCard
            categoryLabel={t("cpcTraining:cycleCard.title")}
            remainingLabel={
              cycleStatus.status === "unknown_cycle"
                ? t("cpcTraining:cycleCard.unknownCycle")
                : t("cpcTraining:cycleCard.progress", { completed: cycleStatus.hoursCompleted, required: cycleStatus.hoursRequired, date: cycleStatus.cycleEndDate })
            }
            statusLabel={t(`cpcTraining:status.${cycleStatus.status}`)}
            status={CPC_STATUS_TO_CARD_STATUS[cycleStatus.status]}
          />
        </div>

        {records.length === 0 && <EmptyState title={t("cpcTraining:empty")} />}

        {records.map((record) => (
          <Card key={record.id} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15 }}>
                  {t("cpcTraining:sessionSummary", { date: record.date, hours: record.hours })}
                </div>
                {record.provider && <div style={{ fontSize: 12, color: "#8B909A", marginTop: 2 }}>{record.provider}</div>}
              </div>
              <button onClick={() => handleDelete(record.id)} style={iconBtnStyle} aria-label={t("common:delete")}>
                <Trash2 size={14} color="#FF5A5F" />
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
