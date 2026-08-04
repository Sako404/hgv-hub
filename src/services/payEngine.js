import { buildBoundaries, computeDuration, dayCategory, windowType } from "./shiftMath.js";

/**
 * Splits a shift's paid time into day/window-rate segments and prices
 * them against the given RateCard. Identical segment-building algorithm
 * to the pre-refactor App.jsx, parameterized by rateCard instead of a
 * hardcoded RATES constant.
 *
 * rateCard === null covers a solo driver with no Assignment yet: hours
 * still compute, pay fields are 0 and `priced: false` — the UI should
 * show "no rate card set", not a fabricated £0.00 as if calculated.
 *
 * When `rateCard.payType === 'per_load'` (see the per-load-pay
 * architecture proposal), the hours×grid segment path is skipped
 * entirely — `totalGross` is the sum of the given `loads`' `amount`
 * fields instead, `totalBasePay`/`totalHolidayDiff` stay 0 (no
 * base/holiday decomposition for a per-load figure), and `priced`
 * reflects whether any loads have been entered yet rather than
 * whether a rate card is assigned. `dutyMinutes`/`paidMinutes`/
 * `totalPaidHours` are computed identically regardless of pay type —
 * compliance and the hours/driving KPIs must never know or care how
 * a shift was priced.
 *
 * @param {import('../domain/types.js').Shift} shift
 * @param {import('../domain/types.js').RateCard|null} rateCard
 * @param {import('../domain/types.js').Load[]} [loads]
 */
export function computeShiftBreakdown(shift, rateCard, loads = []) {
  const { start, end, dutyMinutes, paidMinutes, paidEnd } = computeDuration(shift);

  if (!rateCard) {
    return {
      segments: [],
      dutyMinutes,
      paidMinutes,
      totalPaidHours: paidMinutes / 60,
      totalBasePay: 0,
      totalHolidayDiff: 0,
      totalGross: 0,
      start,
      end,
      priced: false,
      perLoad: false,
      loadsCount: 0,
    };
  }

  if (rateCard.payType === "per_load") {
    const totalGross = loads.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    return {
      segments: [],
      dutyMinutes,
      paidMinutes,
      totalPaidHours: paidMinutes / 60,
      totalBasePay: 0,
      totalHolidayDiff: 0,
      totalGross,
      start,
      end,
      priced: loads.length > 0,
      perLoad: true,
      loadsCount: loads.length,
    };
  }

  const boundaries = buildBoundaries(start, paidEnd);
  const segments = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const segStart = boundaries[i];
    const segEnd = boundaries[i + 1];
    const minutes = (segEnd - segStart) / 60000;
    if (minutes <= 0) continue;
    const cat = dayCategory(segStart);
    const win = windowType(segStart);
    const rate = rateCard.rates[cat][win];
    const hours = minutes / 60;
    const basePay = hours * rate[0];
    const incPay = hours * rate[1];
    segments.push({
      cat,
      win,
      hours,
      baseRate: rate[0],
      incRate: rate[1],
      basePay,
      incPay,
      holidayDiff: incPay - basePay,
    });
  }

  const totalPaidHours = segments.reduce((s, x) => s + x.hours, 0);
  const totalBasePay = segments.reduce((s, x) => s + x.basePay, 0);
  const totalHolidayDiff = segments.reduce((s, x) => s + x.holidayDiff, 0);
  const totalGross = totalBasePay + totalHolidayDiff;

  return {
    segments,
    dutyMinutes,
    paidMinutes,
    totalPaidHours,
    totalBasePay,
    totalHolidayDiff,
    totalGross,
    start,
    end,
    priced: true,
    perLoad: false,
    loadsCount: 0,
  };
}
