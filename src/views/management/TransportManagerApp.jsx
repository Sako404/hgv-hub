import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { resolveTransportManagerDashboardData } from "../../services/transportManagerService.js";
import { resolveTransportManagerReminders } from "../../services/reminderEngine.js";
import { Card, EmptyState, DocumentStatusBadge, StatusPill, ReminderBanner } from "../shared/atoms.jsx";
import PageHeader from "../shell/PageHeader.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";

// kind -> reminders:transportManager.* i18n key, keyed by kind (+severity for the two kinds with a expiring/expired split).
function reminderMessageKey(reminder) {
  switch (reminder.kind) {
    case "externalLimit":
      return "reminders:transportManager.externalLimit";
    case "driverHours":
      return "reminders:transportManager.driverHours";
    case "driverDocument":
      return reminder.severity === "problem" ? "reminders:transportManager.driverDocumentExpired" : "reminders:transportManager.driverDocumentExpiring";
    case "driverCpc":
      return reminder.severity === "problem" ? "reminders:transportManager.driverCpcProblem" : "reminders:transportManager.driverCpcWarning";
    case "vehicleMot":
      return reminder.severity === "problem" ? "reminders:transportManager.vehicleMotExpired" : "reminders:transportManager.vehicleMotExpiring";
    case "vehicleInsurance":
      return reminder.severity === "problem" ? "reminders:transportManager.vehicleInsuranceExpired" : "reminders:transportManager.vehicleInsuranceExpiring";
    case "vehicleDefect":
      return "reminders:transportManager.vehicleDangerousDefect";
    default:
      return null;
  }
}

// Same ok/warning/problem/unknown_cycle -> ok/warning/problem mapping
// CpcTrainingApp.jsx and DriverApp.jsx's own dashboard tiles already use.
const CPC_STATUS_TO_PILL_STATUS = { ok: "ok", warning: "warning", problem: "problem", unknown_cycle: "warning" };
const HOURS_STATUS_TO_PILL_STATUS = { ok: "ok", problem: "problem" };

async function loadTransportManagerData(personId, workspaceId, db) {
  return resolveTransportManagerDashboardData(personId, workspaceId, db);
}

export default function TransportManagerApp({ personId, workspace, db }) {
  const { t } = useTranslation(["transportManager", "cpcTraining", "driverDocument", "reminders", "common"]);

  const { data, loading } = useAsyncData(
    () => loadTransportManagerData(personId, workspace.id, db),
    [personId, workspace.id, db]
  );
  const drivers = data?.drivers ?? [];
  const vehicles = data?.vehicles ?? [];
  const recommendedHours = data?.recommendedHours ?? { minHours: null, maxHours: null, fullTimeRequired: false, additionalAssistanceRecommended: false };
  const externalTmLimitStatus = data?.externalTmLimitStatus ?? { operatorCount: 0, totalVehicleCount: 0, operatorLimit: 4, vehicleLimit: 50, withinLimit: true };
  const reminderItems = useMemo(() => {
    const reminders = resolveTransportManagerReminders(drivers, vehicles, externalTmLimitStatus);
    return reminders.map((reminder) => ({
      severity: reminder.severity,
      message: t(reminderMessageKey(reminder), { name: reminder.displayName, registration: reminder.registration }),
    }));
  }, [drivers, vehicles, externalTmLimitStatus, t]);

  if (loading && !data) {
    return (
      <div className="shell-content" style={{ padding: 16, color: "#8B909A", fontFamily: "'Barlow', sans-serif" }}>
        {t("common:loading")}
      </div>
    );
  }

  const hoursLabel = recommendedHours.fullTimeRequired
    ? recommendedHours.additionalAssistanceRecommended
      ? t("transportManager:hours.fullTimePlusAssistance")
      : t("transportManager:hours.fullTime")
    : t("transportManager:hours.range", { min: recommendedHours.minHours, max: recommendedHours.maxHours });

  return (
    <div style={{ color: "#EDEEF0", fontFamily: "'Barlow', sans-serif" }}>
      <PageHeader title={t("transportManager:title")} subtitle={workspace.name} />
      <div className="shell-content" style={{ padding: 16 }}>
        <ReminderBanner items={reminderItems} />

        {!externalTmLimitStatus.withinLimit && (
          <Card style={{ borderColor: "#FF5A5F", background: "#2A1518", marginBottom: 16 }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "#FF9498" }}>
              {t("transportManager:externalLimitWarning", {
                operators: externalTmLimitStatus.operatorCount,
                operatorLimit: externalTmLimitStatus.operatorLimit,
                vehicles: externalTmLimitStatus.totalVehicleCount,
                vehicleLimit: externalTmLimitStatus.vehicleLimit,
              })}
            </div>
          </Card>
        )}

        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
            {t("transportManager:hours.title")}
          </div>
          <div style={{ fontSize: 15, fontFamily: "'Oswald', sans-serif" }}>
            {t("transportManager:hours.summary", { count: vehicles.length })} — {hoursLabel}
          </div>
          <div style={{ fontSize: 11, color: "#8B909A", marginTop: 6 }}>{t("transportManager:hours.caveat")}</div>
        </Card>

        <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
          {t("transportManager:driversSection.title")}
        </div>
        {drivers.length === 0 && <EmptyState title={t("transportManager:driversSection.empty")} />}
        {drivers.map((driver) => (
          <Card key={driver.personId} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15 }}>{driver.displayName}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <StatusPill status={HOURS_STATUS_TO_PILL_STATUS[driver.hoursStatus]} label={t("transportManager:driversSection.hoursLabel", { status: t(`transportManager:status.${driver.hoursStatus}`) })} />
                <StatusPill
                  status={CPC_STATUS_TO_PILL_STATUS[driver.cpcCycleStatus.status]}
                  label={t("transportManager:driversSection.cpcLabel", { status: t(`cpcTraining:status.${driver.cpcCycleStatus.status}`) })}
                />
                <DocumentStatusBadge status={driver.documentStatus} />
              </div>
            </div>
          </Card>
        ))}

        <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, marginTop: 16 }}>
          {t("transportManager:vehiclesSection.title")}
        </div>
        {vehicles.length === 0 && <EmptyState title={t("transportManager:vehiclesSection.empty")} />}
        {vehicles.map((vehicle) => (
          <Card key={vehicle.vehicleId} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15 }}>{vehicle.registration}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "#8B909A" }}>{t("transportManager:vehiclesSection.motLabel")}</span>
                <DocumentStatusBadge status={vehicle.motStatus} />
                <span style={{ fontSize: 11, color: "#8B909A" }}>{t("transportManager:vehiclesSection.insuranceLabel")}</span>
                <DocumentStatusBadge status={vehicle.insuranceStatus} />
                <StatusPill
                  status={vehicle.openDefectCount === 0 ? "ok" : vehicle.hasDangerousDefect ? "problem" : "warning"}
                  label={t("transportManager:vehiclesSection.defectCount", { count: vehicle.openDefectCount })}
                />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
