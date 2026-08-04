import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, ChevronLeft } from "lucide-react";
import {
  archivePlacement,
  createPlacement,
  listPlacementSummariesForWorkspace,
  restorePlacement,
} from "../../services/placementService.js";
import { createAssignment, endAssignment, listAssignmentsForPlacement } from "../../services/assignmentService.js";
import { listEngagementsForWorkspace } from "../../services/engagementService.js";
import { listOrganisationsForWorkspace } from "../../services/organisationService.js";
import { listSitesForWorkspace } from "../../services/siteService.js";
import { listRateCardLineagesForWorkspace, getRateCardLineageSummary } from "../../services/rateCardService.js";
import { resolvePersonDisplayName } from "../../services/driverService.js";
import { Card, Field, EmptyState, StatusBadge, ArchiveConfirmDialog } from "../shared/atoms.jsx";
import { inputStyle, primaryBtnStyle, secondaryBtnStyle, navBtnStyle } from "../shared/styles.js";
import PageHeader from "../shell/PageHeader.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";

const EMPTY_FORM = { providerOrganisationId: "", siteId: "", rateCardLineageId: "", effectiveFrom: "" };

async function loadPlacementsListData(workspaceId, db) {
  const [summaries, organisations, sites] = await Promise.all([
    listPlacementSummariesForWorkspace(workspaceId, db),
    listOrganisationsForWorkspace(workspaceId, db),
    listSitesForWorkspace(workspaceId, db),
  ]);
  const organisationById = new Map(organisations.map((o) => [o.id, o]));
  const siteById = new Map(sites.map((s) => [s.id, s]));
  return { summaries, organisationById, siteById };
}

async function loadCreateFormData(workspaceId, db) {
  const [organisations, sites, lineageSummaries] = await Promise.all([
    listOrganisationsForWorkspace(workspaceId, db),
    listSitesForWorkspace(workspaceId, db),
    listRateCardLineagesForWorkspace(workspaceId, db),
  ]);
  return {
    organisations: organisations.filter((o) => !o.archivedAt),
    sites: sites.filter((s) => !s.archivedAt),
    lineages: lineageSummaries.filter(({ lineage }) => !lineage.archivedAt).map(({ lineage }) => lineage),
  };
}

async function loadPlacementDetailData(placementId, workspaceId, db) {
  const placement = await db.placements.getById(placementId);
  if (!placement) return null;
  const [providerOrganisation, site, lineageSummary, assignments, engagements] = await Promise.all([
    db.organisations.getById(placement.providerOrganisationId),
    db.sites.getById(placement.siteId),
    getRateCardLineageSummary(placement.rateCardLineageId, db),
    listAssignmentsForPlacement(placementId, db),
    listEngagementsForWorkspace(workspaceId, db),
  ]);
  const siteOrganisation = site ? await db.organisations.getById(site.organisationId) : null;

  const engagementById = new Map(engagements.map((e) => [e.id, e]));
  const driverIds = [...new Set(assignments.map((a) => engagementById.get(a.engagementId)?.driverId).filter(Boolean))];
  const people = await Promise.all(driverIds.map((id) => db.people.getById(id)));
  const personById = new Map(people.filter(Boolean).map((p) => [p.id, p]));

  const assignmentRows = assignments
    .map((assignment) => {
      const engagement = engagementById.get(assignment.engagementId);
      const person = engagement ? personById.get(engagement.driverId) : null;
      return { assignment, engagement, person };
    })
    .filter((row) => row.engagement);

  // Eligible for "assign driver": an active Engagement whose provider
  // matches this Placement's, with no already-active Assignment onto it.
  const alreadyAssignedEngagementIds = new Set(
    assignments.filter((a) => a.endDate === null).map((a) => a.engagementId)
  );
  const eligibleEngagements = engagements.filter(
    (e) =>
      e.status === "active" &&
      e.providerOrganisationId === placement.providerOrganisationId &&
      !alreadyAssignedEngagementIds.has(e.id)
  );
  const eligiblePeople = await Promise.all(eligibleEngagements.map((e) => db.people.getById(e.driverId)));
  const eligibleDrivers = eligibleEngagements.map((e, i) => ({ engagement: e, person: eligiblePeople[i] })).filter((d) => d.person);

  return { placement, providerOrganisation, site, siteOrganisation, lineageSummary, assignmentRows, eligibleDrivers };
}

