import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Clock3,
  Banknote,
  AlertTriangle,
  Plus,
  ClipboardCheck,
  History as HistoryIcon,
  ChevronLeft,
  ChevronRight,
  Gauge as GaugeIcon,
  CheckCircle2,
  X,
} from "lucide-react";
import { computeShiftBreakdown } from "../../services/payEngine.js";
import { computeCompliance, rollingDrivingSum } from "../../services/complianceEngine.js";
import { buildRateCardResolver } from "../../services/rateCardService.js";
import { resolveComplianceProfileForDriver } from "../../services/complianceProfileService.js";
import { resolveActiveAssignmentsForDriver } from "../../services/assignmentService.js";
import { getDriver, recordLastUsedAssignment } from "../../services/driverService.js";
import { createShift, deleteShift, listShiftsForDriver, updateShift } from "../../services/shiftService.js";
import { buildLoadsResolver, listLoadsForShift } from "../../services/loadService.js";
import { listDriverDocuments } from "../../services/driverDocumentService.js";
import { resolveDriverDocumentSummary } from "../../services/documentExpiryEngine.js";
import { resolveCpcCycleStatusForDriver } from "../../services/cpcTrainingService.js";
import { resolveDriverReminders } from "../../services/reminderEngine.js";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import {
  fmtRange,
  getWeekStart,
  hmToHours,
  hoursToHM,
  hrs,
  money,
  parseDateTime,
  toKey,
} from "../../services/shiftMath.js";
import { BarRow, Card, ComplianceStatusCard, EmptyState, Field, KpiCard, ReminderBanner, ShiftHistoryList, TabBtn } from "../shared/atoms.jsx";
import { ExportImportBar } from "../shared/ExportImportBar.jsx";
import { inputStyle, navBtnStyle, primaryBtnStyle, secondaryBtnStyle } from "../shared/styles.js";
import PageHeader from "../shell/PageHeader.jsx";
import LoadItemsField from "./LoadItemsField.jsx";
import { newId } from "../../domain/ids.js";

// Presentational-only severity bucketing over the compliance engine's
// existing used/max numbers and alert codes — this does NOT add or
// change any regulatory threshold, it just decides which of three UI
// colours a category card shows. If any hard alert in the category
// fired, or the budget is exhausted, it's "problem"; one remaining is
// "warning"; otherwise "ok".
const CATEGORY_ALERT_CODES = {
  longShift: ["longShiftOverThreshold", "longShiftBudgetExceeded", "dailyDutyAbsoluteMaxExceeded"],
  extendedDriving: ["extendedDrivingBudgetExceeded", "drivingHardLimitExceeded"],
  reducedRest: ["reducedRestBudgetExceeded", "restBelowMinimum"],
};

function complianceStatus(remaining, categoryCodes, alerts) {
  if (alerts.some((a) => categoryCodes.includes(a.code))) return "problem";
  if (remaining <= 0) return "problem";
  if (remaining === 1) return "warning";
  return "ok";
}

// Fallback shape while the real ComplianceProfile is still loading —
// zeroed rules so the useMemo chain below (which reads .rules.x
// unconditionally, same as before this screen's data load became
// async) never throws on the first render of a mount/refresh.
const EMPTY_COMPLIANCE_RULES = {
  reducedRestMaxPerCycle: 0,
  minRestHardHours: 0,
  reducedRestUpperHours: 0,
  cycleResetGapHours: 0,
  absoluteMaxDailyHours: 0,
  longShiftThresholdHours: 0,
  longShiftMaxPerCycle: 0,
  drivingHardLimitHours: 0,
  extendedDrivingThresholdHours: 0,
  extendedDrivingMaxPerWeek: 0,
};
const EMPTY_COMPLIANCE_PROFILE = { rules: EMPTY_COMPLIANCE_RULES };

/**
 * The screen's single root data-fetch — persistence access (async) is
 * kept here, at the boundary; everything downstream (the useMemo chain
 * below) renders synchronously over the already-loaded result. Resolves
 * active assignments (site/rateCard/organisation attached, so "no
 * forced company-management screens" for a solo driver: 0 active
 * assignments -> shifts log unpriced against the personal workspace;
 * exactly 1 -> used silently; >1 -> one extra picker field) alongside
 * the driver's shifts, compliance profile, and a synchronous rate-card
 * resolver pre-built for exactly those shifts. Also resolves the
 * driver's OWN (home-workspace) DriverProfile, purely to read
 * `lastUsedAssignmentId` for the Add Shift picker's default — see
 * `recordLastUsedAssignment`.
 */
