import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Star } from "lucide-react";
import { resolveActiveAssignmentsForDriver } from "../../services/assignmentService.js";
import { createSoloWorkContext, getDriver, setPreferredAssignment } from "../../services/driverService.js";
import { listOrganisationsForWorkspace } from "../../services/organisationService.js";
import { Card, Field, EmptyState } from "../shared/atoms.jsx";
import { inputStyle, primaryBtnStyle, secondaryBtnStyle, iconBtnStyle } from "../shared/styles.js";
import RateGridField, { emptyRates } from "../management/RateGridField.jsx";
import PageHeader from "../shell/PageHeader.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";

const NEW_ORG = "__new__";
const RELATIONSHIP_TYPES = ["agency_worker", "employee", "subcontractor", "self_employed", "other"];
const PAY_TYPES = ["hourly", "per_load"];
const EMPTY_FORM = {
  providerChoice: NEW_ORG,
  providerName: "",
  clientChoice: NEW_ORG,
  clientName: "",
  siteName: "",
  rateCardName: "",
  payType: "hourly",
  relationshipType: "agency_worker",
  startDate: "",
};

/**
 * Root data-fetch: every currently-active Assignment this driver holds,
 * ACROSS every workspace (resolveActiveAssignmentsForDriver already
 * spans them — a company-employed driver moonlighting elsewhere still
 * sees both here), which of them is their explicit preferredAssignmentId
 * (see driverService.setPreferredAssignment), and the personal
 * workspace's own Organisations (to offer "reuse an existing one" when
 * adding a second workplace with the same agency).
 */
async function loadWorkplacesData(personId, homeWorkspaceId, db) {
  const [activeAssignments, driver, organisations] = await Promise.all([
    resolveActiveAssignmentsForDriver(personId, db),
    homeWorkspaceId ? getDriver(homeWorkspaceId, personId, db) : null,
    homeWorkspaceId ? listOrganisationsForWorkspace(homeWorkspaceId, db) : [],
  ]);
  const lineages = await Promise.all(
    activeAssignments.map((a) => (a.rateCard ? db.rateCardLineages.getById(a.rateCard.lineageId) : null))
  );
  const withLineageName = activeAssignments.map((a, i) => ({
    ...a,
    rateCardLineageName: lineages[i]?.name ?? null,
    payType: lineages[i]?.payType ?? "hourly",
  }));
  return {
    activeAssignments: withLineageName,
    preferredAssignmentId: driver?.driverProfile?.preferredAssignmentId ?? null,
    organisations,
  };
}

function OrgPicker({ label, organisations, choice, onChoiceChange, name, onNameChange }) {
  const { t } = useTranslation(["driver", "common"]);
  return (
    <Field label={label}>
      <select style={inputStyle} value={choice} onChange={(e) => onChoiceChange(e.target.value)}>
        {organisations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.tradingName}
          </option>
        ))}
        <option value={NEW_ORG}>{t("driver:workplaces.addNewOrganisation")}</option>
      </select>
      {choice === NEW_ORG && (
        <input
          style={{ ...inputStyle, marginTop: 8 }}
          placeholder={t("driver:workplaces.organisationNamePlaceholder")}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
      )}
    </Field>
  );
}

