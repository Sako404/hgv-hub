// Date/time helpers and the rate-card-agnostic duration extraction, moved
// unchanged (in behavior) from the pre-refactor App.jsx.

export function parseDateTime(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

export function dayCategory(date) {
  const d = date.getDay();
  if (d === 0) return "Sun";
  if (d === 6) return "Sat";
  if (d === 5) return "Fri";
  return "MonThu";
}

export function windowType(date) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 6 && h < 14) return "Days";
  if (h >= 14 && h < 22) return "Lates";
  return "Nights";
}

export function buildBoundaries(start, end) {
  const boundaries = [new Date(start), new Date(end)];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - 1);
  const endLimit = new Date(end);
  endLimit.setHours(0, 0, 0, 0);
  endLimit.setDate(endLimit.getDate() + 1);
  while (cursor <= endLimit) {
    [6, 14, 22].forEach((h) => {
      const b = new Date(cursor);
      b.setHours(h, 0, 0, 0);
      if (b > start && b < end) boundaries.push(b);
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  boundaries.sort((a, b) => a - b);
  return boundaries.filter((b, i) => i === 0 || b.getTime() !== boundaries[i - 1].getTime());
}

/**
 * Rate-card-agnostic shift duration/break breakdown. complianceEngine.js
 * depends on this instead of payEngine.js — that's what keeps compliance
 * calculations independent of any RateCard/Organisation (see
 * docs/ARCHITECTURE.md, property: compliance engine stays generic).
 */
export function computeDuration(shift) {
  const start = parseDateTime(shift.date, shift.start);
  let end = parseDateTime(shift.date, shift.end);
  if (end <= start) end = new Date(end.getTime() + 24 * 3600 * 1000);
  const dutyMinutes = (end - start) / 60000;
  const breakMinutes = Number.isFinite(shift.breakMinutes) ? shift.breakMinutes : 45;
  const paidMinutes = Math.max(dutyMinutes - breakMinutes, 0);
  // Break is deducted from the END of the shift for rate-banding purposes
  // (paid time runs start -> start+paidMinutes, not the real clock-out,
  // and not spread proportionally) — matches the agency's real payslip.
  const paidEnd = new Date(start.getTime() + paidMinutes * 60000);
  return { start, end, dutyMinutes, paidMinutes, paidEnd };
}

export function getWeekStart(d) {
  const nd = new Date(d);
  nd.setHours(0, 0, 0, 0);
  nd.setDate(nd.getDate() - nd.getDay());
  return nd;
}

export function toKey(d) {
  return d.toISOString().slice(0, 10);
}

const DEFAULT_LOCALE = "en-GB";

/**
 * Locale-aware presentation only — the underlying week-range dates are
 * unchanged regardless of `locale`. Callers pass the active UI language
 * (e.g. i18n.language); this module has no dependency on i18next itself.
 */
export function fmtRange(startD, locale = DEFAULT_LOCALE) {
  const end = new Date(startD);
  end.setDate(end.getDate() + 6);
  const f = (d) => d.toLocaleDateString(locale, { day: "2-digit", month: "short" });
  return `${f(startD)} – ${f(end)}`;
}

/**
 * Currency is always GBP regardless of UI language — only the digit-
 * grouping/decimal convention follows `locale`. Uses Intl.NumberFormat
 * rather than manual string construction.
 */
export function money(n, locale = DEFAULT_LOCALE) {
  // currencyDisplay: "narrowSymbol" forces the £ glyph in every
  // supported locale — some locales' default currency-symbol data (e.g.
  // pl-PL) otherwise renders the ISO code "GBP" instead of "£".
  return new Intl.NumberFormat(locale, { style: "currency", currency: "GBP", currencyDisplay: "narrowSymbol" }).format(n || 0);
}

export function hoursToHM(hours) {
  const total = Math.max(0, Math.round((hours || 0) * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function hrs(n) {
  return hoursToHM(n);
}

export function hmToHours(hm) {
  if (!hm) return 0;
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) + (m || 0) / 60;
}
