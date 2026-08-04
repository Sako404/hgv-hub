# Architecture: shared driver/organisation platform

This app is not a solo-driver prototype that will later be rewritten into
a company tool. It is one shared platform: individual HGV drivers and
agencies/small transport companies are both first-class users of **one
domain model**. A `Shift` exists once; driver and company views are
different queries over the same record, never separate copies.

See `src/domain/types.js` for the full entity definitions (Workspace,
Person, Membership, Role, Organisation, Site, DriverProfile, Engagement,
Assignment, Shift, RateCard, ComplianceProfile, DriverDocument,
CpcTrainingRecord).

## Entity ownership

Every `Workspace` is either `personal`, `agency`, or `transport_company`.
Ownership of each entity type follows the owning workspace:

- **`personal` workspace** owns: unassigned `Shift`s (`assignmentId ===
  null`, logged directly against the driver's own personal workspace),
  and optionally a self-rate `RateCard` for self-employed use.
- **`agency` / `transport_company` workspace** owns: its `Organisation`
  (1:1), its `Site`s, its `Engagement`s, its `Assignment`s, its
  `RateCard`s, every `Shift` whose `workspaceId` points to it, and (since
  the Vehicle Check module, VC-1) its `Vehicle`s and `ChecklistTemplate`s.
- **`Person`** is a global identity, not owned by any single workspace —
  the same person can hold memberships in several workspaces at once
  (their own personal workspace, plus a driver membership in an agency,
  plus a driver membership in a transport company, etc).
- **`Membership`** (the join row between `Person` and `Workspace`,
  carrying `roles: Role[]`) is meaningful to both sides and isn't "owned"
  by either.
- **`DriverProfile`** is conceptually 1:1 with a `Person`, stored in its
  own collection keyed by `personId`.
- **`DriverDocument`** (added Driver Document Expiry Tracking, DE-1) is
  the first entity owned by a `Person` directly, not by any `Workspace`
  at all — no `personal`/`agency`/`transport_company` workspace ever
  owns a row in this collection, and it has no `workspaceId` field to
  begin with. A driving licence/tacho card/CPC card is a fact about the
  driver, true regardless of which employer they're currently placed
  with — workspace-scoping it like every other entity above would mean
  duplicating the same expiry date per company and risking the copies
  disagreeing (see
  `docs/DRIVER_DOCUMENT_EXPIRY_ARCHITECTURE_PROPOSAL.md` §1). Only the
  owning driver may write it (`driverDocumentService`'s mutators are
  only ever called from the document owner's own driver-side screen); a
  company workspace may READ a driver's documents via an active
  `Membership`, same access pattern as reading their `Person` record
  today, but never write them.
- **`CpcTrainingRecord`** (added CPC Training tracking, CPC-1/CPC-2) is
  also person-owned, same rule as `DriverDocument` immediately above —
  a driver's logged training hours follow them across employers. Its
  35-hour/5-year cycle status is derived (`cpcTrainingEngine.
  resolveCpcCycleStatus`) from the driver's own active `cpc_card`
  `DriverDocument.expiryDate` rather than a separately-tracked cycle
  date — a real Driver Qualification Card's expiry already IS the end
  of the current training cycle under the DVSA rule, so no new setup
  field was needed. Same driver-write/company-read-only access split as
  `DriverDocument`.
- **`transport_manager`** (added for the Transport Manager compliance
  dashboard, see
  decision-2026-08-04-working-time-transport-manager-architecture) is a
  `Role`, not an entity — a UK O-licence Transport Manager, personally
  responsible for "continuous and effective management" of the
  transport operation (Senior Traffic Commissioner Statutory Document
  No. 3), a legal duty distinct from `owner`/`admin`/`manager`. Included
  in `MANAGER_ROLES` (workspace-switcher visibility) but the TM
  dashboard screen gates on this role specifically — the first
  role-specific-only screen in this app (every other company screen is
  visible to any manager-tier role equally). The dashboard itself is
  almost entirely a read/aggregate layer over existing modules (driver
  hours compliance, `CpcTrainingRecord`, `DriverDocument`, `Defect`)
  plus two Stat-Doc-3-derived checks computed from data already
  modelled (fleet-size hours guidance from `Vehicle` count; the
  external-TM 4-operator/50-vehicle limit from the existing
  cross-workspace `Membership` model) — see
  `src/services/transportManagerService.js`.
- **`ComplianceProfile`** is platform-level (`scope: "default"`) or
  **driver-scoped** — never organisation-scoped. This is what keeps the
  compliance engine (`src/services/complianceEngine.js`) generic: it
  takes only `(shifts, complianceProfile)` and never imports
  `RateCard`/`Organisation`/`payEngine`. Different rate cards or
  organisation configuration must never change a compliance calculation.

## The no-duplication rule

> A `Shift`'s owning `workspaceId` is fixed at creation time — the
> workspace behind its `Assignment`, or the driver's personal workspace
> if `assignmentId` is null. Driver-side code must always query the
> shared `shifts` collection by `driverId` (`listShiftsForDriver`,
> ignores `workspaceId`). Company-side code must always query it by
> `workspaceId` (`listShiftsForWorkspace`, ignores which driver). No code
> path may copy a `Shift` object into another collection, re-insert it
> under a new `id`, or otherwise materialize a second row to make it
> "appear" in a different view.

This is enforced by construction (both list functions in
`src/services/shiftService.js` read from the same `db.shifts`
repository) and covered by tests in `src/services/shiftVisibility.test.js`
and the company drilldown UI (`src/views/company/DriverDrilldown.jsx`,
which reuses `ShiftHistoryList` — the exact same rendering code
`DriverApp`'s history tab uses).

## Solo-driver UX

A person boots straight into `DriverApp` with **zero workspace-switcher
chrome** unless they hold a manager-tier role (`owner`, `admin`,
`manager`, `dispatcher`, `payroll`, `transport_manager`) somewhere —
see `resolveSession()`/`needsSwitcher` in
`src/services/workspaceService.js`. `transport_manager` is also
manager-tier for switcher purposes, but the Transport Manager
dashboard screen itself (see Entity ownership below) gates on that
role specifically, not on manager-tier generally — the one screen in
this app not visible to every manager-tier role equally.
A driver-only membership in an agency/company workspace does **not**
trigger the switcher: this covers both a true solo driver and Alex's
real case (a driver-only membership in Apex Driving alongside his
personal workspace).

## Employer changes preserve history

Ending an `Engagement` (`status: "ended"`) and starting a new one under a
different `Organisation` does not touch any existing `Shift` — "my
history" is always `listShiftsForDriver(driverId)`, which spans every
workspace the driver has ever logged a shift against, regardless of
which engagements are still active. See
`src/services/employerChange.test.js`.

## Export / import

`exportWorkspace(workspaceId, db)` bundles only what that workspace
**owns** as source of truth (workspace, organisation, sites, engagements,
assignments, rate cards, shifts, memberships) — it deliberately excludes
shifts a driver can merely *see* via a cross-workspace query but doesn't
own, preserving the ownership rule end to end. `importWorkspace` upserts
by id. Client-side only (`Blob` download / `FileReader` upload), no
backend.

## Multi-driver / multi-org proof

`src/services/seed/seedSecondCompany.js` seeds a second workspace
("Northline Transport Ltd") with its own site, a distinct `RateCard`, an owner
persona, and three demo drivers — proving multiple drivers can share one
company workspace with different rate cards, and that company data for
one driver never touches another's. Run `window.__seedSecondCompany()` in
the dev console, then `window.__setCurrentPerson(<ownerPersonId>)` (logged
to the console by the seed call) to view it as the company owner.

## What's intentionally NOT built yet

Documented here so it isn't silently dropped, not because it's forgotten:

- Authentication and real RBAC enforcement — roles are modeled and stored
  (`Membership.roles`) but nothing enforces them; this is a client-only,
  no-login app, and anyone with browser access to localStorage can read
  everything.
- Cloud backend / cross-device sync — storage is local-only, behind a
  `Repository` interface (`src/storage/LocalStorageRepository.js`) so a
  future `ApiRepository` can implement the same 6 methods without
  touching service code. `query()` takes a small serialisable criteria
  object — `{ where: { field: value | { in: [...] } } }`, AND across
  keys, `null` is a real equality value — never a JS predicate function,
  since a closure can't cross an HTTP boundary. Anything not expressible
  this way (e.g. "does this array *field* contain X") is narrowed via
  `where` first, then `.filter()`'d in the calling service — see
  `matchesCriteria`'s doc comment in `LocalStorageRepository.js`.
- Fleet management (scheduling/allocation, service/maintenance history,
  tax/VED tracking). The Vehicle Check module (VC-1, see
  `docs/VEHICLE_CHECK_ARCHITECTURE_PROPOSAL.md` and
  `decision-2026-08-03-working-time-vehicle-check-module-architecture`
  in the Brain) added a `Vehicle` entity, but deliberately narrow —
  identity only (registration, type), a check-target, not a fleet-ops
  record. The Transport Manager dashboard (see
  `decision-2026-08-04-working-time-transport-manager-architecture` in
  the Brain) later added exactly two roadworthiness expiry dates
  (`Vehicle.motExpiryDate`/`insuranceExpiryDate`) — a named, narrow
  exception because vehicle roadworthiness is a core Transport Manager
  statutory duty, NOT a reversal of this line: no service history,
  scheduling, allocation, or tax/VED tracking was added alongside it.
- Jobs / loads.
- Invoicing and customer billing.
- Payroll (beyond the existing pay-estimate/compliance calculators).
- Rota / scheduling.
- Timesheet approval workflows.
- SaaS multi-tenant hosting/isolation.
