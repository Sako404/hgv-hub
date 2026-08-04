# HGV HUB — Transport Manager Role: Architecture Proposal

Status: **Approved 2026-08-04**, with one scope expansion made during
review: Alex chose to extend `Vehicle` with MOT/insurance expiry
tracking (§5.1) rather than leaving it out — the only scope call where
he picked the non-default option; the other two (dashboard gated to
`transport_manager` only, §5.2; add `tm_cpc` tracking, §5.5) were
confirmed as recommended. See
[[decision-2026-08-04-working-time-transport-manager-architecture]].
Backlog origin: `30_PROJECTS/ACTIVE/project-working-time.md`, "Future
roadmap ideas" #4, captured 2026-08-03. Alex's explicit instruction
for this proposal: **the whole thing must actually comply with the
real regulations**, not an approximation — so this proposal is grounded
in the current (2026) Senior Traffic Commissioner statutory guidance
and DVSA operator-licensing guidance, cited throughout, rather than a
generic "compliance dashboard" guess.

## 0. TL;DR

A UK goods-vehicle Operator's Licence (O-licence) Transport Manager
(TM) is a **named, personally-liable role** distinct from any
`owner`/`admin`/`manager` — the Traffic Commissioner holds that
specific person responsible for "genuine, continuous and effective
management" of the transport operation [1][2]. This proposal adds a
new `transport_manager` `Role`, plus one new company-side screen — a
**compliance roll-up dashboard** across every driver and vehicle in a
workspace at once — built entirely by re-querying data this app
*already captures* (driver hours compliance, CPC training cycles,
document expiry, vehicle defects) rather than inventing new record
types. It also adds a genuinely useful, regulation-specific check this
app is uniquely positioned to compute: whether an **external** TM
(one person named TM across several operators) is within the legal
4-operator/50-vehicle limit [3], using the Membership model that
already spans workspaces.

**Revised during review**: `Vehicle` gains two optional expiry-date
fields (MOT, insurance) so the dashboard can show real roadworthiness
status, not just defect data — see §5.1 for the reasoning behind this
narrow, deliberate walk-back of VC-1's "identity-only" boundary
(scheduling/allocation/full maintenance history remain explicitly out
of scope; only these two expiry dates are added). Deliberately still
**not** attempted: any capture of "good repute" data (convictions/
fixed-penalty history — special-category personal data, see §5.4).

## 1. The regulatory basis (why this isn't a generic dashboard)

- Every **standard** operator's licence (as opposed to a restricted
  licence) must name at least one Transport Manager holding a
  Transport Manager CPC — a **different qualification from the Driver
  CPC** this app already tracks (`DriverDocument.documentType ===
  'cpc_card'`) [1][2]. Conflating the two would misrepresent a real
  legal distinction.
- The TM's defining duty is *continuous and effective management* —
  DVSA guidance describes this as maintaining oversight of "the
  systems, people and records that keep vehicles legal and operations
  compliant," and being able to demonstrate that oversight if
  challenged by the Traffic Commissioner [1]. A dashboard that rolls up
  the compliance state this app already computes (driver hours,
  training, documents, vehicle defects) into one place is a direct,
  legitimate implementation of that duty — not a stretch of scope.
- The **Senior Traffic Commissioner's Statutory Document No. 3**
  (revised guidance and directions, 9 January 2024) publishes a
  starting-point table of minimum weekly hours a TM should dedicate,
  scaled by fleet size [4] — reproduced in §2.2. This app already
  tracks `Vehicle` count per workspace (VC-1), so this table can be
  computed, not guessed.
- An **external** TM (contracted, not an employee/director/owner) may
  act for **no more than 4 operators, with a combined fleet of no more
  than 50 vehicles** [3][4]. This app's `Membership` model already
  lets one `Person` hold roles across multiple `Workspace`s (the
  existing workspace switcher is built on exactly this), so this limit
  is directly computable — see §2.3.

## 2. Proposed additions

### 2.1 New `Role`: `transport_manager`

```js
/** @typedef {'driver'|'owner'|'admin'|'manager'|'dispatcher'|'payroll'|'viewer'|'transport_manager'} Role */
```

