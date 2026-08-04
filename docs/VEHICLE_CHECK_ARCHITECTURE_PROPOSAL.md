# HGV HUB — Vehicle Check / Daily Walkaround Module: Architecture Proposal

Status: **Draft, awaiting Alex's approval.** Nothing in this file has
been implemented — this is a proposal, following the same
propose-then-approve-then-build-in-stages process used for
[[decision-2026-07-28-working-time-persistence-deployment-architecture]]
and [[decision-2026-07-28-working-time-part4-master-data-architecture]].
Backlog origin: `30_PROJECTS/ACTIVE/project-working-time.md`, "Future
roadmap ideas" #1, captured 2026-07-29. CPC Training (backlog idea #2)
is explicitly out of scope for this document — Alex chose to scope
Vehicle Check first, CPC Training stays parked.

Grounded in the current codebase: `src/domain/types.js`,
`docs/ARCHITECTURE.md`'s ownership rules, and the Part 4 build pattern
(`organisationService`/`siteService`/`driverService` + matching
`views/management/*App.jsx` CRUD screens, one workspace-scoped entity
at a time, each stage stopped for explicit sign-off).

---

## 0. TL;DR

A new, workspace-scoped domain slice — `Vehicle`, `ChecklistTemplate`,
`VehicleCheck`, `Defect` — added alongside the existing
Organisation/Site/RateCard/Shift model, following the exact same
ownership convention (owning `workspaceId`, `driverId` as the
cross-workspace "my history" key, snapshot-not-live-reference for
anything that must stay historically accurate). No backend, no new
storage mechanism — same `Repository`/IndexedDB stack, new migration
009+.

Four staged sub-phases, mirroring Part 4's 4A–4E pattern, each stopped
for review:

- **VC-1**: `Vehicle` + `ChecklistTemplate` domain + company-side CRUD
  (mirrors Stage 4A/4B).
- **VC-2**: `VehicleCheck` submission flow — driver-side "Vehicle
  Check" screen, walks the active checklist, saves a snapshotted
  result (mirrors Stage 4C/4D's driver-facing work, but this is new UI
  surface, not a management screen).
- **VC-3**: `Defect` creation + status workflow, auto-raised from
  failed check items, company-side defect list.
- **VC-4 (proposed deferred, see §5)**: photo/evidence attachment —
  blocked on a storage decision this app doesn't have yet.

Five scope calls I made unilaterally to keep this proposable in one
document — flagged in §6 for you to confirm or override before I build
anything.

---

## 1. Why this needs its own proposal, not just "add some CRUD"

Part 4 (4A–4D) added CRUD around entities that already existed
conceptually (Organisations, Sites, Rate Cards, Drivers, Engagements) —
the domain modeling was mostly already decided by the V1 refactor. This
module introduces genuinely new domain concepts with no existing
analog:

- A **vehicle** isn't a workspace, person, or organisation — and
  `docs/ARCHITECTURE.md` §"What's intentionally NOT built yet"
  currently lists "Fleet management (vehicles, trailers)" as an
  explicit non-goal. This proposal deliberately narrows that: a
  `Vehicle` row here is a check-target *identity* (reg plate, type),
  not fleet operations (scheduling, allocation, maintenance history,
  MOT/tax tracking). That line needs to be drawn on purpose, not
  discovered mid-build — see §6.1.
- A **checklist** is configurable *and* needs to be provably unchanged
  for any given historical check — the same "don't let a live-mutable
  config silently rewrite history" problem RateCard already solved for
  pay. §2.2 proposes reusing that exact pattern.
- A **defect** has a lifecycle (open → resolved) that doesn't map onto
  any existing entity's shape (Engagement/Assignment/Placement are all
  "active until ended," never multi-state).

## 2. Proposed domain model additions

All new entities follow the existing conventions: `workspaceId` on the
owning row, JSDoc-only typedefs in `src/domain/types.js`, no schema
enforcement beyond migrations.

### 2.1 `Vehicle`

```js
/**
 * A check-target identity, not a fleet-management record — no
 * scheduling, allocation, or maintenance history (see
 * docs/ARCHITECTURE.md's "NOT built yet" list, narrowed by this
 * module, not removed from it). Owned by the agency/transport_company
 * workspace that operates it, same convention as Site/Organisation.
 * @typedef {Object} Vehicle
 * @property {string} id
 * @property {string} workspaceId
 * @property {string} registration
 * @property {'rigid'|'tractor_unit'|'trailer'|'van'|'other'} vehicleType
 * @property {string|null} make
 * @property {string|null} model
 * @property {string|null} notes
 * @property {string|null} archivedAt
 * @property {string} createdAt
 */
```

### 2.2 `ChecklistTemplate` (mutable config, never referenced live from a completed check)

