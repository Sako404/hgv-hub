import { useTranslation } from "react-i18next";
import { Pencil, Trash2, AlertTriangle } from "lucide-react";
import { hoursToHM, money } from "../../services/shiftMath.js";
import { iconBtnStyle, primaryBtnStyle, secondaryBtnStyle } from "./styles.js";

export function Card({ children, style, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "#1E2126",
        border: "1px solid #2A2E35",
        borderRadius: 10,
        padding: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: "#8B909A", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      {children}
    </label>
  );
}

export function BarRow({ label, value, max }) {
  const pct = Math.min(1, value / max);
  const danger = pct > 0.9;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#8B909A", marginBottom: 6 }}>
        <span>{label}</span>
        <span style={{ color: "#EDEEF0" }}>{hoursToHM(value)}/{max}h</span>
      </div>
      <div style={{ height: 8, background: "#14161A", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct * 100}%`, background: danger ? "#FF5A5F" : "#4DD9E8", borderRadius: 4 }} />
      </div>
    </div>
  );
}

/**
 * Compact "at a glance" KPI tile — used on the Dashboard for Hours /
 * Driving / Expected gross. Values are passed in pre-computed; this
 * component only presents them.
 */
export function KpiCard({ icon, label, value, valueColor = "#EDEEF0", footnote }) {
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#8B909A", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {icon} {label}
      </div>
      <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 22, marginTop: 4, color: valueColor, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      {footnote && <div style={{ fontSize: 10.5, color: "#8B909A", marginTop: 3 }}>{footnote}</div>}
    </Card>
  );
}

const STATUS_COLORS = { ok: "#3FBE63", warning: "#FF8A00", problem: "#FF5A5F" };

/**
 * Generic ok/warning/problem status pill — same colour scale
 * ComplianceStatusCard's inline badge uses, factored out as its own
 * component for compact table-row contexts (e.g. the Transport
 * Manager dashboard's per-driver/per-vehicle rows) where a full
 * ComplianceStatusCard would be too large. Label text is passed in
 * pre-translated, same convention as ComplianceStatusCard.
 */
export function StatusPill({ status, label }) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.ok;
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        color,
        border: `1px solid ${color}`,
        borderRadius: 4,
        padding: "2px 6px",
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/**
 * "Understand in under a second" compliance status card: category +
 * remaining count + a semantic OK/warning/problem badge. All text is
 * passed in pre-translated — this component only maps `status` to a
 * colour, never re-derives compliance meaning.
 */
export function ComplianceStatusCard({ categoryLabel, remainingLabel, statusLabel, status = "ok" }) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.ok;
  return (
    <Card style={{ padding: 12 }}>
      <div style={{ fontSize: 10.5, color: "#8B909A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
        {categoryLabel}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 13, color: "#EDEEF0" }}>{remainingLabel}</span>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color,
            border: `1px solid ${color}`,
            borderRadius: 4,
            padding: "2px 6px",
            flexShrink: 0,
          }}
        >
          {statusLabel}
        </span>
      </div>
    </Card>
  );
}

/**
 * Small active/archived pill — the master-data equivalent of
 * ComplianceStatusCard's inline badge, factored out since Organisations/
 * Sites/People all need the same active-vs-archived signal.
 */
export function StatusBadge({ active }) {
  const { t } = useTranslation("common");
  const color = active ? "#3FBE63" : "#8B909A";
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        color,
        border: `1px solid ${color}`,
        borderRadius: 4,
        padding: "2px 6px",
        flexShrink: 0,
      }}
    >
      {active ? t("active") : t("archived")}
    </span>
  );
}

/**
 * Confirm-before-archive dialog for master data — archiving an
 * Organisation/Site/etc deserves more friction than deleting one shift
 * row (which has no confirmation at all today).
 */
export function ArchiveConfirmDialog({ open, title, body, confirmLabel, onConfirm, onCancel }) {
  const { t } = useTranslation("common");
  if (!open) return null;
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}
      onClick={onCancel}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380, width: "100%" }}>
        <Card>
          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, marginBottom: 8 }}>{title}</div>
          {body && <div style={{ fontSize: 13, color: "#B8BCC4", marginBottom: 16 }}>{body}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onConfirm} style={primaryBtnStyle}>
              {confirmLabel ?? t("archive")}
            </button>
            <button onClick={onCancel} style={secondaryBtnStyle}>
              {t("cancel")}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

const DOCUMENT_STATUS_COLORS = { ok: "#3FBE63", expiring_soon: "#FF8A00", expired: "#FF5A5F", unknown: "#8B909A" };

/**
 * DriverDocument expiry status badge — same visual idiom as
 * ComplianceStatusCard's colour scale, but keyed on
 * documentExpiryEngine's own status vocabulary (a superset: adds
 * 'unknown' for "no expiry date set yet"). Shared between the driver's
 * own Documents screen and the company-side DriverDrilldown (DE-2) so
 * the exact same status reads identically in both places.
 */
export function DocumentStatusBadge({ status }) {
  const { t } = useTranslation("driverDocument");
  const color = DOCUMENT_STATUS_COLORS[status] ?? DOCUMENT_STATUS_COLORS.unknown;
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        color,
        border: `1px solid ${color}`,
        borderRadius: 4,
        padding: "2px 6px",
        flexShrink: 0,
      }}
    >
      {t(`status.${status}`)}
    </span>
  );
}

/**
 * The Dashboard/Transport Manager reminders banner — see
 * decision-2026-08-04-working-time-reminders-architecture. `items` is
 * `{severity: 'warning'|'problem', message}[]`, message pre-translated
 * same convention as ComplianceStatusCard. Renders nothing when empty,
 * so callers can render it unconditionally.
 */
export function ReminderBanner({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <Card style={{ marginBottom: 16 }}>
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            marginBottom: i < items.length - 1 ? 8 : 0,
          }}
        >
          <AlertTriangle size={14} color={item.severity === "problem" ? "#FF5A5F" : "#FF8A00"} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 12.5, color: item.severity === "problem" ? "#FF9498" : "#FFCB8A" }}>{item.message}</span>
        </div>
      ))}
    </Card>
  );
}

/** Generic empty-state block: message + an optional primary action. */
export function EmptyState({ title, action }) {
  return (
    <Card style={{ textAlign: "center", padding: 28 }}>
      <div style={{ color: "#B8BCC4", fontSize: 13.5, marginBottom: action ? 16 : 0 }}>{title}</div>
      {action}
    </Card>
  );
}

/**
 * Renders a list of {shift, breakdown} rows — the same rendering logic
 * used by DriverApp's history tab and by the company DriverDrilldown
 * (read-only there). Reusing this is what makes properties #6/#7
 * (identical Shift row, no duplication) visible in the UI, not just in
 * the data layer.
 */
export function ShiftHistoryList({ items, readOnly = false, onEdit, onDelete, emptyLabel }) {
  const { t, i18n } = useTranslation(["driver", "pay", "common"]);
  const resolvedEmptyLabel = emptyLabel ?? t("driver:history.empty");
  if (items.length === 0) {
    return <div style={{ color: "#8B909A", fontSize: 13 }}>{resolvedEmptyLabel}</div>;
  }
  return (
    <>
      {[...items].reverse().map(({ shift: s, breakdown: b }) => (
        <Card key={s.id} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15 }}>{s.date}</div>
              <div style={{ fontSize: 12, color: "#8B909A", marginTop: 2 }}>
                {s.start}–{s.end} · {t("pay:shiftSummary.driving", { driving: hoursToHM(s.drivingHours) })} ·{" "}
                {t("pay:shiftSummary.paid", { hours: hoursToHM(b.totalPaidHours) })}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, color: "#4DD9E8" }}>
                {b.priced || b.perLoad ? money(b.totalGross, i18n.language) : t("pay:shiftSummary.noRateCard")}
              </div>
              {b.priced && (
                <div style={{ fontSize: 11, color: "#8B909A" }}>
                  {b.perLoad
                    ? t("pay:shiftSummary.perLoadBreakdown", { count: b.loadsCount, total: money(b.totalGross, i18n.language) })
                    : t("pay:shiftSummary.breakdown", {
                        base: money(b.totalBasePay, i18n.language),
                        holiday: money(b.totalHolidayDiff, i18n.language),
                        total: money(b.totalGross, i18n.language),
                      })}
                </div>
              )}
              {!readOnly && (
                <div style={{ display: "flex", gap: 8, marginTop: 6, justifyContent: "flex-end" }}>
                  <button onClick={() => onEdit(s)} style={iconBtnStyle} aria-label={t("common:edit")}>
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => onDelete(s.id)} style={iconBtnStyle}>
                    <Trash2 size={14} color="#FF5A5F" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </Card>
      ))}
    </>
  );
}

export function TabBtn({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        background: "transparent",
        border: "none",
        color: active ? "#FF8A00" : "#8B909A",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "6px 0",
        cursor: "pointer",
        fontFamily: "'Barlow', sans-serif",
      }}
    >
      {icon}
      <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
    </button>
  );
}
