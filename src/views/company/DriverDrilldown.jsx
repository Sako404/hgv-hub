import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";
import { listShiftsForWorkspace } from "../../services/shiftService.js";
import { computeShiftBreakdown } from "../../services/payEngine.js";
import { computeCompliance } from "../../services/complianceEngine.js";
import { buildRateCardResolver } from "../../services/rateCardService.js";
import { buildLoadsResolver } from "../../services/loadService.js";
import { resolveComplianceProfileForDriver } from "../../services/complianceProfileService.js";
import { resolvePersonDisplayName } from "../../services/driverService.js";
import { listEngagementsForWorkspace, endEngagement } from "../../services/engagementService.js";
import { listOrganisationsForWorkspace } from "../../services/organisationService.js";
import { listDriverDocuments } from "../../services/driverDocumentService.js";
import { resolveDocumentStatus } from "../../services/documentExpiryEngine.js";
import { listCpcTrainingRecords, resolveCpcCycleStatusForDriver } from "../../services/cpcTrainingService.js";
import { hrs, money, parseDateTime } from "../../services/shiftMath.js";
import { Card, ShiftHistoryList, StatusBadge, DocumentStatusBadge, ComplianceStatusCard } from "../shared/atoms.jsx";
import { navBtnStyle, secondaryBtnStyle } from "../shared/styles.js";
import PageHeader from "../shell/PageHeader.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";

/** Root data-fetch for this screen — see DriverApp.jsx's loadDriverAppData for the same pattern. */
async function loadDriverDrilldownData(workspaceId, driverPersonId, db) {
  const workspaceShifts = await listShiftsForWorkspace(workspaceId, db);
  const shifts = workspaceShifts.filter((s) => s.driverId === driverPersonId);
  const sortedShifts = [...shifts].sort((a, b) => parseDateTime(a.date, a.start) - parseDateTime(b.date, b.start));
  const resolveRateCard = await buildRateCardResolver(sortedShifts, db);
  const resolveLoads = await buildLoadsResolver(sortedShifts, db);
  const items = sortedShifts.map((s) => ({ shift: s, breakdown: computeShiftBreakdown(s, resolveRateCard(s), resolveLoads(s)) }));
  const complianceProfile = await resolveComplianceProfileForDriver(driverPersonId, db);
  const compliance = computeCompliance(sortedShifts, complianceProfile, { now: new Date() });
  return { items, compliance };
}

/**
 * Employment section data — this workspace's own Engagement records
 * for this driver (not the driver's employment with OTHER companies;
 * Engagement.workspaceId is the managing workspace, same ownership
 * boundary Organisation/Site/RateCardLineage already use), each paired
 * with its Assignments resolved down to a plain descriptive placement
 * label ("Example Logistics — Depot A/Norwood"), never exposing Engagement/
 * Assignment/Placement as UI terminology.
 */
async function loadEmploymentData(workspaceId, driverPersonId, db) {
  const [allEngagements, organisations] = await Promise.all([
    listEngagementsForWorkspace(workspaceId, db),
    listOrganisationsForWorkspace(workspaceId, db),
  ]);
  const engagements = allEngagements.filter((e) => e.driverId === driverPersonId);
  const organisationById = new Map(organisations.map((o) => [o.id, o]));

  return Promise.all(
    engagements.map(async (engagement) => {
      const assignments = await db.assignments.query({ where: { engagementId: engagement.id } });
      const assignmentRows = await Promise.all(
        assignments.map(async (assignment) => {
          const placement = await db.placements.getById(assignment.placementId);
          const site = placement ? await db.sites.getById(placement.siteId) : null;
          return { assignment, placement, site };
        })
      );
      return { engagement, provider: organisationById.get(engagement.providerOrganisationId), assignmentRows };
    })
  );
}

/**
 * DE-2: read-only view of this driver's own DriverDocuments — resolved
 * by personId (see the DriverDocument typedef and
 * decision-2026-08-04-working-time-driver-document-expiry-architecture
 * in the Brain), NOT scoped to this workspace, since a driving licence
 * isn't owned by any one employer. Reachability here already implies
 * an active Membership for this driver in this workspace (you can only
 * navigate to DriverDrilldown from this workspace's own driver list),
 * so no separate Membership check is layered on here — same boundary
 * the Employment/shift sections above already rely on implicitly.
 */
async function loadDriverDocumentsData(driverPersonId, db) {
  return listDriverDocuments(driverPersonId, db, { activeOnly: true });
}

/**
 * CPC-2: read-only CPC training cycle status + session list, same
 * personId-scoped access rule as loadDriverDocumentsData above (see
 * decision-2026-08-04-working-time-cpc-training-architecture).
 */