```js
/**
 * The configurable set of check items a workspace uses for its daily
 * walkaround. Mutable — editing it must NEVER change what a past
 * VehicleCheck recorded (see VehicleCheck.items below, which
 * snapshots this at submission time — the same "pin at creation"
 * pattern RateCard/Shift.rateCardId already established for pay).
 * @typedef {Object} ChecklistTemplate
 * @property {string} id
 * @property {string} workspaceId
 * @property {string} name
 * @property {{code: string, label: string, category: string}[]} items - ordered; `code` is stable across edits so historical Defect rows can still reference "which item," `label`/`category`/order may change freely
 * @property {boolean} isDefault - the template a new VehicleCheck defaults to when a workspace has more than one
 * @property {string|null} archivedAt
 * @property {string} createdAt
 */
```

Seeding: ship one platform-level DVSA-style default template (mirrors
`ComplianceProfile`'s `scope: 'default'` pattern) that a migration
copies into each existing workspace on upgrade — a real starting point
instead of an empty list, editable per-workspace afterward.

### 2.3 `VehicleCheck`

```js
/**
 * A completed (or in-progress — see §6.3) daily walkaround. `items` is
 * a SNAPSHOT copied from the active ChecklistTemplate at creation, not
 * a live reference — editing the template afterward must never change
 * what a past check recorded. workspaceId is the OWNING workspace
 * (Vehicle's workspace); driverId is the cross-workspace "my check
 * history" key, exactly mirroring Shift's workspaceId/driverId split.
 * @typedef {Object} VehicleCheck
 * @property {string} id
 * @property {string} workspaceId
 * @property {string} driverId - == Person.id
 * @property {string} vehicleId
 * @property {string|null} shiftId - optional link to the Shift this check was performed for
 * @property {string} checklistTemplateId - which template was snapshotted (for audit trail, not for re-resolving items)
 * @property {{code: string, label: string, category: string, result: 'ok'|'defect'|'not_applicable', notes: string|null}[]} items - snapshot, see above
 * @property {'ok'|'defects_found'} overallResult - derived at save time from items, stored (not recomputed live) for the same reason rateCardId is pinned
 * @property {number|null} odometerReading
 * @property {string} performedAt - ISO timestamp
 * @property {string} driverSignOffName - free-text confirmation, NOT a real e-signature (no signature-capture UI in v1)
 * @property {string} createdAt
 */
```

### 2.4 `Defect`

```js
/**
 * A vehicle defect — auto-created from a failed VehicleCheck item, or
 * raised standalone (e.g. noticed mid-shift, not during a formal
 * check). Owned by the same workspace as its Vehicle. Status workflow
 * is linear, no "reactivate" (mirrors Assignment's no-reactivate
 * rule) — a recurring issue after "resolved" is a new Defect row, so
 * history stays unambiguous.
 * @typedef {Object} Defect
 * @property {string} id
 * @property {string} workspaceId
 * @property {string} vehicleId
 * @property {string|null} raisedFromCheckId - the VehicleCheck this came from, null if raised standalone
 * @property {string|null} raisedFromItemCode - which checklist item, if from a check
 * @property {string} raisedByDriverId
 * @property {'minor'|'major'|'dangerous'} severity
 * @property {string} description
 * @property {'open'|'reported'|'in_progress'|'resolved'} status
 * @property {string|null} resolvedAt
 * @property {string|null} resolvedNotes
 * @property {string} createdAt
 */
```

## 3. Ownership rules (addition to `docs/ARCHITECTURE.md`)

- **`agency`/`transport_company` workspace** additionally owns: its
  `Vehicle`s, `ChecklistTemplate`s, every `VehicleCheck` and `Defect`
  whose `workspaceId` points to it — same rule already stated for
  Sites/RateCards/Shifts, just extended to the new collections.
- **`personal` workspace**: a true solo/owner-operator driver could
  still own their own `Vehicle` in their personal workspace (same as
  personal-workspace self-rate `RateCard`s today) — not blocking Alex
  specifically (he drives Example Logistics/Example Driver Agency's vehicle, not his own),
  but keeps the model consistent for future solo owner-operator users.
- **No-duplication rule extends unchanged**: `listVehicleChecksForDriver(driverId)`
  (cross-workspace, "my history") and `listVehicleChecksForWorkspace(workspaceId)`
  (company view) read the same `vehicleChecks` collection, exactly like
  `shiftService`'s two list functions today.

## 4. Staged build plan

Same per-stage stop-and-report pattern as Part 4 (4A–4E) — I build one
stage, report, wait for the next go-ahead.

| Stage | Scope | Mirrors |
|---|---|---|
| VC-1 | `Vehicle` + `ChecklistTemplate` domain, migration 009 (schema + seeded default template), company-side CRUD screens (`VehiclesApp`, `ChecklistTemplatesApp`) | Stage 4A/4B |
| VC-2 | `VehicleCheck` submission — new driver-side "Vehicle Check" nav item/screen: pick vehicle, walk the active template's items, flag defects, sign off, save | New surface, no direct Part-4 analog |
| VC-3 | `Defect` domain + auto-raise from failed items + status workflow + company-side defect list/dashboard | New surface |
| VC-4 | Photo/evidence attachment — **proposed deferred**, see §5/§6.5 | — |

Each stage gets its own tests (unit + `App.smoke.test.jsx` end-to-end,
same standard as Stage 4E) and a build+browser smoke check before I
report it done.

## 5. What I'm proposing to explicitly defer

- **Photo/evidence attachment (VC-4)**: the backlog note lists this as
  in-scope, but this app has no blob/document storage layer yet — the
  D1–D9 persistence decision explicitly deferred "document storage."
  IndexedDB *can* store `Blob`s client-side without a backend, so this
  isn't blocked forever, but it's a real storage-strategy decision
  (size limits, export/import JSON compatibility — a `Blob` doesn't
  round-trip through the existing JSON export cleanly) that deserves
  its own short proposal once VC-1–VC-3 are stable, not a rushed
  bolt-on now.
- **Fleet operations** (scheduling which driver gets which vehicle,
  maintenance/MOT/tax tracking) — stays out of scope per
  `docs/ARCHITECTURE.md`; `Vehicle` here is identity-only.
- **Draft/in-progress checks** (save partway through, resume later) —
  v1 assumes a check is completed in one sitting, like Add Shift today.

## 6. Scope calls I made unilaterally — please confirm or override

1. **Vehicle ownership**: company/agency workspace, not tied to a
   specific `Assignment`/`Placement`. Any driver with an active
   Assignment in that workspace can check any of that workspace's
   vehicles. Alternative: scope vehicles to a `Site` (a depot's
   vehicles) — more realistic but adds a dependency I don't think is
   needed for v1.
2. **Trailers**: modeled as a `Vehicle` row with `vehicleType:
   'trailer'`, checked via a separate `VehicleCheck` rather than a
   paired tractor+trailer check in one submission. Simpler, but means
   an artic driver logs two checks. Real DVSA walkarounds often treat
   unit+trailer as one combined check — I can add a `pairedVehicleId`
   on `VehicleCheck` in a later stage if this friction turns out to
   matter in practice.
   **Resolved 2026-08-04**: it did — see
   [[decision-2026-08-04-working-time-owner-operator-architecture]].
   `VehicleCheck.pairedVehicleId` now exists, with full per-item
   `vehicleId` attribution on each checklist item so defects raise
   against the correct physical vehicle.
3. **Checklist template default**: one seeded DVSA-style default
   per-workspace, editable afterward — not a fully blank slate. I'll
   draft the actual default item list (tyres, lights, mirrors, brakes,
   coupling, etc.) as part of VC-1's implementation, referencing the
   `Driver_Checks` project mentioned in the backlog note for scope,
   not as a code dependency.
4. **No real e-signature** — `driverSignOffName` is a typed
   confirmation + timestamp, not a captured signature image. Consistent
   with this app having no signature-capture UI anywhere else.
5. **Photo/evidence deferred to its own later proposal (§5)** rather
   than attempted in v1 — biggest scope cut from the original backlog
   note, flagging it clearly since "defect reporting... photo/evidence
   attachment" was listed together in the original idea.

## 7. Migration impact

New migration `009_add_vehicle_check_module.js`: creates
`vehicles`/`checklistTemplates`/`vehicleChecks`/`defects` stores
(IndexedDB object stores, same pattern as migration 005's
`rateCardLineages` addition) and seeds the default `ChecklistTemplate`
into every existing workspace. No changes to any existing collection —
this is purely additive, same low-risk shape as 005/008 were for their
respective additions.

## 8. UI impact

- **Driver side** (`DriverApp`-equivalent, likely its own
  `VehicleCheckApp` view rather than another tab inside `DriverApp`
  given it's a genuinely separate flow, not a variant of Add Shift): a
  new sidebar/bottom-nav entry, a vehicle picker, a checklist walk-
  through (pass/defect/n-a per item + optional note), sign-off, save —
  then a check history list (mirrors Shift history).
- **Company side**: `VehiclesApp`/`ChecklistTemplatesApp` (Part-4-style
  CRUD, VC-1) and a defects list/dashboard (VC-3), added to the
  existing `views/management/` pattern and the shell's company nav
  group.
- i18n: new `vehicleCheck` translation namespace (en-GB + pl-PL),
  following the existing per-namespace locale file convention.
