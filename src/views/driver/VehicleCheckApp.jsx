import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, AlertTriangle, MinusCircle } from "lucide-react";
import { resolveAvailableVehiclesForDriver } from "../../services/vehicleService.js";
import { resolveDefaultChecklistTemplateForWorkspace } from "../../services/checklistTemplateService.js";
import { createVehicleCheck, listVehicleChecksForDriver } from "../../services/vehicleCheckService.js";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { Card, Field, EmptyState } from "../shared/atoms.jsx";
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from "../shared/styles.js";
import PageHeader from "../shell/PageHeader.jsx";

const RESULT_COLORS = { ok: "#3FBE63", defect: "#FF5A5F", not_applicable: "#8B909A" };
const RESULT_ICONS = { ok: CheckCircle2, defect: AlertTriangle, not_applicable: MinusCircle };
const DEFECT_STATUS_COLORS = { open: "#FF5A5F", reported: "#FF8A00", in_progress: "#4DD9E8", resolved: "#3FBE63" };
// Distinct from DEFECT_STATUS_COLORS.resolved (green, used per-item) —
// the CHECK-level badge needs its own colour so "this check found
// something, now fixed" reads differently from a check that was
// always clean (also green) or one still actively wrong (red).
const ALL_RESOLVED_COLOR = "#F0B90B";

/**
 * Single data-fetch for the whole screen (see DriverApp's identical
 * pattern) — resolves every vehicle the driver can currently check
 * (home workspace + active-assignment workspaces), that driver's own
 * check history, a vehicle lookup covering BOTH (a past check's
 * vehicle may have since been archived and dropped out of the
 * "available" set — history must still show its registration), each
 * available vehicle's workspace's active default ChecklistTemplate,
 * and every Defect raised from one of these checks (keyed by
 * `${checkId}:${itemCode}`) so History can show what actually happened
 * to a reported defect (status, resolution notes) — not just that one
 * was flagged.
 */
async function loadVehicleCheckAppData(personId, homeWorkspaceId, db) {
  const [vehicles, checks] = await Promise.all([
    resolveAvailableVehiclesForDriver(personId, homeWorkspaceId, db),
    listVehicleChecksForDriver(personId, db),
  ]);

  const availableIds = new Set(vehicles.map((v) => v.id));
  const missingIds = [...new Set(checks.map((c) => c.vehicleId))].filter((id) => !availableIds.has(id));
  const missingVehicles = await Promise.all(missingIds.map((id) => db.vehicles.getById(id)));
  const vehicleById = new Map([...vehicles, ...missingVehicles.filter(Boolean)].map((v) => [v.id, v]));

  const workspaceIds = [...new Set(vehicles.map((v) => v.workspaceId))];
  const templates = await Promise.all(workspaceIds.map((wsId) => resolveDefaultChecklistTemplateForWorkspace(wsId, db)));
  const templateByWorkspaceId = new Map(workspaceIds.map((wsId, i) => [wsId, templates[i]]));

  const checkIds = checks.map((c) => c.id);
  const relatedDefects = checkIds.length > 0 ? await db.defects.query({ where: { raisedFromCheckId: { in: checkIds } } }) : [];
  const defectByCheckItem = new Map(relatedDefects.map((d) => [`${d.raisedFromCheckId}:${d.raisedFromItemCode}`, d]));

  return { vehicles, checks, vehicleById, templateByWorkspaceId, defectByCheckItem };
}

function snapshotItems(template, vehicleId) {
  return template.items.map((item) => ({ ...item, result: null, notes: null, vehicleId }));
}

/** Groups a flat item list by category — same shape used for both the single-vehicle and paired-vehicle rendering paths. */
function groupByCategory(itemList) {
  const groups = [];
  for (const item of itemList) {
    const group = groups.find((g) => g.category === item.category);
    if (group) group.items.push(item);
    else groups.push({ category: item.category, items: [item] });
  }
  return groups;
}