async function loadCpcTrainingData(driverPersonId, db) {
  const [cycleStatus, records] = await Promise.all([
    resolveCpcCycleStatusForDriver(driverPersonId, db),
    listCpcTrainingRecords(driverPersonId, db),
  ]);
  return { cycleStatus, records: [...records].sort((a, b) => b.date.localeCompare(a.date)) };
}

const CPC_STATUS_TO_CARD_STATUS = { ok: "ok", warning: "warning", problem: "problem", unknown_cycle: "warning" };

/**
 * Read-only company-side view of one driver's shifts. Queries the SAME
 * `shifts` collection as DriverApp — filtered by workspaceId (company
 * ownership) AND driverId (this specific driver) — and reuses
 * ShiftHistoryList, the same rendering code DriverApp's history tab uses.
 * This is the concrete proof of properties #6/#7: identical rows, no
 * duplicate, two different queries over one collection.
 */
export default function DriverDrilldown({ workspaceId, driverPerson, driverProfile, db, onBack }) {
  const { t, i18n } = useTranslation(["company", "common", "compliance", "placements", "driverDocument", "cpcTraining"]);
  const [employmentRefreshTick, setEmploymentRefreshTick] = useState(0);
  const [endEmploymentError, setEndEmploymentError] = useState({});

  const { data, loading } = useAsyncData(
    () => loadDriverDrilldownData(workspaceId, driverPerson.id, db),
    [workspaceId, driverPerson.id, db]
  );
  const items = data?.items ?? [];
  const compliance = data?.compliance ?? { alerts: [] };

  const { data: employmentRows } = useAsyncData(
    () => loadEmploymentData(workspaceId, driverPerson.id, db),
    [workspaceId, driverPerson.id, db, employmentRefreshTick]
  );

  const { data: driverDocuments } = useAsyncData(
    () => loadDriverDocumentsData(driverPerson.id, db),
    [driverPerson.id, db]
  );
  const { data: cpcTrainingData } = useAsyncData(
    () => loadCpcTrainingData(driverPerson.id, db),
    [driverPerson.id, db]
  );
  const cpcCycleStatus = cpcTrainingData?.cycleStatus ?? { hoursCompleted: 0, hoursRequired: 35, status: "unknown_cycle", cycleEndDate: null };
  const cpcRecords = cpcTrainingData?.records ?? [];
  const today = new Date();

  async function handleEndEmployment(engagementId) {
    setEndEmploymentError((prev) => ({ ...prev, [engagementId]: "" }));
    try {
      await endEngagement(engagementId, new Date().toISOString().slice(0, 10), db);
      setEmploymentRefreshTick((t2) => t2 + 1);
    } catch (e) {
      setEndEmploymentError((prev) => ({ ...prev, [engagementId]: e.message }));
    }
  }

  const totalHours = items.reduce((s, x) => s + x.breakdown.totalPaidHours, 0);
  const totalGross = items.reduce((s, x) => s + x.breakdown.totalGross, 0);

  if (loading && !data) {
    return (
      <div className="shell-content" style={{ padding: 16, color: "#8B909A", fontFamily: "'Barlow', sans-serif" }}>
        {t("common:loading")}
      </div>
    );
  }

  return (
    <div style={{ color: "#EDEEF0", fontFamily: "'Barlow', sans-serif" }}>
      <PageHeader
        leading={
          <button onClick={onBack} style={navBtnStyle} aria-label={t("common:backToDrivers")}>
            <ChevronLeft size={18} />
          </button>
        }
        title={resolvePersonDisplayName(driverPerson)}
        subtitle={t("company:drilldown.readonlyNote")}
      />
      <div className="shell-content" style={{ padding: 16 }}>
      <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
        {t("company:drivers.personSection")}
      </div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: driverPerson.email ? 6 : 0 }}>
          <span style={{ color: "#8B909A" }}>{t("company:drivers.name")}</span>
          <span>{resolvePersonDisplayName(driverPerson)}</span>
        </div>
        {driverPerson.email && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "#8B909A" }}>{t("company:drivers.email")}</span>
            <span>{driverPerson.email}</span>
          </div>
        )}
      </Card>

      <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
        {t("company:drivers.driverProfileSection")}
      </div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
          <span style={{ color: "#8B909A" }}>{t("company:drivers.status")}</span>
          <StatusBadge active={!driverProfile?.archivedAt} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span style={{ color: "#8B909A" }}>{t("company:drivers.referenceNumber")}</span>
          <span>{driverProfile?.referenceNumber || "—"}</span>
        </div>
      </Card>

      <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
        {t("company:employment.title")}
      </div>
      {(!employmentRows || employmentRows.length === 0) && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ color: "#8B909A", fontSize: 13 }}>{t("company:employment.empty")}</div>
        </Card>
      )}
      {(employmentRows ?? []).map(({ engagement, provider, assignmentRows }) => (
        <Card key={engagement.id} style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15 }}>{provider?.tradingName ?? "—"}</div>
              <div style={{ fontSize: 12, color: "#8B909A", marginTop: 2 }}>
                {t(`placements:relationshipTypes.${engagement.relationshipType}`, engagement.relationshipType)}
                {" · "}
                {engagement.status === "ended"
                  ? t("company:employment.ended", { date: engagement.endDate })
                  : t("company:employment.since", { date: engagement.startDate })}
              </div>
            </div>
            {engagement.status === "active" && (
              <button onClick={() => handleEndEmployment(engagement.id)} style={{ ...secondaryBtnStyle, padding: "6px 10px", fontSize: 12 }}>
                {t("company:employment.endAction")}
              </button>
            )}
          </div>
          {endEmploymentError[engagement.id] && (
            <div style={{ color: "#FF5A5F", fontSize: 12, marginTop: 8 }}>{endEmploymentError[engagement.id]}</div>
          )}

          <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 12, marginBottom: 6 }}>
            {t("company:employment.placementsLabel")}
          </div>
          {assignmentRows.length === 0 ? (
            <div style={{ color: "#8B909A", fontSize: 12 }}>{t("company:employment.noPlacements")}</div>
          ) : (
            assignmentRows.map(({ assignment, site }) => (
              <div key={assignment.id} style={{ fontSize: 13, marginBottom: 4 }}>
                {provider?.tradingName ?? "—"} — {site?.name ?? "—"}
                <span style={{ color: "#8B909A", fontSize: 12 }}>
                  {" · "}
                  {assignment.endDate ? `${assignment.startDate} – ${assignment.endDate}` : t("company:employment.since", { date: assignment.startDate })}
                </span>
              </div>
            ))
          )}
        </Card>
      ))}

      <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
        {t("company:documents.title")}
      </div>
      {(!driverDocuments || driverDocuments.length === 0) ? (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ color: "#8B909A", fontSize: 13 }}>{t("company:documents.empty")}</div>
        </Card>
      ) : (
        <>
          {driverDocuments.map((document) => {
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
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
          <div style={{ fontSize: 11, color: "#8B909A", marginTop: -4, marginBottom: 16 }}>{t("company:documents.readonlyNote")}</div>
        </>
      )}

      <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
        {t("cpcTraining:title")}
      </div>
      <div style={{ marginBottom: 10 }}>
        <ComplianceStatusCard
          categoryLabel={t("cpcTraining:cycleCard.title")}
          remainingLabel={
            cpcCycleStatus.status === "unknown_cycle"
              ? t("cpcTraining:cycleCard.unknownCycle")
              : t("cpcTraining:cycleCard.progress", {
                  completed: cpcCycleStatus.hoursCompleted,
                  required: cpcCycleStatus.hoursRequired,
                  date: cpcCycleStatus.cycleEndDate,
                })
          }
          statusLabel={t(`cpcTraining:status.${cpcCycleStatus.status}`)}
          status={CPC_STATUS_TO_CARD_STATUS[cpcCycleStatus.status]}
        />
      </div>
      {cpcRecords.length === 0 ? (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ color: "#8B909A", fontSize: 13 }}>{t("cpcTraining:empty")}</div>
        </Card>
      ) : (
        <>
          {cpcRecords.map((record) => (
            <Card key={record.id} style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14 }}>
                {t("cpcTraining:sessionSummary", { date: record.date, hours: record.hours })}
              </div>
              {record.provider && <div style={{ fontSize: 12, color: "#8B909A", marginTop: 2 }}>{record.provider}</div>}
            </Card>
          ))}
          <div style={{ fontSize: 11, color: "#8B909A", marginTop: -4, marginBottom: 16 }}>{t("company:cpcTraining.readonlyNote")}</div>
        </>
      )}

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
          <span style={{ color: "#8B909A" }}>{t("company:drilldown.allHours")}</span>
          <span>{hrs(totalHours)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span style={{ color: "#8B909A" }}>{t("company:drilldown.gross")}</span>
          <span>{money(totalGross, i18n.language)}</span>
        </div>
      </Card>

      {compliance.alerts.length > 0 && (
        <Card style={{ borderColor: "#FF5A5F", background: "#2A1518", marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "#8B909A", marginBottom: 8 }}>{t("company:drilldown.compliance")}</div>
          {compliance.alerts.map((a, i) => (
            <div key={i} style={{ color: "#FF9498", fontSize: 13, marginBottom: 4 }}>
              {t(`compliance:alerts.${a.code}`, a.params)}
            </div>
          ))}
        </Card>
      )}

      <ShiftHistoryList items={items} readOnly emptyLabel={t("company:drilldown.empty")} />
      </div>
    </div>
  );
}
