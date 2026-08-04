import { computeDuration, hoursToHM, parseDateTime } from "./shiftMath.js";

// This module never imports payEngine or rateCardService — that absence
// is the load-bearing proof that compliance calculations stay driver-based
// and independent of any pay/organisation configuration (see
// docs/ARCHITECTURE.md).
//
// Alerts are returned as {date, code, params} — a language-independent
// shape. `code` is an i18next translation key under the `compliance:alerts`
// namespace and `params` are the interpolation values; the UI layer is
// solely responsible for turning these into English/Polish sentences (see
// src/i18n/locales/*/compliance.json). This engine must never contain a
// hardcoded UI string in either language.

/**
 * Identical algorithm to the pre-refactor App.jsx computeCompliance, with
 * every threshold literal replaced by complianceProfile.rules.*.
 * @param {import('../domain/types.js').Shift[]} shiftsSorted
 * @param {import('../domain/types.js').ComplianceProfile} complianceProfile
 * @param {{now?: Date}} [options] - `now`, when given, closes the cycle
 *   the same way a qualifying gap BETWEEN two logged shifts already does,
 *   but measured against wall-clock time since the last shift instead —
 *   without this, a driver who's had a proper rest but hasn't logged
 *   their NEXT shift yet would see stale counters/alerts from the closed
 *   cycle indefinitely, since there's no later shift for the loop below
 *   to measure a gap against. Optional and defaulting to no wall-clock
 *   check, so existing pure/deterministic callers (tests) are unaffected.
 */
export function computeCompliance(shiftsSorted, complianceProfile, { now } = {}) {
  const r = complianceProfile.rules;
  let reducedRestUsed = 0;
  let extendedDrivingUsed = 0;
  let longShiftUsed = 0;
  let alerts = [];
  let prevEnd = null;

  shiftsSorted.forEach((shift) => {
    const { start, end, dutyMinutes } = computeDuration(shift);
    const dutyHours = dutyMinutes / 60;
    if (prevEnd) {
      const gapHours = (start - prevEnd) / 3600000;
      if (gapHours >= r.cycleResetGapHours) {
        // A qualifying rest (>= cycleResetGapHours, e.g. a weekly rest)
        // closes out the cycle the same way it resets the three usage
        // counters below — alerts from an already-closed cycle are no
        // longer live/actionable, only historical. Once infringements
        // get their own persisted record with driver/TM explanations
        // (queued separately), that history lives there instead; this
        // engine stays a "what's relevant right now" view.
        reducedRestUsed = 0;
        extendedDrivingUsed = 0;
        longShiftUsed = 0;
        alerts = [];
      } else if (gapHours < r.minRestHardHours) {
        alerts.push({
          date: shift.date,
          code: "restBelowMinimum",
          params: { gapHours: gapHours.toFixed(1), date: shift.date, minHours: r.minRestHardHours },
        });
      } else if (gapHours < r.reducedRestUpperHours) {
        reducedRestUsed++;
        if (reducedRestUsed > r.reducedRestMaxPerCycle) {
          alerts.push({
            date: shift.date,
            code: "reducedRestBudgetExceeded",
            params: { used: reducedRestUsed, max: r.reducedRestMaxPerCycle, date: shift.date },
          });
        }
      }
    }
    if (dutyHours > r.absoluteMaxDailyHours) {
      alerts.push({
        date: shift.date,
        code: "dailyDutyAbsoluteMaxExceeded",
        params: { date: shift.date, duration: hoursToHM(dutyHours), maxHours: r.absoluteMaxDailyHours },
      });
    }
    if (dutyHours > r.longShiftThresholdHours) {
      longShiftUsed++;
      alerts.push({
        date: shift.date,
        code: "longShiftOverThreshold",
        params: {
          date: shift.date,
          duration: hoursToHM(dutyHours),
          thresholdHours: r.longShiftThresholdHours,
          maxPerCycle: r.longShiftMaxPerCycle,
        },
      });
      if (longShiftUsed > r.longShiftMaxPerCycle) {
        alerts.push({
          date: shift.date,
          code: "longShiftBudgetExceeded",
          params: { thresholdHours: r.longShiftThresholdHours, used: longShiftUsed, max: r.longShiftMaxPerCycle },
        });
      }
    }
    const driving = Number(shift.drivingHours) || 0;
    if (driving > r.drivingHardLimitHours) {
      alerts.push({
        date: shift.date,
        code: "drivingHardLimitExceeded",
        params: { driving, date: shift.date, maxHours: r.drivingHardLimitHours },
      });
    } else if (driving > r.extendedDrivingThresholdHours) {
      extendedDrivingUsed++;
      if (extendedDrivingUsed > r.extendedDrivingMaxPerWeek) {
        alerts.push({
          date: shift.date,
          code: "extendedDrivingBudgetExceeded",
          params: { used: extendedDrivingUsed, max: r.extendedDrivingMaxPerWeek, date: shift.date },
        });
      }
    }
    prevEnd = end;
  });

  if (now && prevEnd && (now - prevEnd) / 3600000 >= r.cycleResetGapHours) {
    reducedRestUsed = 0;
    extendedDrivingUsed = 0;
    longShiftUsed = 0;
    alerts = [];
  }

  return {
    reducedRestUsed: Math.min(reducedRestUsed, r.reducedRestMaxPerCycle),
    extendedDrivingUsed: Math.min(extendedDrivingUsed, r.extendedDrivingMaxPerWeek),
    longShiftUsed: Math.min(longShiftUsed, r.longShiftMaxPerCycle),
    alerts,
  };
}

export function rollingDrivingSum(shiftsSorted, days, refDate) {
  const cutoff = new Date(refDate.getTime() - days * 24 * 3600 * 1000);
  return shiftsSorted
    .filter((s) => {
      const d = parseDateTime(s.date, "00:00");
      return d > cutoff && d <= refDate;
    })
    .reduce((sum, s) => sum + (Number(s.drivingHours) || 0), 0);
}
