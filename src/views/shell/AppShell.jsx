import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Gauge as GaugeIcon, Plus, ClipboardCheck, History as HistoryIcon, Users, Building2, MapPin, Banknote, Briefcase, Truck, ListChecks, ClipboardList, Wrench, ShieldAlert, FileText, GraduationCap, ShieldCheck } from "lucide-react";
import { useSession } from "../../context/SessionContext.jsx";
import DriverApp from "../driver/DriverApp.jsx";
import VehicleCheckApp from "../driver/VehicleCheckApp.jsx";
import WorkplacesApp from "../driver/WorkplacesApp.jsx";
import DriverDocumentsApp from "../driver/DriverDocumentsApp.jsx";
import CpcTrainingApp from "../driver/CpcTrainingApp.jsx";
import CompanyApp from "../company/CompanyApp.jsx";
import OrganisationsApp from "../management/OrganisationsApp.jsx";
import SitesApp from "../management/SitesApp.jsx";
import RateCardsApp from "../management/RateCardsApp.jsx";
import PlacementsApp from "../management/PlacementsApp.jsx";
import VehiclesApp from "../management/VehiclesApp.jsx";
import ChecklistTemplatesApp from "../management/ChecklistTemplatesApp.jsx";
import DefectsApp from "../management/DefectsApp.jsx";
import TransportManagerApp from "../management/TransportManagerApp.jsx";
import Sidebar from "./Sidebar.jsx";
import MobileDrawer from "./MobileDrawer.jsx";
import { useSidebarCollapsed } from "./useSidebarCollapsed.js";

/**
 * Resolves the accessible "views" for the signed-in person, reusing
 * session.personalWorkspace / session.managerialMemberships as the
 * single source of truth (see services/workspaceService.js) — no
 * separate workspace state is created here. A "view" is either the
 * person's own Driver workspace (always present, exactly one) or one
 * managed Company workspace (zero or more).
 */
function useViews(session) {
  return useMemo(() => {
    const views = [];
    if (session.personalWorkspace) {
      views.push({ id: session.personalWorkspace.id, kind: "driver", label: session.personalWorkspace.name, workspace: session.personalWorkspace });
    }
    for (const m of session.managerialMemberships) {
      views.push({ id: m.workspace.id, kind: "company", label: m.workspace.name, workspace: m.workspace, roles: m.roles });
    }
    return views;
  }, [session]);
}

