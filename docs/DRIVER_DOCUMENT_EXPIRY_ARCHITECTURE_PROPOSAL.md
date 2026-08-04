# HGV HUB — Driver Document Expiry Tracking: Architecture Proposal

Status: **Approved 2026-08-04, all four scope calls (§6) confirmed
as-is.** DE-1 is cleared to start; DE-2 waits for DE-1's
stop-and-report. See
[[decision-2026-08-04-working-time-driver-document-expiry-architecture]].
This document is a proposal, following the same
propose-then-approve-then-build-in-stages process used for
[[decision-2026-08-03-working-time-vehicle-check-module-architecture]]
and [[decision-2026-08-03-working-time-per-load-pay-architecture]].
Backlog origin: `30_PROJECTS/ACTIVE/project-working-time.md`, "Future
roadmap ideas" #3, captured 2026-08-03. Distinct from backlog #2 (CPC
Training — course/training records, stays parked) and #4 (Transport
Manager — a future *consumer* of this data via a fleet-wide dashboard,
not part of this proposal).

Grounded in the current codebase: `src/domain/types.js`,
`docs/ARCHITECTURE.md`'s ownership rules, and the two prior new-module
proposals (Vehicle Check, Per-Load Pay) for staging/scope-flagging
style.

---

## 0. TL;DR

A new entity, `DriverDocument`, tracks expiry dates for a driver's own
legal documents — driving licence, digital tachograph card, CPC card,
plus an open-ended "other" type. Unlike every other new entity added so
far (Vehicle, ChecklistTemplate, Load, RateCardLineage — all
`workspaceId`-scoped), this one is **`personId`-scoped, not
workspace-scoped**: a driving licence doesn't belong to an employer, and
duplicating it per company workspace would mean re-entering (and
re-expiring) the same fact multiple times. This is the one real
domain-modeling decision this proposal has to make — see §1.

Status (OK / Expiring soon / Expired) is computed the same way
compliance status already is on the Dashboard — not a new visual
language, just a new source feeding the existing OK/Warning/Problem
idiom.

Two staged sub-phases:

- **DE-1**: `DriverDocument` domain + migration + driver-side CRUD
  screen + a Dashboard status tile.
- **DE-2**: surfaced read-only in the company-side `DriverDrilldown`,
  so a company can see (not edit) a driver's document status.

Four scope calls flagged in §6 for you to confirm or override before I
build anything.

---

## 1. Why this needs its own proposal, not just "add a Vehicle-Check-shaped CRUD"

Every entity added since the V1 refactor — `Vehicle`, `ChecklistTemplate`,
`VehicleCheck`, `Defect`, `Load`, `RateCardLineage`'s `payType` — follows
the same convention: **`workspaceId` on the owning row**, because they're
all things a workspace (an agency, a transport company, or a driver's own
personal workspace acting as its own tiny "company") configures or
records.