async function loadDriverAppData(personId, homeWorkspaceId, db) {
  const [shifts, complianceProfile, activeAssignments, driver, driverDocuments, cpcCycleStatus] = await Promise.all([
    listShiftsForDriver(personId, db),
    resolveComplianceProfileForDriver(personId, db),
    resolveActiveAssignmentsForDriver(personId, db),
    homeWorkspaceId ? getDriver(homeWorkspaceId, personId, db) : null,
    listDriverDocuments(personId, db, { activeOnly: true }),
    resolveCpcCycleStatusForDriver(personId, db),
  ]);
  const resolveRateCard = await buildRateCardResolver(shifts, db);
  const resolveLoads = await buildLoadsResolver(shifts, db);
  return {
    shifts,
    complianceProfile,
    activeAssignments,
    driverProfile: driver?.driverProfile ?? null,
    driverDocuments,
    cpcCycleStatus,
    resolveRateCard,
    resolveLoads,
  };
}

// Maps documentExpiryEngine's ok/expiring_soon/expired/unknown onto the
// existing ok/warning/problem colour idiom ComplianceStatusCard already
// uses — 'unknown' (no expiry date entered yet) is treated as a
// "warning" nudge to go set one, not a hard "problem".
const DOCUMENT_STATUS_TO_CARD_STATUS = { ok: "ok", expiring_soon: "warning", expired: "problem", unknown: "warning" };

// Same mapping cpcTraining's own status idiom uses in CpcTrainingApp.jsx.
const CPC_STATUS_TO_CARD_STATUS = { ok: "ok", warning: "warning", problem: "problem", unknown_cycle: "warning" };