Added to `workspaceService.MANAGER_ROLES` (so a TM sees the workspace
switcher/company nav like any other manager-tier role) — but the new
dashboard itself (§2.4) is gated more narrowly than that, on
`transport_manager` specifically, not on manager-tier generally (see
the scope call in §5.2): the duty is personal to the named TM, not a
generic "anyone with company access" view.

### 2.2 Fleet-size-based recommended hours (Stat Doc 3 table, §1)

A small, self-contained constant table + lookup function
(`transportManagerEngine.resolveRecommendedHours(vehicleCount)`),
reproducing the published bands [4]:

| Vehicles | Recommended hours/week |
|---|---|
| ≤2 | 2–4 |
| 3–5 | 4–8 |
| 6–10 | 8–12 |
| 11–14 | 12–20 |
| 15–29 | 20–30 |
| 30–50 | 30–full time |
| \>50 | Full time + additional assistance |

Purely informational — the dashboard shows "this workspace has N
vehicles → the published guidance suggests X–Y hours/week," with the
same "starting point only, not a fixed rule" caveat the statutory
document itself carries [4]. No hours are captured or enforced; this
app has no working-time-for-managers concept and isn't proposing one.

### 2.3 External-TM operator/vehicle limit check

`transportManagerEngine.resolveExternalTmLimitStatus(workspaceSummaries)`
— given every `{workspaceId, vehicleCount}` a person holds the
`transport_manager` role in (cross-workspace, same query shape
`resolveSession`'s `managerialMemberships` already uses), returns
whether they're within the 4-operator/50-vehicle limit [3][4]. Shown
as a warning banner on the dashboard, in every workspace the TM
manages, if exceeded. This doesn't distinguish "internal" vs
"external" TM (the app has no employment-contract-type field to key
that off) — the check is shown to every `transport_manager`-role
holder as a precaution; a TM who's an owner/employee of their one
workspace will simply never trip it in practice.

### 2.4 The dashboard — mostly a roll-up, plus two new opt-in `Vehicle` fields

New company-side screen, gated on `transport_manager` (§5.2), reusing
existing services with almost zero new domain writes:

- **Driver hours compliance**, per active driver: worst-case
  ok/warning/problem from `complianceEngine.computeCompliance`
  (already computed per-driver in `DriverDrilldown`; this is the same
  computation, summarised across every driver in one table instead of
  one driver at a time).
- **CPC training**, per active driver: `cpcTrainingService.
  resolveCpcCycleStatusForDriver` (CPC-2's own function, already
  shipped) — who's `ok`/`warning`/`problem`/`unknown_cycle`.
- **Driver documents**, per active driver: `documentExpiryEngine.
  resolveDriverDocumentSummary` (DE-1/DE-2) — licence/tacho-card/CPC-card
  expiry roll-up.
- **Vehicle defects**, per active vehicle: open `Defect` count/severity
  (`defectService`, VC-3).
- **Vehicle roadworthiness**, per active vehicle: MOT and insurance
  expiry status (see §2.5) — the one place this proposal adds new data
  capture, not just aggregation.
- The Stat Doc 3 hours guidance (§2.2) and the external-TM limit check
  (§2.3).

### 2.5 `Vehicle` gains MOT + insurance expiry (revised during review)

Alex chose to extend `Vehicle` rather than leave roadworthiness out
entirely (§5.1) — vehicle roadworthiness is one of the TM's core
statutory duties [1], and a dashboard that omits it while covering
driver hours/CPC/documents would be incomplete on exactly the point
that matters. Two new optional fields, captured on the existing
`VehiclesApp` create/edit form (no new screen):

```js
/** @property {string|null} motExpiryDate - "YYYY-MM-DD"; the goods vehicle's current MOT/annual test expiry. DVSA's own guidance and downloadable-certificate service use "MOT" for HGVs over 3.5t, not a car-specific term — see Sources. */
/** @property {string|null} insuranceExpiryDate - "YYYY-MM-DD" */
```

Status for each is derived with the SAME function DE-1 already built —
`documentExpiryEngine.resolveDocumentStatus({expiryDate: vehicle.motExpiryDate}, today)`
— rather than a new engine, since the shape (`{expiryDate}` in, an
ok/expiring_soon/expired/unknown status out) is identical. This stays
a narrow, deliberate carve-out from VC-1's "identity-only" boundary:
no maintenance history, no service scheduling, no tax/VED tracking, no
allocation/booking — only these two expiry dates, captured because the
TM dashboard specifically needs them and nothing else from a
"fleet management" system.

No new entity stores training/document-shaped data beyond this — the
dashboard itself is a read/aggregate layer over existing modules plus
these two new `Vehicle` fields.

## 3. UI

- New "Transport Manager" nav group (company view), visible only when
  the active workspace's `Membership` for the signed-in person includes
  `transport_manager` — one screen: the roll-up dashboard.
- i18n: new `transportManager` namespace, en-GB + pl-PL.
- No changes to any existing screen's content — `DriverDrilldown`
  already shows the same underlying data per-driver; this dashboard is
  the missing "all drivers/vehicles at once" view the backlog note
  asked for.

## 4. Migration impact

New migration `014_add_transport_manager_role.js` — additive only
(`transport_manager` is a new allowed value in the existing
`Membership.roles` array, no schema/store change, same as how earlier
role values were introduced). Likely a genuine no-op migration file
(mirrors 012/013) since no existing `Membership` row needs backfilling
into the new role.

## 5. Scope calls — decided

1. **MOT/insurance ARE tracked** (revised from the original
   recommendation to leave them out) — Alex's call. A real TM's
   duties include vehicle roadworthiness [1], and the dashboard would
   have been honest-but-incomplete on the one duty that matters most
   without it. `Vehicle` gains exactly two optional expiry-date fields
   (§2.5) — a narrow, named carve-out from VC-1's "identity-only"
   boundary, not a general fleet-management expansion (still no
   maintenance history, scheduling, allocation, or tax/VED tracking).
2. **Dashboard gated on `transport_manager` specifically, not on any
   manager-tier role.** Approved as recommended. Every other company screen today is visible to
   all of `owner`/`admin`/`manager`/`dispatcher`/`payroll` equally (no
   existing precedent for a role-specific-only screen) — this would be
   the first. Recommending yes anyway: the underlying legal duty is
   personal to the named TM, and showing it to every manager would
   blur that. Alternative: same visibility as other company screens
   (simpler, consistent with today's UI, but legally looser).
3. **No "good repute" data (past convictions/FPNs) captured anywhere**
   [1] — this is special-category personal data under UK GDPR
   (criminal-offence data) and this app has no legal-basis/security
   posture for that. Not proposing to build it, full stop, not even
   deferred — flagging explicitly since the regulation does mention it.
4. **External-TM 4-operator/50-vehicle check shown to every TM**, not
   only ones flagged "external" — simplest given the app has no
   employment-type field; recommending yes (§2.3 reasoning).
5. **Transport Manager CPC** (the qualification itself, distinct from
   Driver CPC) — proposing to add `'tm_cpc'` as a new
   `DriverDocumentType` value (reusing DE-1's entity, since it's
   structurally a person-owned certificate/reference-number record;
   `expiryDate` left optional/unused in practice since a TM CPC
   doesn't have the Driver CPC's periodic 5-year renewal cycle) so a
   TM's own qualification is at least visible under Documents,
   without inventing a new entity for one field's worth of difference.
   Alternative: skip capturing TM CPC entirely in v1 (the dashboard
   doesn't strictly need it to roll up driver/vehicle data). Recommend
   including it — cheap, and directly relevant to whether the named TM
   is even qualified.

## Sources

[1] gov.uk, "Goods vehicle operator licensing guide" — Transport
Manager qualifications, duties, good repute, record-keeping, and
consequences of failing continuous-and-effective-management:
https://www.gov.uk/guidance/goods-vehicle-operator-licensing-guide

[2] gov.uk / externaltransportmanager.co.uk summaries of Transport
Manager's personal responsibility for "genuine, continuous and
effective management" and core duties (driver licensing, hours,
vehicle roadworthiness).

[3] External Transport Manager limit — no more than 4 operators /
50 vehicles combined, per Senior Traffic Commissioner guidance
summaries.

[4] Senior Traffic Commissioner, Statutory Document No. 3 — Transport
Managers, revised guidance and directions (9 January 2024) — minimum
weekly hours table by fleet size:
https://assets.publishing.service.gov.uk/media/63971458e90e077c2d13d8cf/Stat_Doc_3_Transport_Managers_-_Comparison.pdf