export default function WorkplacesApp({ personId, homeWorkspaceId, db }) {
  const { t } = useTranslation(["driver", "placements", "rateCards", "common"]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [mode, setMode] = useState("list");
  const [form, setForm] = useState(EMPTY_FORM);
  const [rates, setRates] = useState(emptyRates());
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, loading } = useAsyncData(
    () => loadWorkplacesData(personId, homeWorkspaceId, db),
    [personId, homeWorkspaceId, db, refreshTick]
  );
  const activeAssignments = data?.activeAssignments ?? [];
  const preferredAssignmentId = data?.preferredAssignmentId ?? null;
  const organisations = data?.organisations ?? [];

  function resetForm() {
    setForm({ ...EMPTY_FORM, startDate: new Date().toISOString().slice(0, 10) });
    setRates(emptyRates());
    setSaveError("");
  }

  function startCreate() {
    resetForm();
    setMode("create");
  }

  async function save() {
    if (!form.siteName || !form.rateCardName || !form.startDate) return;
    if (form.providerChoice === NEW_ORG && !form.providerName) return;
    if (form.clientChoice === NEW_ORG && !form.clientName) return;
    setSaving(true);
    try {
      await createSoloWorkContext(
        {
          workspaceId: homeWorkspaceId,
          driverId: personId,
          startDate: form.startDate,
          relationshipType: form.relationshipType,
          providerOrganisationId: form.providerChoice === NEW_ORG ? undefined : form.providerChoice,
          providerOrganisationName: form.providerChoice === NEW_ORG ? form.providerName : undefined,
          clientOrganisationId: form.clientChoice === NEW_ORG ? undefined : form.clientChoice,
          clientOrganisationName: form.clientChoice === NEW_ORG ? form.clientName : undefined,
          siteName: form.siteName,
          rateCardName: form.rateCardName,
          payType: form.payType,
          rates,
        },
        db
      );
      setRefreshTick((t2) => t2 + 1);
      resetForm();
      setMode("list");
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault(assignmentId) {
    if (!homeWorkspaceId) return;
    await setPreferredAssignment(homeWorkspaceId, personId, assignmentId, db);
    setRefreshTick((t2) => t2 + 1);
  }

  if (loading && !data) {
    return (
      <div className="shell-content" style={{ padding: 16, color: "#8B909A", fontFamily: "'Barlow', sans-serif" }}>
        {t("common:loading")}
      </div>
    );
  }

  if (mode === "create") {
    return (
      <div style={{ color: "#EDEEF0", fontFamily: "'Barlow', sans-serif" }}>
        <PageHeader title={t("driver:workplaces.addTitle")} />
        <div className="shell-content" style={{ padding: 16 }}>
          <Card>
            <OrgPicker
              label={t("driver:workplaces.provider")}
              organisations={organisations}
              choice={form.providerChoice}
              onChoiceChange={(v) => setForm({ ...form, providerChoice: v })}
              name={form.providerName}
              onNameChange={(v) => setForm({ ...form, providerName: v })}
            />
            <OrgPicker
              label={t("driver:workplaces.client")}
              organisations={organisations}
              choice={form.clientChoice}
              onChoiceChange={(v) => setForm({ ...form, clientChoice: v })}
              name={form.clientName}
              onNameChange={(v) => setForm({ ...form, clientName: v })}
            />
            <Field label={t("driver:workplaces.site")}>
              <input style={inputStyle} value={form.siteName} onChange={(e) => setForm({ ...form, siteName: e.target.value })} />
            </Field>
            <Field label={t("driver:workplaces.relationshipType")}>
              <select
                style={inputStyle}
                value={form.relationshipType}
                onChange={(e) => setForm({ ...form, relationshipType: e.target.value })}
              >
                {RELATIONSHIP_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`placements:relationshipTypes.${type}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("driver:workplaces.startDate")}>
              <input
                type="date"
                style={inputStyle}
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </Field>
            <Field label={t("driver:workplaces.rateCardName")}>
              <input
                style={inputStyle}
                value={form.rateCardName}
                onChange={(e) => setForm({ ...form, rateCardName: e.target.value })}
              />
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
          </Card>

          {form.payType === "per_load" ? (
            <Card style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, color: "#B8BCC4" }}>{t("rateCards:form.perLoadNoGrid")}</div>
            </Card>
          ) : (
            <Card style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
                {t("driver:workplaces.rates")}
              </div>
              <RateGridField rates={rates} onChange={setRates} />
            </Card>
          )}

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
        title={t("driver:workplaces.title")}
        subtitle={t("driver:workplaces.subtitle", { count: activeAssignments.length })}
        action={
          <button onClick={startCreate} style={{ ...primaryBtnStyle, display: "flex", alignItems: "center", gap: 6, padding: "10px 16px" }}>
            <Plus size={16} /> {t("driver:workplaces.addWorkplace")}
          </button>
        }
      />
      <div className="shell-content" style={{ padding: 16 }}>
        {activeAssignments.length === 0 && <EmptyState title={t("driver:workplaces.empty")} />}

        {activeAssignments.map((a) => {
          const isDefault = a.assignment.id === preferredAssignmentId;
          return (
            <Card key={a.assignment.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
                    {isDefault && <Star size={13} color="#FF8A00" fill="#FF8A00" />}
                    {[a.employerOrganisation?.tradingName, a.site?.name].filter(Boolean).join(" · ")}
                  </div>
                  <div style={{ fontSize: 12, color: "#8B909A", marginTop: 2 }}>
                    {t(`placements:relationshipTypes.${a.engagement.relationshipType}`)}
                    {a.rateCardLineageName ? ` · ${a.rateCardLineageName}` : ""}
                    {a.payType === "per_load" ? ` · ${t("rateCards:form.payTypeOptions.per_load")}` : ""}
                  </div>
                </div>
                {!isDefault && (
                  <button onClick={() => makeDefault(a.assignment.id)} style={{ ...secondaryBtnStyle, padding: "6px 10px", fontSize: 12 }}>
                    {t("driver:workplaces.setDefault")}
                  </button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