function ItemResultButton({ active, color, label, icon, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: active ? `${color}22` : "#14161A",
        border: `1px solid ${active ? color : "#2A2E35"}`,
        borderRadius: 6,
        color: active ? color : "#8B909A",
        fontSize: 11.5,
        padding: "6px 8px",
        cursor: "pointer",
        fontFamily: "'Barlow', sans-serif",
      }}
    >
      {icon} {label}
    </button>
  );
}

export default function VehicleCheckApp({ personId, homeWorkspaceId, db, tab, onTabChange }) {
  const { t, i18n } = useTranslation(["vehicleCheck", "common"]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, loading: dataLoading, error: dataError } = useAsyncData(
    () => loadVehicleCheckAppData(personId, homeWorkspaceId, db),
    [personId, homeWorkspaceId, db, refreshTick]
  );
  const vehicles = data?.vehicles ?? [];
  const checks = data?.checks ?? [];
  const vehicleById = data?.vehicleById ?? new Map();
  const templateByWorkspaceId = data?.templateByWorkspaceId ?? new Map();
  const defectByCheckItem = data?.defectByCheckItem ?? new Map();

  const [vehicleId, setVehicleId] = useState("");
  const [pairedVehicleId, setPairedVehicleId] = useState("");
  const [odometerReading, setOdometerReading] = useState("");
  const [items, setItems] = useState([]);
  const [driverSignOffName, setDriverSignOffName] = useState("");

  const selectedVehicle = vehicles.find((v) => v.id === vehicleId) ?? null;
  const activeTemplate = selectedVehicle ? templateByWorkspaceId.get(selectedVehicle.workspaceId) ?? null : null;
  // A trailer can only be paired with a tractor unit from the SAME
  // workspace (a paired check is one submission owned by one
  // workspace) — see decision-2026-08-04-working-time-owner-operator-architecture.
  const pairableTrailers =
    selectedVehicle?.vehicleType === "tractor_unit"
      ? vehicles.filter((v) => v.vehicleType === "trailer" && v.workspaceId === selectedVehicle.workspaceId)
      : [];
  const pairedVehicle = pairedVehicleId ? vehicles.find((v) => v.id === pairedVehicleId) ?? null : null;

  // Defaults to the first available vehicle once data loads, and resets
  // the item snapshot whenever the resolved template actually changes
  // (switching vehicle, or vehicles finish loading) — never on every
  // keystroke while filling in the form.
  useEffect(() => {
    if (!vehicleId && vehicles.length > 0) {
      setVehicleId(vehicles[0].id);
    }
  }, [vehicles, vehicleId]);

  useEffect(() => {
    if (!activeTemplate || !selectedVehicle) {
      setItems([]);
      return;
    }
    const primaryItems = snapshotItems(activeTemplate, selectedVehicle.id);
    setItems(pairedVehicleId ? [...primaryItems, ...snapshotItems(activeTemplate, pairedVehicleId)] : primaryItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTemplate?.id, pairedVehicleId]);

  // A vehicle switch away from a tractor unit (or to a different one)
  // drops any trailer pairing rather than silently carrying a stale
  // selection over.
  useEffect(() => {
    setPairedVehicleId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  function setItemResult(index, result) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, result } : item)));
  }

  function setItemNotes(index, notes) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, notes } : item)));
  }

  // When paired, the walkthrough is presented as two clearly-labelled
  // passes over the same checklist (Tractor unit -> Trailer) rather
  // than one merged list — each pass's items already carry their own
  // vehicleId (set at snapshot time above), so grouping by that here
  // is purely a rendering concern, no re-derivation.
  const vehicleSections = useMemo(() => {
    if (!pairedVehicleId) return [{ vehicleId: selectedVehicle?.id, label: null, groups: groupByCategory(items) }];
    return [
      {
        vehicleId: selectedVehicle?.id,
        label: t("vehicleCheck:new.tractorSection"),
        groups: groupByCategory(items.filter((item) => item.vehicleId === selectedVehicle?.id)),
      },
      {
        vehicleId: pairedVehicleId,
        label: t("vehicleCheck:new.trailerSection"),
        groups: groupByCategory(items.filter((item) => item.vehicleId === pairedVehicleId)),
      },
    ];
  }, [items, pairedVehicleId, selectedVehicle, t]);

  const allItemsAnswered = items.length > 0 && items.every((item) => item.result !== null);
  const canSave = Boolean(selectedVehicle) && Boolean(activeTemplate) && allItemsAnswered && driverSignOffName.trim().length > 0;

  function resetForm() {
    setVehicleId(vehicles[0]?.id ?? "");
    setPairedVehicleId("");
    setOdometerReading("");
    setDriverSignOffName("");
    setSaveError("");
  }

  async function saveCheck() {
    if (!canSave || !selectedVehicle || !activeTemplate) return;
    setSaving(true);
    try {
      await createVehicleCheck(
        {
          workspaceId: selectedVehicle.workspaceId,
          driverId: personId,
          vehicleId: selectedVehicle.id,
          pairedVehicleId: pairedVehicleId || null,
          shiftId: null,
          checklistTemplateId: activeTemplate.id,
          items,
          odometerReading: odometerReading === "" ? null : Number(odometerReading),
          driverSignOffName: driverSignOffName.trim(),
        },
        db
      );
      setRefreshTick((t2) => t2 + 1);
      resetForm();
      onTabChange("history");
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const fmtDate = (iso) =>
    new Date(iso).toLocaleString(i18n.language, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

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
      {tab === "new" && (
        <div>
          <PageHeader title={t("vehicleCheck:new.title")} />
          <div className="shell-content" style={{ padding: 16 }}>
            {vehicles.length === 0 ? (
              <EmptyState title={t("vehicleCheck:new.noVehicles")} />
            ) : (
              <>
                <Card>
                  <Field label={t("vehicleCheck:new.vehicle")}>
                    <select style={inputStyle} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                      {vehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.registration}
                          {v.make || v.model ? ` · ${[v.make, v.model].filter(Boolean).join(" ")}` : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("vehicleCheck:new.odometer")}>
                    <input
                      type="number"
                      min="0"
                      style={inputStyle}
                      value={odometerReading}
                      onChange={(e) => setOdometerReading(e.target.value)}
                    />
                  </Field>
                  {pairableTrailers.length > 0 && (
                    <Field label={t("vehicleCheck:new.pairedVehicle")}>
                      <select style={inputStyle} value={pairedVehicleId} onChange={(e) => setPairedVehicleId(e.target.value)}>
                        <option value="">{t("vehicleCheck:new.noPairedVehicle")}</option>
                        {pairableTrailers.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.registration}
                            {v.make || v.model ? ` · ${[v.make, v.model].filter(Boolean).join(" ")}` : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {pairableTrailers.length > 0 && (
                    <div style={{ fontSize: 11, color: "#8B909A", marginTop: -8, marginBottom: 14 }}>{t("vehicleCheck:new.pairedVehicleHint")}</div>
                  )}
                </Card>

                {!activeTemplate ? (
                  <Card style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 13, color: "#B8BCC4" }}>{t("vehicleCheck:new.noChecklist")}</div>
                  </Card>
                ) : (
                  <>
                    {vehicleSections.map((section) => (
                      <div key={section.vehicleId}>
                        {section.label && (
                          <div style={{ fontSize: 12.5, fontFamily: "'Oswald', sans-serif", marginTop: 16, marginBottom: 4 }}>{section.label}</div>
                        )}
                        {section.groups.map((group) => (
                          <Card key={`${section.vehicleId}:${group.category}`} style={{ marginTop: 12 }}>
                            <div style={{ fontSize: 11, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
                              {group.category}
                            </div>
                            {group.items.map((item) => {
                              const index = items.indexOf(item);
                              return (
                                <div key={item.code} style={{ marginBottom: 14 }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                                    <span style={{ fontSize: 13.5 }}>{item.label}</span>
                                    <div style={{ display: "flex", gap: 6 }}>
                                      <ItemResultButton
                                        active={item.result === "ok"}
                                        color={RESULT_COLORS.ok}
                                        icon={<CheckCircle2 size={13} />}
                                        label={t("vehicleCheck:new.resultOk")}
                                        onClick={() => setItemResult(index, "ok")}
                                      />
                                      <ItemResultButton
                                        active={item.result === "defect"}
                                        color={RESULT_COLORS.defect}
                                        icon={<AlertTriangle size={13} />}
                                        label={t("vehicleCheck:new.resultDefect")}
                                        onClick={() => setItemResult(index, "defect")}
                                      />
                                      <ItemResultButton
                                        active={item.result === "not_applicable"}
                                        color={RESULT_COLORS.not_applicable}
                                        icon={<MinusCircle size={13} />}
                                        label={t("vehicleCheck:new.resultNotApplicable")}
                                        onClick={() => setItemResult(index, "not_applicable")}
                                      />
                                    </div>
                                  </div>
                                  {item.result === "defect" && (
                                    <input
                                      style={{ ...inputStyle, marginTop: 8, fontSize: 13 }}
                                      placeholder={t("vehicleCheck:new.defectNotesPlaceholder")}
                                      value={item.notes ?? ""}
                                      onChange={(e) => setItemNotes(index, e.target.value)}
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </Card>
                        ))}
                      </div>
                    ))}

                    <Card style={{ marginTop: 12 }}>
                      <Field label={t("vehicleCheck:new.signOffName")}>
                        <input
                          style={inputStyle}
                          value={driverSignOffName}
                          onChange={(e) => setDriverSignOffName(e.target.value)}
                        />
                      </Field>
                      <div style={{ fontSize: 11, color: "#8B909A" }}>{t("vehicleCheck:new.signOffHint")}</div>
                    </Card>

                    {saveError && <div style={{ color: "#FF5A5F", fontSize: 13, marginTop: 10 }}>{saveError}</div>}
                    {!allItemsAnswered && (
                      <div style={{ color: "#8B909A", fontSize: 12, marginTop: 10 }}>{t("vehicleCheck:new.answerAllHint")}</div>
                    )}

                    <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                      <button onClick={saveCheck} disabled={!canSave || saving} style={{ ...primaryBtnStyle, opacity: !canSave || saving ? 0.5 : 1 }}>
                        {t("vehicleCheck:new.save")}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {tab === "history" && (
        <div>
          <PageHeader title={t("vehicleCheck:history.title")} />
          <div className="shell-content" style={{ padding: 16 }}>
            {checks.length === 0 ? (
              <EmptyState title={t("vehicleCheck:history.empty")} />
            ) : (
              [...checks].reverse().map((check) => {
                const vehicle = vehicleById.get(check.vehicleId);
                const pairedCheckVehicle = check.pairedVehicleId ? vehicleById.get(check.pairedVehicleId) : null;
                const failedItems = check.items.filter((item) => item.result === "defect");
                const ok = check.overallResult === "ok";
                // overallResult itself never changes after creation (it's
                // the honest historical record of what THIS check found —
                // same "pin at creation" reasoning as Shift.rateCardId).
                // The badge shown here is smarter than that raw field
                // though: once every Defect this check raised reaches
                // 'resolved', keep showing that instead of a permanently
                // alarming "Defects found" for an issue that's long since
                // been fixed.
                const linkedDefects = failedItems
                  .map((item) => defectByCheckItem.get(`${check.id}:${item.code}`))
                  .filter(Boolean);
                const allResolved = !ok && linkedDefects.length > 0 && linkedDefects.every((d) => d.status === "resolved");
                const badgeColor = ok ? RESULT_COLORS.ok : allResolved ? ALL_RESOLVED_COLOR : RESULT_COLORS.defect;
                const badgeLabel = ok
                  ? t("vehicleCheck:history.statusOk")
                  : allResolved
                  ? t("vehicleCheck:history.statusDefectsResolved")
                  : t("vehicleCheck:history.statusDefects");
                return (
                  <Card key={check.id} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15 }}>
                          {vehicle?.registration ?? "—"}
                          {pairedCheckVehicle ? ` + ${pairedCheckVehicle.registration}` : ""}
                        </div>
                        <div style={{ fontSize: 12, color: "#8B909A", marginTop: 2 }}>
                          {fmtDate(check.performedAt)} · {check.driverSignOffName}
                          {check.odometerReading != null ? ` · ${check.odometerReading} mi` : ""}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          color: badgeColor,
                          border: `1px solid ${badgeColor}`,
                          borderRadius: 4,
                          padding: "2px 6px",
                          flexShrink: 0,
                        }}
                      >
                        {badgeLabel}
                      </span>
                    </div>

                    {/* Each reported defect + what's actually happened to it since
                        (status workflow, resolution notes) — not just that it was flagged. */}
                    {failedItems.length > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #2A2E35" }}>
                        {failedItems.map((item) => {
                          const defect = defectByCheckItem.get(`${check.id}:${item.code}`);
                          return (
                            <div key={item.code} style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                              <div style={{ fontSize: 12.5, color: "#FF9498" }}>
                                {pairedCheckVehicle && (
                                  <span style={{ color: "#8B909A" }}>
                                    {(item.vehicleId === check.pairedVehicleId ? pairedCheckVehicle : vehicle)?.registration} ·{" "}
                                  </span>
                                )}
                                {item.label}
                                {item.notes ? ` — ${item.notes}` : ""}
                                {defect?.status === "resolved" && defect.resolvedNotes && (
                                  <div style={{ fontSize: 11.5, color: "#4DD9E8", marginTop: 2 }}>
                                    {t("vehicleCheck:history.defectResolvedNote", { notes: defect.resolvedNotes })}
                                  </div>
                                )}
                              </div>
                              {defect && (
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 600,
                                    color: DEFECT_STATUS_COLORS[defect.status],
                                    border: `1px solid ${DEFECT_STATUS_COLORS[defect.status]}`,
                                    borderRadius: 4,
                                    padding: "2px 6px",
                                    flexShrink: 0,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {t(`vehicleCheck:history.defectStatus.${defect.status}`)}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Full item-by-item breakdown (OK/Defect/N-A for every
                        item, not just the failed ones) — collapsed by
                        default, matches this app's existing disclosure
                        pattern (Dashboard's "Compliance rules explained"). */}
                    <details style={{ marginTop: 10 }}>
                      <summary style={{ fontSize: 11, color: "#8B909A", cursor: "pointer" }}>
                        {t("vehicleCheck:history.showAllItems")}
                      </summary>
                      <div style={{ marginTop: 8 }}>
                        {check.items.map((item) => {
                          const Icon = RESULT_ICONS[item.result] ?? MinusCircle;
                          const color = RESULT_COLORS[item.result] ?? RESULT_COLORS.not_applicable;
                          return (
                            <div key={`${item.vehicleId}:${item.code}`} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#B8BCC4", marginBottom: 4 }}>
                              <Icon size={13} color={color} style={{ flexShrink: 0 }} />
                              <span>
                                {pairedCheckVehicle && (
                                  <span style={{ color: "#8B909A" }}>
                                    {(item.vehicleId === check.pairedVehicleId ? pairedCheckVehicle : vehicle)?.registration} ·{" "}
                                  </span>
                                )}
                                {item.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  </Card>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