export default function AppShell() {
  const { t } = useTranslation("common");
  const { db, session, sessionLoading } = useSession();
  const { collapsed, toggle: toggleCollapsed } = useSidebarCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);
  // "hours" (DriverApp: week/add/payslip/history) or "vehicleCheck"
  // (VehicleCheckApp: new/history) — two independent driver-side
  // components, each with its own tab state, per
  // docs/VEHICLE_CHECK_ARCHITECTURE_PROPOSAL.md §8 ("its own view, not
  // a DriverApp tab").
  const [driverSection, setDriverSection] = useState("hours");
  const [driverTab, setDriverTab] = useState("week");
  const [vehicleCheckTab, setVehicleCheckTab] = useState("new");
  const [companyTab, setCompanyTab] = useState("drivers");

  const views = useViews(session ?? { personalWorkspace: null, managerialMemberships: [] });
  const [activeViewId, setActiveViewId] = useState(() => views[0]?.id ?? null);
  const activeView = views.find((v) => v.id === activeViewId) ?? views[0] ?? null;

  if (!session) {
    return (
      <div style={{ padding: 24, color: "#8B909A", background: "#14161A", minHeight: "100vh" }}>
        {sessionLoading ? t("loading") : t("noActivePerson")}
      </div>
    );
  }

  const closeMobile = () => setMobileOpen(false);

  const isTransportManager = activeView?.kind === "company" && (activeView.roles ?? []).includes("transport_manager");

  const groups =
    activeView?.kind === "company"
      ? [
          // Gated on the transport_manager role specifically, not on
          // manager-tier generally like every group below — see
          // decision-2026-08-04-working-time-transport-manager-architecture:
          // the underlying legal duty is personal to the named TM, not a
          // generic "has company access" permission.
          ...(isTransportManager
            ? [
                {
                  label: t("nav.transportManagerGroup"),
                  items: [
                    { key: "transportManager", label: t("nav.transportManager"), icon: <ShieldCheck size={16} />, active: companyTab === "transportManager", onClick: () => { setCompanyTab("transportManager"); closeMobile(); } },
                  ],
                },
              ]
            : []),
          {
            label: t("nav.workGroup"),
            items: [
              { key: "placements", label: t("nav.workPlacements"), icon: <Briefcase size={16} />, active: companyTab === "placements", onClick: () => { setCompanyTab("placements"); closeMobile(); } },
            ],
          },
          {
            label: t("nav.managementGroup"),
            items: [
              { key: "drivers", label: t("nav.drivers"), icon: <Users size={16} />, active: companyTab === "drivers", onClick: () => { setCompanyTab("drivers"); closeMobile(); } },
              { key: "organisations", label: t("nav.organisations"), icon: <Building2 size={16} />, active: companyTab === "organisations", onClick: () => { setCompanyTab("organisations"); closeMobile(); } },
              { key: "sites", label: t("nav.sites"), icon: <MapPin size={16} />, active: companyTab === "sites", onClick: () => { setCompanyTab("sites"); closeMobile(); } },
              { key: "rateCards", label: t("nav.rateCards"), icon: <Banknote size={16} />, active: companyTab === "rateCards", onClick: () => { setCompanyTab("rateCards"); closeMobile(); } },
              { key: "vehicles", label: t("nav.vehicles"), icon: <Truck size={16} />, active: companyTab === "vehicles", onClick: () => { setCompanyTab("vehicles"); closeMobile(); } },
              { key: "checklistTemplates", label: t("nav.checklistTemplates"), icon: <ListChecks size={16} />, active: companyTab === "checklistTemplates", onClick: () => { setCompanyTab("checklistTemplates"); closeMobile(); } },
              { key: "defects", label: t("nav.defects"), icon: <ShieldAlert size={16} />, active: companyTab === "defects", onClick: () => { setCompanyTab("defects"); closeMobile(); } },
            ],
          },
        ]
      : [
          {
            label: t("nav.driverGroup"),
            items: [
              { key: "week", label: t("nav.dashboard"), icon: <GaugeIcon size={16} />, active: driverSection === "hours" && driverTab === "week", onClick: () => { setDriverSection("hours"); setDriverTab("week"); closeMobile(); } },
              { key: "add", label: t("nav.addShift"), icon: <Plus size={16} />, active: driverSection === "hours" && driverTab === "add", onClick: () => { setDriverSection("hours"); setDriverTab("add"); closeMobile(); } },
              { key: "payslip", label: t("nav.payslip"), icon: <ClipboardCheck size={16} />, active: driverSection === "hours" && driverTab === "payslip", onClick: () => { setDriverSection("hours"); setDriverTab("payslip"); closeMobile(); } },
              { key: "history", label: t("nav.history"), icon: <HistoryIcon size={16} />, active: driverSection === "hours" && driverTab === "history", onClick: () => { setDriverSection("hours"); setDriverTab("history"); closeMobile(); } },
              // No tab of its own (unlike week/add/payslip/history) —
              // WorkplacesApp is a single list+form screen, so entering
              // this section doesn't need a driverTab value.
              { key: "workplaces", label: t("nav.workplaces"), icon: <Briefcase size={16} />, active: driverSection === "workplaces", onClick: () => { setDriverSection("workplaces"); closeMobile(); } },
              { key: "documents", label: t("nav.documents"), icon: <FileText size={16} />, active: driverSection === "documents", onClick: () => { setDriverSection("documents"); closeMobile(); } },
              { key: "cpcTraining", label: t("nav.cpcTraining"), icon: <GraduationCap size={16} />, active: driverSection === "cpcTraining", onClick: () => { setDriverSection("cpcTraining"); closeMobile(); } },
            ],
          },
          {
            label: t("nav.vehicleCheckGroup"),
            items: [
              { key: "newCheck", label: t("nav.newCheck"), icon: <Truck size={16} />, active: driverSection === "vehicleCheck" && vehicleCheckTab === "new", onClick: () => { setDriverSection("vehicleCheck"); setVehicleCheckTab("new"); closeMobile(); } },
              { key: "checkHistory", label: t("nav.checkHistory"), icon: <ClipboardList size={16} />, active: driverSection === "vehicleCheck" && vehicleCheckTab === "history", onClick: () => { setDriverSection("vehicleCheck"); setVehicleCheckTab("history"); closeMobile(); } },
            ],
          },
          {
            // Deliberately NOT the company view's "Management" label —
            // property 9 in App.smoke.test.jsx enforces that a
            // driver-only role never sees the word "Management"
            // anywhere, since it would misleadingly imply company-level
            // authority. "Vehicle Setup" is its own distinct string.
            // Split into its own group (not mixed into "Vehicle Check"
            // above) for the same reason company view splits "Work"
            // from "Management" — day-to-day actions vs. rarely-touched
            // setup.
            //
            // A true solo driver has no company workspace to manage
            // Vehicles/Checklists through (the company Management group
            // only ever appears for a "company" view) — these two route
            // the SAME management screens at the driver's own personal
            // workspace instead, same established pattern as
            // createSoloWorkContext/the personal-workspace self-rate
            // RateCard (see docs/ARCHITECTURE.md).
            label: t("nav.vehicleSetupGroup"),
            items: [
              { key: "vehicles", label: t("nav.vehicles"), icon: <Wrench size={16} />, active: driverSection === "vehicles", onClick: () => { setDriverSection("vehicles"); closeMobile(); } },
              { key: "checklistTemplates", label: t("nav.checklistTemplates"), icon: <ListChecks size={16} />, active: driverSection === "checklistTemplates", onClick: () => { setDriverSection("checklistTemplates"); closeMobile(); } },
              { key: "defects", label: t("nav.defects"), icon: <ShieldAlert size={16} />, active: driverSection === "defects", onClick: () => { setDriverSection("defects"); closeMobile(); } },
            ],
          },
        ];

  const switcher = {
    options: views.map((v) => ({ id: v.id, label: v.label })),
    activeId: activeView?.id ?? null,
    onChange: (id) => {
      setActiveViewId(id);
      closeMobile();
    },
  };

  return (
    <div className={`shell-root${collapsed ? " shell-root--collapsed" : ""}`}>
      <MobileDrawer open={mobileOpen} onToggle={() => setMobileOpen((o) => !o)} onClose={closeMobile} />
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileOpen={mobileOpen}
        switcher={switcher}
        groups={groups}
      />
      <main className="shell-main">
        {activeView?.kind === "company" ? (
          companyTab === "organisations" ? (
            <OrganisationsApp workspace={activeView.workspace} db={db} />
          ) : companyTab === "sites" ? (
            <SitesApp workspace={activeView.workspace} db={db} />
          ) : companyTab === "rateCards" ? (
            <RateCardsApp workspace={activeView.workspace} db={db} />
          ) : companyTab === "placements" ? (
            <PlacementsApp workspace={activeView.workspace} db={db} />
          ) : companyTab === "vehicles" ? (
            <VehiclesApp workspace={activeView.workspace} db={db} />
          ) : companyTab === "checklistTemplates" ? (
            <ChecklistTemplatesApp workspace={activeView.workspace} db={db} />
          ) : companyTab === "defects" ? (
            <DefectsApp workspace={activeView.workspace} db={db} />
          ) : companyTab === "transportManager" && isTransportManager ? (
            <TransportManagerApp personId={session.personId} workspace={activeView.workspace} db={db} />
          ) : (
            <CompanyApp workspace={activeView.workspace} db={db} />
          )
        ) : driverSection === "vehicleCheck" ? (
          <VehicleCheckApp
            personId={session.personId}
            homeWorkspaceId={session.personalWorkspace?.id}
            db={db}
            tab={vehicleCheckTab}
            onTabChange={setVehicleCheckTab}
          />
        ) : driverSection === "vehicles" ? (
          <VehiclesApp workspace={session.personalWorkspace} db={db} />
        ) : driverSection === "checklistTemplates" ? (
          <ChecklistTemplatesApp workspace={session.personalWorkspace} db={db} />
        ) : driverSection === "defects" ? (
          <DefectsApp workspace={session.personalWorkspace} db={db} />
        ) : driverSection === "workplaces" ? (
          <WorkplacesApp personId={session.personId} homeWorkspaceId={session.personalWorkspace?.id} db={db} />
        ) : driverSection === "documents" ? (
          <DriverDocumentsApp personId={session.personId} db={db} />
        ) : driverSection === "cpcTraining" ? (
          <CpcTrainingApp personId={session.personId} db={db} />
        ) : (
          <DriverApp
            personId={session.personId}
            homeWorkspaceId={session.personalWorkspace?.id}
            db={db}
            tab={driverTab}
            onTabChange={setDriverTab}
          />
        )}
      </main>
    </div>
  );
}