A driving licence isn't that. It's a fact about the *person*, true
regardless of which employer they're currently placed with, and it
doesn't change if the driver switches agencies mid-validity — which this
app already treats as a first-class case
([[decision-2026-07-28-working-time-shared-platform-direction]]:
"the driver keeps an independent personal workspace and history across
employer changes"). If `DriverDocument` were workspace-scoped like
everything else, either (a) it lives only in the driver's personal
workspace and no company workspace can ever see it, defeating the whole
point of an agency wanting to know a driver's licence hasn't lapsed, or
(b) it gets duplicated per company workspace, and now two copies of "my
CPC card expires 2027-03-14" can silently disagree.

So the proposal is: `DriverDocument` keys on `personId` directly — no
`workspaceId` at all — making it the **first entity in this app that
isn't workspace-owned**, alongside `Person` itself. Visibility for
companies is solved the same way company code already reads a driver's
`Person` record today: via an active `Membership`, not via
`workspaceId` ownership. See §3.

## 2. Proposed domain model addition

### 2.1 `DriverDocument`

```js
/** @typedef {'driving_licence'|'tacho_card'|'cpc_card'|'other'} DriverDocumentType */

/**
 * A driver's own legal document and its expiry date — driving licence,
 * digital tachograph card, CPC card, or an open-ended 'other'. Unlike
 * every other entity added since the V1 refactor, this is
 * PERSON-scoped, not workspace-scoped (see §1 of the architecture
 * proposal): the fact "my CPC card expires 2027-03-14" doesn't belong
 * to any one employer and must not be duplicated per company
 * workspace. Self-managed by the driver (driverDocumentService enforces
 * this — see §3); a company workspace may only ever READ these via an
 * active Membership, never write them.
 * @typedef {Object} DriverDocument
 * @property {string} id
 * @property {string} personId
 * @property {DriverDocumentType} documentType
 * @property {string|null} label - required and shown when documentType is 'other' (e.g. "ADR certificate"); ignored for the three named types, which get a fixed translated label
 * @property {string|null} referenceNumber - optional, e.g. licence number; record-keeping only, never validated against a real format
 * @property {string|null} expiryDate - "YYYY-MM-DD"; null means "tracked but no known expiry yet" (e.g. a new driver hasn't supplied the date), distinct from not having a DriverDocument row at all
 * @property {string|null} notes
 * @property {string|null} archivedAt - "no longer tracking this document" (e.g. a superseded licence number after renewal) — a renewal is a NEW row with a new expiryDate, the old one archived, not an in-place date edit, so history stays honest (same reasoning RateCard's append-only versioning and Assignment's no-reactivate rule already established elsewhere in this app)
 * @property {string} createdAt
 * @property {string} updatedAt
 */
```

### 2.2 Status computation (not a stored field — derived, like compliance status)

A pure function, `documentExpiryEngine.resolveDocumentStatus(document,
today, warningWindowDays)` → `'ok' | 'expiring_soon' | 'expired'` (plus
`'unknown'` when `expiryDate` is null). Deliberately NOT stored on the
row — recomputed on every read from `expiryDate` and "today," exactly
like `complianceEngine`'s alerts are recomputed from shift history
rather than cached, so a status is never stale just because nobody
happened to re-save the row on the day it tipped into "expiring soon."

A second pure function, `documentExpiryEngine.resolveDriverDocumentSummary(documents,
today, warningWindowDays)` → `'ok' | 'expiring_soon' | 'expired'` (the
worst status across the driver's active documents, `'ok'` if there are
none) feeds the Dashboard tile and the company drilldown badge — same
"roll several data points into one glanceable status" shape the
Dashboard's existing three compliance cards already use.

## 3. Ownership and access rules (addition to `docs/ARCHITECTURE.md`)

- **`DriverDocument` is owned by the `Person`, not any `Workspace`** —
  the first entity in this app with no `workspaceId`. Only
  `driverDocumentService` mutators, called only from the document owner's
  own driver-side screen, may write a row; there is no company-side
  create/edit/archive path at all in this proposal (see the scope call
  in §6.2 — this is a deliberate default I'm flagging, not an oversight).
- **Read access for companies**: any workspace where the driver holds an
  active (non-archived) `Membership` may read that driver's
  `DriverDocument` rows and derived status — resolved the same way
  `DriverDrilldown` already resolves "which driver am I even allowed to
  look at" today (via `Membership`, not a new ACL concept).
- **No-duplication rule, extended**: exactly one `listDriverDocuments(personId)`
  read path, used by both the driver's own screen and every company
  drilldown that can see this driver — never two copies of the same
  fact, mirroring `Shift`'s existing `driverId`-keyed no-duplication
  rule (`docs/ARCHITECTURE.md`) even though this entity has no
  `workspaceId` split to begin with.

## 4. Staged build plan

Same per-stage stop-and-report pattern as Part 4 and Vehicle Check — I
build one stage, report, wait for the next go-ahead.

| Stage | Scope | Mirrors |
|---|---|---|
| DE-1 | `DriverDocument` domain + migration 012 (new `driverDocuments` store, no seeding — nothing to seed, unlike Vehicle Check's default checklist) + `driverDocumentService` + driver-side CRUD screen (add/edit/renew-as-new-row/archive) + a Dashboard status tile (reusing the existing OK/Warning/Problem card idiom) | Stage 4A/4B's CRUD shape, VC-1's "new domain slice" shape |
| DE-2 | Read-only surfacing in company-side `DriverDrilldown` — a document-status section, same treatment as the Employment section Stage 4D added | Stage 4D's Employment section in `DriverDrilldown` |

Each stage gets its own tests (unit + an `App.smoke.test.jsx`
end-to-end case) and a build+browser smoke check before I report it
done.

## 5. What I'm proposing to explicitly defer

- **Push notifications / reminder emails** before a document lapses —
  already deferred platform-wide (`docs/ARCHITECTURE.md`'s "NOT built
  yet" list: "push notifications/alerts"). This proposal only adds the
  *status visibility* (Dashboard tile, drilldown badge), not any
  out-of-band reminder mechanism.
- **Document scan/photo upload** — same blocker VC-4 (Vehicle Check
  photo/evidence) was deferred for: no blob/document storage layer
  exists yet, and it's a real storage-strategy decision (size limits,
  JSON export/import compatibility) that deserves its own proposal, not
  a bolt-on here. `referenceNumber`/`notes` (free text) are the only
  record-keeping fields in this proposal.
- **Fleet-wide "which of my drivers has something expiring" dashboard**
  — that's backlog idea #4 (Transport Manager role/functionality),
  which explicitly consumes this data rather than duplicating it. DE-2
  gives a company the per-driver drilldown view only; a roll-up across
  every driver at once is out of scope here.
- **Company-initiated document records** (e.g. an agency wanting to log
  a document on a driver's behalf) — see the scope call in §6.2.

## 6. Scope calls I made unilaterally — please confirm or override

1. **`personId`-scoped, not `workspaceId`-scoped** — the central design
   choice in §1. Alternative: workspace-scoped like everything else,
   accepting the duplication-across-employers problem. I think
   person-scoped is clearly right given how this app already treats
   driver identity/history, but it's a first (no other entity skips
   `workspaceId`), so flagging it explicitly rather than assuming.
2. **Driver-only write access, companies read-only** — modeled after the
   real-world fact that a driving licence is the driver's own legal
   document, not something an agency issues or should be able to edit.
   Alternative: let a manager-tier role add/edit a document on a
   driver's behalf too (useful if a driver is slow to self-report, but
   opens "who's the source of truth if both can edit" and needs its own
   access-control thought). Defaulting to driver-only for v1.
3. **Warning window**: proposing a single hardcoded default (e.g. 30
   days = "expiring soon") rather than a configurable
   `ComplianceProfile`-style setting per driver/workspace, at least for
   DE-1. `ComplianceProfile` already establishes the
   platform-default-or-driver-scoped pattern if this needs to become
   configurable later — deferring that complexity unless you want it
   from day one.
4. **Renewal = new row, old one archived** (not an in-place date edit)
   — consistent with RateCard/Assignment's existing "don't silently
   rewrite history" conventions elsewhere in this app, but adds a small
   UX step (archive-then-recreate, or a single "renew" action that does
   both) compared to just editing a date in place. I'd build a one-click
   "Renew" action in DE-1 that does the archive+recreate atomically
   rather than making you do it as two separate steps.

## 7. Migration impact

New migration `012_add_driver_document_tracking.js`: creates a
`driverDocuments` IndexedDB object store (same additive pattern as
migration 009's four new stores), no backfill/seeding needed since
there's no existing collection this data was ever hiding in. No changes
to any existing collection.

## 8. UI impact

- **Driver side**: a new screen (exact nav placement TBD at
  implementation time — likely alongside "Workplaces" in a
  driver-facing group, since both are self-service/self-managed, not a
  "Vehicle Setup"-style config screen) listing the driver's own
  documents with status badges, add/edit/renew/archive actions.
  Dashboard gains a fourth status tile alongside the existing
  Hours/Driving/Expected-gross KPIs and three compliance cards — exact
  visual slot TBD at implementation time.
- **Company side**: `DriverDrilldown` gains a read-only "Documents"
  section (status badges only, no edit controls), same pattern as
  Stage 4D's Employment section.
- i18n: new `driverDocument` translation namespace (en-GB + pl-PL),
  following the existing per-namespace locale file convention.