/**
 * Work Placements management screen: the shared, driver-agnostic
 * "provider + site + rate" context (Stage 4D) that multiple drivers'
 * Assignments can reference — list / create / detail (assign/end
 * drivers, archive/restore). Engagement management itself lives in
 * Driver detail, not here (see DriverDrilldown.jsx) — this screen only
 * manages the shared Placement and who is currently on it.
 */
export default function PlacementsApp({ workspace, db }) {
  const { t } = useTranslation(["placements", "common"]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [mode, setMode] = useState("list"); // "list" | "create" | "detail"
  const [selectedPlacementId, setSelectedPlacementId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null); // {id, active} | null
  const [blockedMessage, setBlockedMessage] = useState("");
  const [assignPersonId, setAssignPersonId] = useState("");

  const { data: listData, loading: listLoading } = useAsyncData(
    () => loadPlacementsListData(workspace.id, db),
    [workspace.id, db, refreshTick]
  );

  const { data: createFormData } = useAsyncData(
    () => (mode === "create" ? loadCreateFormData(workspace.id, db) : Promise.resolve(null)),
    [mode, workspace.id, db, refreshTick]
  );

  const { data: detail, loading: detailLoading } = useAsyncData(
    () => (selectedPlacementId ? loadPlacementDetailData(selectedPlacementId, workspace.id, db) : Promise.resolve(null)),
    [selectedPlacementId, workspace.id, db, refreshTick]
  );

  function startCreate() {
    setForm(EMPTY_FORM);
    setSaveError("");
    setMode("create");
  }

  function openDetail(placementId) {
    setSelectedPlacementId(placementId);
    setAssignPersonId("");
    setMode("detail");
  }

  async function saveCreate() {
    if (!form.providerOrganisationId || !form.siteId || !form.rateCardLineageId || !form.effectiveFrom) return;
    setSaving(true);
    try {
      await createPlacement({ workspaceId: workspace.id, ...form }, db);
      setRefreshTick((t2) => t2 + 1);
      setForm(EMPTY_FORM);
      setMode("list");
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function assignDriver() {
    if (!assignPersonId || !detail) return;
    const chosen = detail.eligibleDrivers.find((d) => d.person.id === assignPersonId);
    if (!chosen) return;
    setSaveError("");
    try {
      await createAssignment(
        { engagementId: chosen.engagement.id, placementId: detail.placement.id, startDate: new Date().toISOString().slice(0, 10) },
        db
      );
      setAssignPersonId("");
      setRefreshTick((t2) => t2 + 1);
    } catch (e) {
      setSaveError(e.message);
    }
  }

  async function endDriverAssignment(assignmentId) {
    await endAssignment(assignmentId, new Date().toISOString().slice(0, 10), db);
    setRefreshTick((t2) => t2 + 1);
  }

  function requestArchiveToggle(summary) {
    const { placement, activeAssignmentCount } = summary;
    if (!placement.archivedAt && activeAssignmentCount > 0) {
      setBlockedMessage(t("placements:list.archiveBlocked", { count: activeAssignmentCount }));
      return;
    }
    setArchiveTarget({ id: placement.id, active: !placement.archivedAt });
  }

  async function confirmArchiveToggle() {
    if (!archiveTarget) return;
    try {
      if (archiveTarget.active) {
        await archivePlacement(archiveTarget.id, db);
      } else {
        await restorePlacement(archiveTarget.id, db);
      }
      setArchiveTarget(null);
      setRefreshTick((t2) => t2 + 1);
    } catch (e) {
      setArchiveTarget(null);
      setBlockedMessage(e.message);
    }
  }

  if (mode === "create") {
    const formData = createFormData ?? { organisations: [], sites: [], lineages: [] };
    return (
      <div style={{ color: "#EDEEF0", fontFamily: "'Barlow', sans-serif" }}>
        <PageHeader
          leading={
            <button onClick={() => setMode("list")} style={navBtnStyle} aria-label={t("placements:detail.backToList")}>
              <ChevronLeft size={18} />
            </button>
          }
          title={t("placements:form.createTitle")}
        />
        <div className="shell-content" style={{ padding: 16 }}>
          <Card>
            <Field label={t("placements:form.provider")}>
              <select
                style={inputStyle}
                value={form.providerOrganisationId}
                onChange={(e) => setForm({ ...form, providerOrganisationId: e.target.value })}
              >
                <option value="">{t("placements:form.selectPlaceholder")}</option>
                {formData.organisations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.tradingName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("placements:form.site")}>
              <select style={inputStyle} value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
                <option value="">{t("placements:form.selectPlaceholder")}</option>
                {formData.sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("placements:form.rateCard")}>
              <select
                style={inputStyle}
                value={form.rateCardLineageId}
                onChange={(e) => setForm({ ...form, rateCardLineageId: e.target.value })}
              >
                <option value="">{t("placements:form.selectPlaceholder")}</option>
                {formData.lineages.map((lineage) => (
                  <option key={lineage.id} value={lineage.id}>
                    {lineage.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("placements:form.effectiveFrom")}>
              <input
                type="date"
                style={inputStyle}
                value={form.effectiveFrom}
                onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
              />
            </Field>
          </Card>

          {saveError && <div style={{ color: "#FF5A5F", fontSize: 13, marginTop: 10 }}>{saveError}</div>}

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button onClick={saveCreate} disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>
              {t("common:save")}
            </button>
            <button onClick={() => setMode("list")} style={secondaryBtnStyle}>
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
    const { placement, providerOrganisation, site, siteOrganisation, lineageSummary, assignmentRows, eligibleDrivers } = detail;
    const activeRows = assignmentRows.filter((r) => r.assignment.endDate === null);
    const endedRows = assignmentRows.filter((r) => r.assignment.endDate !== null);

    return (
      <div style={{ color: "#EDEEF0", fontFamily: "'Barlow', sans-serif" }}>
        <PageHeader
          leading={
            <button onClick={() => setMode("list")} style={navBtnStyle} aria-label={t("placements:detail.backToList")}>
              <ChevronLeft size={18} />
            </button>
          }
          title={`${providerOrganisation?.tradingName ?? "—"} — ${site?.name ?? "—"}`}
          subtitle={siteOrganisation ? siteOrganisation.tradingName : undefined}
          action={<StatusBadge active={!placement.archivedAt} />}
        />
        <div className="shell-content" style={{ padding: 16 }}>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
              {t("placements:detail.rateCardLabel")}
            </div>
            <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15 }}>{lineageSummary?.lineage?.name ?? "—"}</div>
          </Card>

          <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
            {t("placements:detail.activeDrivers", { count: activeRows.length })}
          </div>
          {activeRows.length === 0 && <div style={{ color: "#8B909A", fontSize: 13, marginBottom: 12 }}>{t("placements:detail.noActiveDrivers")}</div>}
          {activeRows.map(({ assignment, engagement, person }) => (
            <Card key={assignment.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15 }}>{resolvePersonDisplayName(person)}</div>
                  <div style={{ fontSize: 12, color: "#8B909A", marginTop: 2 }}>
                    {t(`placements:relationshipTypes.${engagement.relationshipType}`, engagement.relationshipType)}
                    {" · "}
                    {t("placements:detail.since", { date: assignment.startDate })}
                  </div>
                </div>
                <button onClick={() => endDriverAssignment(assignment.id)} style={{ ...secondaryBtnStyle, padding: "6px 10px", fontSize: 12 }}>
                  {t("placements:detail.endAction")}
                </button>
              </div>
            </Card>
          ))}

          {!placement.archivedAt && (
            <Card style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                {t("placements:detail.assignDriverLabel")}
              </div>
              {eligibleDrivers.length === 0 ? (
                <div style={{ color: "#8B909A", fontSize: 13 }}>{t("placements:detail.noEligibleDrivers")}</div>
              ) : (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <select style={{ ...inputStyle, flex: 1, minWidth: 160 }} value={assignPersonId} onChange={(e) => setAssignPersonId(e.target.value)}>
                    <option value="">{t("placements:form.selectPlaceholder")}</option>
                    {eligibleDrivers.map(({ person }) => (
                      <option key={person.id} value={person.id}>
                        {resolvePersonDisplayName(person)}
                      </option>
                    ))}
                  </select>
                  <button onClick={assignDriver} disabled={!assignPersonId} style={{ ...primaryBtnStyle, padding: "10px 16px", opacity: assignPersonId ? 1 : 0.5 }}>
                    {t("placements:detail.assignAction")}
                  </button>
                </div>
              )}
              {saveError && <div style={{ color: "#FF5A5F", fontSize: 13, marginTop: 10 }}>{saveError}</div>}
            </Card>
          )}

          {endedRows.length > 0 && (
            <details style={{ marginBottom: 16 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, color: "#B8BCC4" }}>
                {t("placements:detail.endedDrivers", { count: endedRows.length })}
              </summary>
              {endedRows.map(({ assignment, engagement, person }) => (
                <Card key={assignment.id} style={{ marginTop: 8 }}>
                  <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14 }}>{resolvePersonDisplayName(person)}</div>
                  <div style={{ fontSize: 12, color: "#8B909A", marginTop: 2 }}>
                    {t(`placements:relationshipTypes.${engagement.relationshipType}`, engagement.relationshipType)}
                    {" · "}
                    {assignment.startDate} – {assignment.endDate}
                  </div>
                </Card>
              ))}
            </details>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => requestArchiveToggle({ placement, activeAssignmentCount: activeRows.length })}
              style={{ ...secondaryBtnStyle, padding: "10px 16px" }}
            >
              {placement.archivedAt ? t("common:restore") : t("common:archive")}
            </button>
          </div>
        </div>

        <ArchiveConfirmDialog
          open={Boolean(archiveTarget)}
          title={archiveTarget?.active ? t("placements:list.archiveConfirmTitle") : t("placements:list.restoreConfirmTitle")}
          body={archiveTarget?.active ? t("placements:list.archiveConfirmBody") : null}
          confirmLabel={archiveTarget?.active ? t("common:archive") : t("common:restore")}
          onConfirm={confirmArchiveToggle}
          onCancel={() => setArchiveTarget(null)}
        />
        <ArchiveConfirmDialog
          open={Boolean(blockedMessage)}
          title={t("placements:list.archiveBlockedTitle")}
          body={blockedMessage}
          confirmLabel={t("common:ok")}
          onConfirm={() => setBlockedMessage("")}
          onCancel={() => setBlockedMessage("")}
        />
      </div>
    );
  }

  // mode === "list"
  if (listLoading && !listData) {
    return (
      <div className="shell-content" style={{ padding: 16, color: "#8B909A", fontFamily: "'Barlow', sans-serif" }}>
        {t("common:loading")}
      </div>
    );
  }
  const summaries = listData?.summaries ?? [];
  const organisationById = listData?.organisationById ?? new Map();
  const siteById = listData?.siteById ?? new Map();

  return (
    <div style={{ color: "#EDEEF0", fontFamily: "'Barlow', sans-serif" }}>
      <PageHeader
        title={t("placements:list.title")}
        subtitle={t("placements:list.subtitle", { count: summaries.length })}
        action={
          <button onClick={startCreate} style={{ ...primaryBtnStyle, display: "flex", alignItems: "center", gap: 6, padding: "10px 16px" }}>
            <Plus size={16} /> {t("placements:list.addPlacement")}
          </button>
        }
      />
      <div className="shell-content" style={{ padding: 16 }}>
        {summaries.length === 0 && <EmptyState title={t("placements:list.empty")} />}

        {summaries.map((summary) => {
          const { placement, activeAssignmentCount } = summary;
          const provider = organisationById.get(placement.providerOrganisationId);
          const site = siteById.get(placement.siteId);
          return (
            <Card key={placement.id} style={{ marginBottom: 10, cursor: "pointer" }} onClick={() => openDetail(placement.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15 }}>
                    {provider?.tradingName ?? "—"} — {site?.name ?? "—"}
                  </div>
                  <div style={{ fontSize: 12, color: "#8B909A", marginTop: 2 }}>
                    {t("placements:list.driverCount", { count: activeAssignmentCount })}
                  </div>
                </div>
                <StatusBadge active={!placement.archivedAt} />
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