export default function DriverApp({ personId, homeWorkspaceId, db, tab, onTabChange }) {
  const { t, i18n } = useTranslation(["driver", "common", "compliance", "pay", "driverDocument", "cpcTraining", "reminders"]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [editingId, setEditingId] = useState(null);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  // Single root data-fetch for this screen — persistence access is
  // async here, at the boundary; every useMemo below (sortedShifts,
  // weekBreakdowns, compliance, KPI totals, nextStart, ...) is
  // unchanged pure computation over the already-loaded result.
  const { data, loading: dataLoading, error: dataError } = useAsyncData(
    () => loadDriverAppData(personId, homeWorkspaceId, db),
    [personId, homeWorkspaceId, db, refreshTick]
  );
  const activeAssignments = data?.activeAssignments ?? [];
  const primaryAssignment = activeAssignments[0] ?? null;
  const preferredAssignmentId = data?.driverProfile?.preferredAssignmentId ?? null;
  const lastUsedAssignmentId = data?.driverProfile?.lastUsedAssignmentId ?? null;
  // Default the picker to the driver's own EXPLICIT choice (Workplaces
  // screen) first, then what they used last, then just the first active
  // one — each only if that Assignment is still active, so an ended one
  // falls back down the chain rather than pinning a dead choice.
  const defaultAssignment =
    activeAssignments.find((a) => a.assignment.id === preferredAssignmentId) ??
    activeAssignments.find((a) => a.assignment.id === lastUsedAssignmentId) ??
    primaryAssignment;
  const shifts = data?.shifts ?? [];
  const complianceProfile = data?.complianceProfile ?? EMPTY_COMPLIANCE_PROFILE;
  const resolveRateCard = data?.resolveRateCard ?? (() => null);
  const resolveLoads = data?.resolveLoads ?? (() => []);
  const driverDocuments = data?.driverDocuments ?? [];
  const documentStatus = useMemo(() => resolveDriverDocumentSummary(driverDocuments, new Date()), [driverDocuments]);
  const cpcCycleStatus = data?.cpcCycleStatus ?? { hoursCompleted: 0, hoursRequired: 35, status: "unknown_cycle", cycleEndDate: null };
  const reminderItems = useMemo(() => {
    const reminders = resolveDriverReminders(driverDocuments, cpcCycleStatus, new Date());
    return reminders.map((reminder) => {
      if (reminder.kind === "document") {
        const label =
          reminder.document.documentType === "other"
            ? reminder.document.label
            : t(`driverDocument:types.${reminder.document.documentType}`);
        const key = reminder.severity === "problem" ? "reminders:driver.documentExpired" : "reminders:driver.documentExpiring";
        return { severity: reminder.severity, message: t(key, { label, date: reminder.document.expiryDate }) };
      }
      const key = reminder.severity === "problem" ? "reminders:driver.cpcProblem" : "reminders:driver.cpcWarning";
      return { severity: reminder.severity, message: t(key) };
    });
  }, [driverDocuments, cpcCycleStatus, t]);

  const emptyForm = {
    date: toKey(new Date()),
    start: "08:00",
    end: "16:00",
    drivingHM: "08:00",
    breakMinutes: 45,
    assignmentId: defaultAssignment ? defaultAssignment.assignment.id : "",
    loads: [],
  };
  const [form, setForm] = useState(emptyForm);
  // Which RateCard the Add Shift form is currently pricing against —
  // needed to decide whether to render the hourly preview or the
  // per-load Loads editor. `chosenAssignment.rateCard.payType` is
  // only present because resolveEffectiveRateCard/buildRateCardResolver
  // denormalize it from the RateCardLineage (see rateCardService.js).
  const formChosenAssignment = activeAssignments.find((a) => a.assignment.id === form.assignmentId) ?? primaryAssignment;
  const isPerLoad = formChosenAssignment?.rateCard?.payType === "per_load";

  const sortedShifts = useMemo(
    () => [...shifts].sort((a, b) => parseDateTime(a.date, a.start) - parseDateTime(b.date, b.start)),
    [shifts]
  );

  const breakdownFor = useCallback(
    (shift) => computeShiftBreakdown(shift, resolveRateCard(shift), resolveLoads(shift)),
    [resolveRateCard, resolveLoads]
  );

  const compliance = useMemo(
    () => computeCompliance(sortedShifts, complianceProfile),
    [sortedShifts, complianceProfile]
  );

  const weekShifts = useMemo(() => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 7);
    return sortedShifts.filter((s) => {
      const d = parseDateTime(s.date, "00:00");
      return d >= weekStart && d < end;
    });
  }, [sortedShifts, weekStart]);

  const weekBreakdowns = useMemo(
    () => weekShifts.map((s) => ({ shift: s, breakdown: breakdownFor(s) })),
    [weekShifts, breakdownFor]
  );
  const weekTotalHours = weekBreakdowns.reduce((s, x) => s + x.breakdown.totalPaidHours, 0);
  // Summed directly from totalGross (not totalBasePay + totalHolidayDiff)
  // so per-load shifts — which carry their pay only in totalGross, with
  // totalBasePay/totalHolidayDiff at 0 — are still counted.
  const weekTotalGross = weekBreakdowns.reduce((s, x) => s + x.breakdown.totalGross, 0);
  const weekLongShiftCount = weekBreakdowns.filter((x) => x.breakdown.dutyMinutes / 60 > complianceProfile.rules.longShiftThresholdHours).length;

  const refDate = sortedShifts.length
    ? parseDateTime(sortedShifts[sortedShifts.length - 1].date, "23:59")
    : new Date();
  const drivingThisWeek = weekShifts.reduce((s, x) => s + (Number(x.drivingHours) || 0), 0);
  const drivingFortnight = rollingDrivingSum(sortedShifts, 14, refDate);
  const lastShiftEnd = useMemo(() => {
    if (sortedShifts.length === 0) return null;
    return sortedShifts.reduce((latest, s) => {
      const end = breakdownFor(s).end;
      return !latest || end > latest ? end : latest;
    }, null);
  }, [sortedShifts, breakdownFor]);

  const fmtDateTime = (d) =>
    d.toLocaleString(i18n.language, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

  const nextStart = useMemo(() => {
    if (!lastShiftEnd) return null;
    const normal = new Date(lastShiftEnd.getTime() + complianceProfile.rules.reducedRestUpperHours * 3600 * 1000);
    const reduced = new Date(lastShiftEnd.getTime() + complianceProfile.rules.minRestHardHours * 3600 * 1000);
    const reducedLeft = complianceProfile.rules.reducedRestMaxPerCycle - compliance.reducedRestUsed;
    return { normal, reduced, reducedLeft };
  }, [lastShiftEnd, compliance.reducedRestUsed, complianceProfile]);

  const todayKey = toKey(new Date());
  const todayShiftRecord = sortedShifts.find((s) => s.date === todayKey) ?? null;
  const todayShiftBreakdown = todayShiftRecord ? breakdownFor(todayShiftRecord) : null;
  const todayDriving = todayShiftRecord ? Number(todayShiftRecord.drivingHours) || 0 : 0;

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  // Some "Add Shift" entry points (the sidebar nav item) only flip `tab`
  // without calling resetForm() first — without this, a fresh add right
  // after a save would keep showing the assignment snapshotted into
  // `form` at save time, from BEFORE the post-save refetch picked up the
  // just-recorded lastUsedAssignmentId. Only resets on an actual arrival
  // at "add" while not mid-edit (editingId is already set by editShift()
  // before it flips the tab, so this never clobbers an in-progress edit).
  //
  // Depends on `data` as well as `tab`, not just `tab` — a save flips
  // `tab` to "week" and bumps refreshTick in the same instant, so the
  // refetch it triggers is still in flight; if the user (or a test)
  // flips straight back to "add" before that refetch resolves, this
  // effect fires once with the STILL-STALE `data` (harmless, transient),
  // then fires AGAIN the moment the refetch resolves and `data` changes
  // — since `tab` is still "add" at that point, it self-corrects to the
  // fresh default rather than getting stuck on the stale one.
  useEffect(() => {
    if (tab === "add" && !editingId) {
      setForm(emptyForm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, data]);

  async function saveShift() {
    if (!form.date || !form.start || !form.end) return;
    const chosenAssignment = activeAssignments.find((a) => a.assignment.id === form.assignmentId) ?? primaryAssignment;
    const shiftWorkspaceId = chosenAssignment ? chosenAssignment.assignment.workspaceId ?? chosenAssignment.engagement.workspaceId : homeWorkspaceId;
    const input = {
      workspaceId: shiftWorkspaceId,
      driverId: personId,
      assignmentId: chosenAssignment ? chosenAssignment.assignment.id : null,
      date: form.date,
      start: form.start,
      end: form.end,
      drivingHours: hmToHours(form.drivingHM),
      breakMinutes: Number(form.breakMinutes),
      // Always sent (even []) so switching a shift away from a
      // per-load assignment on edit correctly clears any Loads it
      // previously owned — see shiftService.createShift/updateShift.
      loads: isPerLoad
        ? form.loads
            .filter((l) => l.amount !== "" && !Number.isNaN(Number(l.amount)))
            .map((l) => ({
              reference: l.reference || null,
              description: l.description || null,
              amount: Number(l.amount),
              distanceMiles: l.distanceMiles === "" ? null : Number(l.distanceMiles),
            }))
        : [],
    };
    setSaving(true);
    try {
      if (editingId) {
        await updateShift(editingId, input, db);
      } else {
        await createShift(input, db);
      }
      if (homeWorkspaceId) {
        await recordLastUsedAssignment(homeWorkspaceId, personId, input.assignmentId, db);
      }
      setSaveError("");
      setRefreshTick((t2) => t2 + 1);
      resetForm();
      onTabChange("week");
    } catch (e) {
      setSaveError(t("driver:addShift.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function editShift(s) {
    const existingLoads = await listLoadsForShift(s.id, db);
    setForm({
      date: s.date,
      start: s.start,
      end: s.end,
      drivingHM: hoursToHM(s.drivingHours),
      breakMinutes: s.breakMinutes,
      assignmentId: s.assignmentId ?? "",
      loads: existingLoads.map((l) => ({
        id: newId("load"),
        reference: l.reference ?? "",
        description: l.description ?? "",
        amount: String(l.amount),
        distanceMiles: l.distanceMiles === null || l.distanceMiles === undefined ? "" : String(l.distanceMiles),
      })),
    });
    setEditingId(s.id);
    onTabChange("add");
  }

  async function handleDeleteShift(id) {
    await deleteShift(id, db);
    setRefreshTick((t2) => t2 + 1);
  }

  const previewBreakdown = useMemo(() => {
    if (!form.date || !form.start || !form.end) return null;
    const chosenAssignment = activeAssignments.find((a) => a.assignment.id === form.assignmentId) ?? primaryAssignment;
    try {
      return computeShiftBreakdown(
        { ...form, breakMinutes: Number(form.breakMinutes) },
        chosenAssignment ? chosenAssignment.rateCard : null,
        form.loads.map((l) => ({ amount: l.amount }))
      );
    } catch (e) {
      return null;
    }
  }, [form, activeAssignments, primaryAssignment]);

  const [payslipWeekKey, setPayslipWeekKey] = useState(() => toKey(getWeekStart(new Date())));
  const [payslipValue, setPayslipValue] = useState("");
  const payslipWeekStart = useMemo(() => new Date(payslipWeekKey), [payslipWeekKey]);
  const payslipShifts = useMemo(() => {
    const end = new Date(payslipWeekStart);
    end.setDate(end.getDate() + 7);
    return sortedShifts.filter((s) => {
      const d = parseDateTime(s.date, "00:00");
      return d >= payslipWeekStart && d < end;
    });
  }, [sortedShifts, payslipWeekStart]);
  const payslipBreakdowns = payslipShifts.map((s) => ({ shift: s, breakdown: breakdownFor(s) }));
  const payslipCalcGross = payslipBreakdowns.reduce((s, x) => s + x.breakdown.totalGross, 0);
  // Broken out separately (rather than folded into basePay) so Base +
  // Holiday + Load pay visibly reconciles to My total even in a week
  // that mixes hourly and per-load shifts.
  const payslipLoadPay = payslipBreakdowns.filter((x) => x.breakdown.perLoad).reduce((s, x) => s + x.breakdown.totalGross, 0);
  const payslipDiff = payslipValue === "" ? null : Number(payslipValue) - payslipCalcGross;

  const weekOptions = useMemo(() => {
    const keys = new Set(sortedShifts.map((s) => toKey(getWeekStart(parseDateTime(s.date, "00:00")))));
    keys.add(toKey(getWeekStart(new Date())));
    return Array.from(keys).sort().reverse();
  }, [sortedShifts]);

  const headerSubtitle = primaryAssignment
    ? [primaryAssignment.employerOrganisation?.tradingName, primaryAssignment.site?.name].filter(Boolean).join(" · ")
    : t("common:independentDriver");

  const longShiftRemaining = complianceProfile.rules.longShiftMaxPerCycle - compliance.longShiftUsed;
  const extendedDrivingRemaining = complianceProfile.rules.extendedDrivingMaxPerWeek - compliance.extendedDrivingUsed;
  const reducedRestRemaining = complianceProfile.rules.reducedRestMaxPerCycle - compliance.reducedRestUsed;
  const longShiftStatus = complianceStatus(longShiftRemaining, CATEGORY_ALERT_CODES.longShift, compliance.alerts);
  const extendedDrivingStatus = complianceStatus(extendedDrivingRemaining, CATEGORY_ALERT_CODES.extendedDriving, compliance.alerts);
  const reducedRestStatus = complianceStatus(reducedRestRemaining, CATEGORY_ALERT_CODES.reducedRest, compliance.alerts);

  // Loading/error gate for the initial fetch — placed after every hook
  // above (rules-of-hooks: hook count/order must never depend on this),
  // and skipped on refetches once data has already loaded once, so
  // saving/deleting a shift doesn't flash the whole screen back to a
  // loading state.
  if (dataLoading && !data) {
    return (
      <div className="shell-content" style={{ padding: 16, color: "#8B909A", fontFamily: "'Barlow', sans-serif" }}>
        {t("common:loading")}
      </div>
    );
  }
  if (dataError) {
    return (
      <div className="shell-content" style={{ padding: 16, color: "#FF9498", fontFamily: "'Barlow', sans-serif" }}>
        {t("common:loadError")}
      </div>
    );
  }

  return (
    <div style={{ color: "#EDEEF0", fontFamily: "'Barlow', sans-serif" }}>
      {tab === "week" && (
        <div>
          <PageHeader
            title={t("driver:dashboard.title")}
            subtitle={headerSubtitle}
            action={
              <button onClick={() => { resetForm(); onTabChange("add"); }} style={{ ...primaryBtnStyle, display: "flex", alignItems: "center", gap: 6, padding: "10px 16px" }}>
                <Plus size={16} /> {t("driver:dashboard.addShift")}
              </button>
            }
          />
          <div className="shell-content" style={{ padding: 16 }}>

            <ReminderBanner items={reminderItems} />

            {/* 1. What am I doing today? */}
            <Card style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                {t("driver:dashboard.todayShift.title")}
              </div>
              {todayShiftRecord ? (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16 }}>
                    {t("driver:dashboard.todayShift.summary", {
                      start: todayShiftRecord.start,
                      end: todayShiftRecord.end,
                      driving: hoursToHM(todayShiftRecord.drivingHours),
                    })}
                  </span>
                  {todayShiftBreakdown?.priced && (
                    <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, color: "#4DD9E8" }}>
                      {money(todayShiftBreakdown.totalGross, i18n.language)}
                    </span>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <span style={{ color: "#B8BCC4", fontSize: 13.5 }}>{t("driver:dashboard.todayShift.none")}</span>
                  <button onClick={() => { resetForm(); onTabChange("add"); }} style={secondaryBtnStyle}>
                    {t("driver:dashboard.todayShift.cta")}
                  </button>
                </div>
              )}
            </Card>

            {/* 2 & 3. Hours / driving / expected gross at a glance */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 16 }}>
              <KpiCard icon={<Clock3 size={12} />} label={t("driver:dashboard.kpi.hours")} value={hrs(weekTotalHours)} />
              <KpiCard icon={<GaugeIcon size={12} />} label={t("driver:dashboard.kpi.driving")} value={hrs(drivingThisWeek)} />
              <KpiCard
                icon={<Banknote size={12} />}
                label={t("driver:dashboard.kpi.expectedGross")}
                value={money(weekTotalGross, i18n.language)}
                valueColor="#4DD9E8"
              />
            </div>

            {/* Driving today — compact bar instead of the old large gauge */}
            <Card style={{ marginBottom: 16 }}>
              <BarRow label={t("driver:dashboard.todayDriving")} value={todayDriving} max={complianceProfile.rules.drivingHardLimitHours} />
            </Card>

            {/* 4. Compliance — quick glance, then optional detail */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 12 }}>
              <ComplianceStatusCard
                categoryLabel={t("compliance:categories.longShift")}
                remainingLabel={t("compliance:remaining", { count: Math.max(longShiftRemaining, 0) })}
                statusLabel={t(`compliance:status.${longShiftStatus}`)}
                status={longShiftStatus}
              />
              <ComplianceStatusCard
                categoryLabel={t("compliance:categories.extendedDriving")}
                remainingLabel={t("compliance:remaining", { count: Math.max(extendedDrivingRemaining, 0) })}
                statusLabel={t(`compliance:status.${extendedDrivingStatus}`)}
                status={extendedDrivingStatus}
              />
              <ComplianceStatusCard
                categoryLabel={t("compliance:categories.reducedRest")}
                remainingLabel={t("compliance:remaining", { count: Math.max(reducedRestRemaining, 0) })}
                statusLabel={t(`compliance:status.${reducedRestStatus}`)}
                status={reducedRestStatus}
              />
            </div>

            {/* Document expiry and CPC training — separate domains from tachograph compliance above, not folded into that grid so all three concerns stay visually distinct */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginBottom: 16 }}>
              <ComplianceStatusCard
                categoryLabel={t("driverDocument:dashboardTile.title")}
                remainingLabel={t(`driverDocument:dashboardTile.${documentStatus}`)}
                statusLabel={t(`driverDocument:status.${documentStatus}`)}
                status={DOCUMENT_STATUS_TO_CARD_STATUS[documentStatus]}
              />
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

            {compliance.alerts.length > 0 && (
              <Card style={{ borderColor: "#FF5A5F", background: "#2A1518", marginBottom: 16 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <AlertTriangle size={16} color="#FF5A5F" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                    {compliance.alerts.map((a, i) => (
                      <div key={i} style={{ color: "#FF9498", marginBottom: 4 }}>
                        {t(`compliance:alerts.${a.code}`, a.params)}
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            )}

            {nextStart && (
              <Card style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
                  {t("driver:dashboard.nextStart.title")}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 12.5, color: "#B8BCC4" }}>
                      {t("driver:dashboard.nextStart.normal", { hours: complianceProfile.rules.reducedRestUpperHours })}
                    </div>
                    <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16 }}>{fmtDateTime(nextStart.normal)}</div>
                  </div>
                  <CheckCircle2 size={16} color="#3FBE63" />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", opacity: nextStart.reducedLeft > 0 ? 1 : 0.4 }}>
                  <div>
                    <div style={{ fontSize: 12.5, color: "#B8BCC4" }}>
                      {t("driver:dashboard.nextStart.reduced", {
                        hours: complianceProfile.rules.minRestHardHours,
                        remaining: Math.max(nextStart.reducedLeft, 0),
                        max: complianceProfile.rules.reducedRestMaxPerCycle,
                      })}
                    </div>
                    <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, color: "#FF8A00" }}>
                      {nextStart.reducedLeft > 0 ? fmtDateTime(nextStart.reduced) : t("driver:dashboard.nextStart.unavailable")}
                    </div>
                  </div>
                </div>
              </Card>
            )}

            <details style={{ marginBottom: 16 }}>
              <summary style={{ fontSize: 11, color: "#8B909A", cursor: "pointer" }}>
                {t("compliance:detailsToggle")}
              </summary>
              <div style={{ fontSize: 11, color: "#8B909A", marginTop: 8, lineHeight: 1.5 }}>
                {t("compliance:longShiftInfo", {
                  normalRestHours: complianceProfile.rules.reducedRestUpperHours,
                  thresholdHours: complianceProfile.rules.longShiftThresholdHours,
                  minRestHours: complianceProfile.rules.minRestHardHours,
                  maxPerCycle: complianceProfile.rules.longShiftMaxPerCycle,
                  absoluteMaxHours: complianceProfile.rules.absoluteMaxDailyHours,
                })}
              </div>
              <div style={{ fontSize: 11, color: "#8B909A", marginTop: 6 }}>
                {t("compliance:thisWeekInfo", { count: weekLongShiftCount, thresholdHours: complianceProfile.rules.longShiftThresholdHours })}
              </div>
            </details>

            {/* 5. What happened this week */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <button
                onClick={() => setWeekStart((w) => { const d = new Date(w); d.setDate(d.getDate() - 7); return d; })}
                style={navBtnStyle}
              >
                <ChevronLeft size={18} />
              </button>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15 }}>{fmtRange(weekStart, i18n.language)}</div>
              <button
                onClick={() => setWeekStart((w) => { const d = new Date(w); d.setDate(d.getDate() + 7); return d; })}
                style={navBtnStyle}
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <Card style={{ marginBottom: 16 }}>
              <BarRow label={t("driver:dashboard.weeklyDriving")} value={drivingThisWeek} max={56} />
              <div style={{ height: 12 }} />
              <BarRow label={t("driver:dashboard.fortnightDriving")} value={drivingFortnight} max={90} />
            </Card>

            {weekBreakdowns.length === 0 && (
              <EmptyState
                title={t("driver:dashboard.emptyWeek.title")}
                action={
                  <button onClick={() => { resetForm(); onTabChange("add"); }} style={{ ...primaryBtnStyle, display: "inline-flex", alignItems: "center", gap: 6, width: "auto", padding: "10px 20px" }}>
                    <Plus size={16} /> {t("driver:dashboard.emptyWeek.cta")}
                  </button>
                }
              />
            )}
          </div>
        </div>
      )}

      {tab === "add" && (
        <div>
          <PageHeader title={editingId ? t("driver:addShift.editTitle") : t("driver:addShift.title")} subtitle={headerSubtitle} />
          <div className="shell-content" style={{ padding: 16 }}>
          <Card>
            <Field label={t("driver:addShift.date")}>
              <input type="date" style={inputStyle} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label={t("driver:addShift.start")}>
                <input type="time" style={inputStyle} value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
              </Field>
              <Field label={t("driver:addShift.end")}>
                <input type="time" style={inputStyle} value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
              </Field>
            </div>
            <Field label={t("driver:addShift.totalDriving")}>
              <input
                type="time"
                style={inputStyle}
                value={form.drivingHM}
                onChange={(e) => setForm({ ...form, drivingHM: e.target.value })}
              />
            </Field>
            <Field label={t("driver:addShift.break")}>
              <input
                type="number"
                step="1"
                min="0"
                style={inputStyle}
                value={form.breakMinutes}
                onChange={(e) => setForm({ ...form, breakMinutes: e.target.value })}
              />
            </Field>
            {activeAssignments.length > 1 && (
              <Field label={t("driver:addShift.assignment")}>
                <select
                  style={inputStyle}
                  value={form.assignmentId}
                  onChange={(e) => setForm({ ...form, assignmentId: e.target.value })}
                >
                  {activeAssignments.map((a) => (
                    <option key={a.assignment.id} value={a.assignment.id}>
                      {[a.employerOrganisation?.tradingName, a.site?.name].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </Card>

          {isPerLoad && (
            <Card style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
                {t("driver:addShift.loads.title")}
              </div>
              <LoadItemsField loads={form.loads} onChange={(loads) => setForm({ ...form, loads })} />
            </Card>
          )}

          {previewBreakdown && previewBreakdown.perLoad && (
            <Card style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>{t("pay:preview.perLoadTitle")}</div>
              {previewBreakdown.priced ? (
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'Oswald', sans-serif", fontSize: 16 }}>
                  <span>{t("pay:preview.perLoadTotal")}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(previewBreakdown.totalGross, i18n.language)}</span>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "#B8BCC4" }}>{t("pay:preview.perLoadEmpty")}</div>
              )}
            </Card>
          )}

          {previewBreakdown && !previewBreakdown.perLoad && previewBreakdown.priced && previewBreakdown.segments.length > 0 && (
            <Card style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>{t("pay:preview.title")}</div>
              {previewBreakdown.segments.map((seg, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                  <span style={{ color: "#B8BCC4" }}>{t(`pay:dayCategory.${seg.cat}`)} · {t(`pay:window.${seg.win}`)} ({hrs(seg.hours)})</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(seg.basePay, i18n.language)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6, paddingTop: 6, borderTop: "1px dashed #2A2E35" }}>
                <span style={{ color: "#B8BCC4" }}>{t("pay:preview.base")}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(previewBreakdown.totalBasePay, i18n.language)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6, color: "#4DD9E8" }}>
                <span>{t("pay:preview.holiday")}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(previewBreakdown.totalHolidayDiff, i18n.language)}</span>
              </div>
              <div style={{ borderTop: "1px solid #2A2E35", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", fontFamily: "'Oswald', sans-serif", fontSize: 16 }}>
                <span>{t("pay:preview.totalWithHoliday")}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(previewBreakdown.totalGross, i18n.language)}</span>
              </div>
            </Card>
          )}

          {previewBreakdown && !previewBreakdown.perLoad && !previewBreakdown.priced && (
            <Card style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, color: "#B8BCC4" }}>
                {t("pay:preview.unpriced", { hours: hrs(previewBreakdown.totalPaidHours) })}
              </div>
            </Card>
          )}

          {saveError && <div style={{ color: "#FF5A5F", fontSize: 13, marginTop: 10 }}>{saveError}</div>}

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button onClick={saveShift} disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>
              {editingId ? t("driver:addShift.saveChanges") : t("driver:addShift.save")}
            </button>
            {editingId && (
              <button onClick={resetForm} style={secondaryBtnStyle}>
                {t("driver:addShift.cancel")}
              </button>
            )}
          </div>
          </div>
        </div>
      )}

      {tab === "payslip" && (
        <div>
          <PageHeader title={t("pay:payslip.title")} />
          <div className="shell-content" style={{ padding: 16 }}>
          <Card>
            <Field label={t("pay:payslip.weekLabel")}>
              <select
                style={inputStyle}
                value={payslipWeekKey}
                onChange={(e) => { setPayslipWeekKey(e.target.value); setPayslipValue(""); }}
              >
                {weekOptions.map((k) => (
                  <option key={k} value={k}>{fmtRange(new Date(k), i18n.language)}</option>
                ))}
              </select>
            </Field>
            <Field label={t("pay:payslip.grossFromPayslip")}>
              <input
                type="number"
                step="0.01"
                style={inputStyle}
                value={payslipValue}
                onChange={(e) => setPayslipValue(e.target.value)}
                placeholder={t("pay:payslip.placeholder")}
              />
            </Field>
          </Card>

          <Card style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
              {t("pay:payslip.calculatedTitle")}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
              <span style={{ color: "#B8BCC4" }}>{t("pay:payslip.hours")}</span>
              <span>{hrs(payslipBreakdowns.reduce((s, x) => s + x.breakdown.totalPaidHours, 0))}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
              <span style={{ color: "#B8BCC4" }}>{t("pay:payslip.basePay")}</span>
              <span>{money(payslipBreakdowns.reduce((s, x) => s + x.breakdown.totalBasePay, 0), i18n.language)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
              <span style={{ color: "#B8BCC4" }}>{t("pay:payslip.holidayPay")}</span>
              <span>{money(payslipBreakdowns.reduce((s, x) => s + x.breakdown.totalHolidayDiff, 0), i18n.language)}</span>
            </div>
            {payslipLoadPay !== 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
                <span style={{ color: "#B8BCC4" }}>{t("pay:payslip.loadPay")}</span>
                <span>{money(payslipLoadPay, i18n.language)}</span>
              </div>
            )}
            <div style={{ borderTop: "1px solid #2A2E35", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", fontFamily: "'Oswald', sans-serif", fontSize: 18 }}>
              <span>{t("pay:payslip.myTotal")}</span>
              <span>{money(payslipCalcGross, i18n.language)}</span>
            </div>
          </Card>

          {payslipDiff !== null && (
            <Card
              style={{
                marginTop: 12,
                borderColor: Math.abs(payslipDiff) < 0.05 ? "#3FBE63" : "#FF5A5F",
                background: Math.abs(payslipDiff) < 0.05 ? "#122019" : "#2A1518",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {Math.abs(payslipDiff) < 0.05 ? <CheckCircle2 size={20} color="#3FBE63" /> : <X size={20} color="#FF5A5F" />}
                <div>
                  <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16 }}>
                    {Math.abs(payslipDiff) < 0.05 ? t("pay:payslip.matches") : t("pay:payslip.difference", { amount: money(payslipDiff, i18n.language) })}
                  </div>
                  <div style={{ fontSize: 12, color: "#B8BCC4" }}>
                    {payslipDiff > 0 ? t("pay:payslip.higherThanCalc") : payslipDiff < 0 ? t("pay:payslip.lowerThanCalc") : t("pay:payslip.exactMatch")}
                  </div>
                </div>
              </div>
            </Card>
          )}

          <div style={{ fontSize: 11, color: "#8B909A", marginTop: 16, lineHeight: 1.6 }}>
            {t("pay:payslip.assumptions")}
          </div>
          </div>
        </div>
      )}

      {tab === "history" && (
        <div>
          <PageHeader
            title={t("driver:history.title")}
            subtitle={headerSubtitle}
            action={
              homeWorkspaceId ? (
                <ExportImportBar
                  workspaceId={homeWorkspaceId}
                  workspaceName="moje-dane"
                  db={db}
                  onImported={() => setRefreshTick((t2) => t2 + 1)}
                />
              ) : null
            }
          />
          <div className="shell-content" style={{ padding: 16 }}>
          <ShiftHistoryList
            items={sortedShifts.map((s) => ({ shift: s, breakdown: breakdownFor(s) }))}
            onEdit={editShift}
            onDelete={handleDeleteShift}
          />
          </div>
        </div>
      )}

      {/* Bottom tab bar — mobile only; desktop navigation lives in the sidebar */}
      <nav
        aria-label={t("driver:mobileNav.quickNav")}
        className="shell-mobile-bottom-nav"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "#1A1C21",
          borderTop: "1px solid #2A2E35",
          padding: "8px 4px",
          zIndex: 20,
        }}
      >
        <TabBtn active={tab === "week"} onClick={() => onTabChange("week")} icon={<GaugeIcon size={20} />} label={t("driver:mobileNav.week")} />
        <TabBtn active={tab === "add"} onClick={() => { resetForm(); onTabChange("add"); }} icon={<Plus size={20} />} label={t("driver:mobileNav.add")} />
        <TabBtn active={tab === "payslip"} onClick={() => onTabChange("payslip")} icon={<ClipboardCheck size={20} />} label={t("driver:mobileNav.payslip")} />
        <TabBtn active={tab === "history"} onClick={() => onTabChange("history")} icon={<HistoryIcon size={20} />} label={t("driver:mobileNav.history")} />
      </nav>
    </div>
  );
}
