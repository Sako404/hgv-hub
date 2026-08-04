# HGV HUB — Per-Load Pay Architecture Proposal

Status: **Draft, awaiting Alex's approval.** Nothing in this file has
been implemented. Following the same propose-then-approve-then-build-
in-stages process used for
[[decision-2026-08-03-working-time-vehicle-check-module-architecture]]
and the Workplaces feature — this is a comparable-sized change, and it
touches the CORE Shift/RateCard/payEngine model everything else
(compliance, payslip, history) already depends on, so it deserves the
same rigor, if not more.

Origin: Alex asked what happens for a driver who isn't paid hourly
but per trip/load — e.g. a self-employed owner-operator with their own
truck, booking spot loads through a platform like Amazon Relay. Follow-
up answers (2026-08-03):

1. **Rate model**: not a formula the app can compute — the amount is
   negotiated per contract/spot load at booking time (Amazon Relay
   named as the concrete example). Must support this alongside the
   existing hourly model, for both solo drivers and company-managed
   ones — not a replacement.
2. **Shift-to-load cardinality**: one Shift can contain **several**
   separately-priced loads.
3. **Compliance**: stays fully required — hours/rest tracking applies
   to this driver too (tachograph rules don't care how they're paid).

## 0. TL;DR

A new **`Load`** entity: one row per paid trip, `shiftId`-linked (a
Shift can have zero, one, or several), carrying a manually-entered
`amount` — there is no formula to resolve this from, unlike every
other priced value in this app, so "automatic" here means the app
totals/aggregates what's entered, not that it derives the number
itself. `RateCardLineage` gains `payType: 'hourly' | 'per_load'`;
`'per_load'` lineages carry no rate grid at all (nothing to configure —
each Load's amount stands alone). `Shift.rateCardId` still pins to a
specific `RateCard` version exactly as today (needed for both the
`payType` flag itself and possible future per-load-scheme metadata),
but `payEngine.computeShiftBreakdown`'s pay total comes from summing
that shift's Loads instead of hours × grid-rate when `payType ===
'per_load'`. **Compliance (`complianceEngine.js`) needs zero changes**
— already Shift-only, RateCard-blind by construction (see
`docs/ARCHITECTURE.md`).

Two staged sub-phases:

- **PL-1**: `RateCardLineage.payType` + `Load` domain/migration +
  RateCard creation UI (both `RateCardsApp` company-side and
  `WorkplacesApp`'s `createSoloWorkContext` solo-driver flow) gains a
  pay-type choice, skipping the rate grid entirely for `'per_load'`.
- **PL-2**: Add Shift UI support for `per_load` shifts (a dynamic
  load-entry list, reusing the "add/remove rows" pattern
  `ChecklistItemsField` already established) + `payEngine` per-load
  total computation + Payslip/Dashboard totals reflect it.

Four scope calls made unilaterally while drafting — flagged in §6 for
confirmation before any code is written.

## 1. Why this needs its own proposal

Every other domain concept added this session (Vehicle, Defect, Load's
closest sibling in spirit) was purely additive — new collections, new
screens, zero changes to how `Shift`/pay already worked. This one is
different: it changes what "the pay for this Shift" *means* at the
lowest level, for a subset of shifts. Getting the boundary wrong
(e.g. accidentally coupling compliance to pay type, or breaking the
existing hourly pinning guarantees) would be far more expensive to
unwind than an additive module.

## 2. Proposed domain model additions

### 2.1 `RateCardLineage.payType` (new field)

```js
/**
 * 'hourly' (existing, unchanged behaviour) or 'per_load' — a
 * per_load lineage's RateCard versions carry an EMPTY/unused `rates`
 * grid (see §2.2); there is nothing to configure at the rate-card
 * level, since every load's amount is agreed individually. Locked
 * once any RateCard version in this lineage has been referenced by a
 * Shift or Load — same re-parenting-lock pattern Site.organisationId
 * already established — switching an in-use lineage's pay type would
 * retroactively confuse every Shift/Load priced under it.
 * @property {'hourly'|'per_load'} payType
 */
```

### 2.2 `RateCard.rates` for a `per_load` lineage

Left as an empty object (`{}`) — `payEngine` never reads it for
`per_load` shifts. Keeping the field (rather than making it
nullable/polymorphic) avoids special-casing every place that already
assumes a `RateCard` has a `.rates` object.

### 2.3 `Load` (new entity)

```js
/**
 * One paid trip/load within a Shift — the unit of pay for a
 * 'per_load' RateCard. `amount` is entered directly, never derived:
 * unlike every other priced value in this app, there is no formula to
 * resolve it from (real-world rates are negotiated per booking/
 * contract) — see the module's architecture proposal §0. Multiple
 * Loads may reference the same Shift (a driver can run several paid
 * legs in one shift). Owned by the same workspace as its Shift.
 * @typedef {Object} Load
 * @property {string} id
 * @property {string} workspaceId - == the owning Shift's workspaceId
 * @property {string} shiftId
 * @property {string|null} reference - booking/load reference number, optional
 * @property {string|null} description - e.g. route, broker/platform name ("Amazon Relay — Load #1234")
 * @property {number} amount - the agreed £ total for this load
 * @property {number|null} distanceMiles - optional, record-keeping only, never used in any calculation
 * @property {string} createdAt
 */
```

No versioning/pinning concerns the way `RateCard` needed them — a
`Load`'s `amount` is the pinned value already, entered once. Deleting/
editing a `Load` is a plain CRUD operation, not a "never mutate,
append a new version" one.

## 3. `payEngine.js` changes

`computeShiftBreakdown(shift, rateCard, loads)` gains a third
parameter. When `rateCard?.payType === 'per_load'`: skip the entire
hours×grid segment-building path, set `totalBasePay = totalHolidayDiff
= 0`, `totalGross = sum(loads.map(l => l.amount))`, `priced:
loads.length > 0`. `dutyMinutes`/`paidMinutes`/`totalPaidHours` are
computed EXACTLY as today regardless of pay type — compliance and the
Dashboard's hours/driving KPIs must never know or care how the shift
was priced.

## 4. Staged build plan

| Stage | Scope |
|---|---|
| PL-1 | `RateCardLineage.payType`, `Load` domain + migration, RateCard creation UI (`RateCardsApp` + `WorkplacesApp`) gains a pay-type choice — `per_load` skips `RateGridField` entirely |
| PL-2 | Add Shift UI: a dynamic load-entry list (add/remove rows: reference, description, amount, optional mileage) for `per_load` shifts, shown ALONGSIDE the existing date/start/end/driving/break fields (compliance tracking unchanged — §0 point 3); `payEngine` per-load total wiring; Payslip/Dashboard totals updated |

Same per-stage stop-and-report discipline as Vehicle Check.

## 5. Scope calls made unilaterally — please confirm or override

1. **`payType` lives on `RateCardLineage`, not per-version `RateCard`**
   — a whole rate-card scheme is either hourly or per-load; switching
   between them mid-lineage would be nonsensical (what would "revise
   this per-load scheme's hourly grid" even mean). Locked once
   referenced, same as Site's re-parenting lock.
2. **`Load.amount` is a single flat figure**, not decomposed into
   base+holiday the way hourly pay is. Real per-load contracts
   (Amazon Relay and similar) quote one all-in figure per load — there
   isn't a separate "holiday portion" to track the way the UK agency
   hourly-pay convention has one.
3. **No live pay preview while filling in a `per_load` shift** — the
   existing hourly Add Shift screen shows a running pay-preview card
   as you fill in times, computed from the rate grid; for `per_load`
   there's nothing to preview until the driver has actually entered
   amounts for each load, so the preview simply becomes "sum of
   what's entered so far."
4. **Compliance profile stays keyed the same way** (driver-scoped or
   platform-default) regardless of pay type — nothing here proposes a
   different compliance ruleset for owner-operators; that's a
   separate question if it ever comes up.

## 6. What stays explicitly out of scope

- **Mileage-rate calculation** (£/mile auto-computed from entered
  distance) — `distanceMiles` is captured for record-keeping only;
  Alex's answer named per-load/per-contract as the model to support,
  not a per-mile formula. Could be a future `Load`-level enhancement,
  not blocking PL-1/PL-2.
- **Load templates/presets** (e.g. saved common routes with known
  rates, to speed up entry) — nice-to-have, not requested.
- **Editing a Load after the fact via a full history/audit trail** —
  v1 treats it as plain CRUD (edit/delete like a Shift today), not a
  pinned/versioned record.
