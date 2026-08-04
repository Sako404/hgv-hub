# HGV HUB — CPC Training Tracking: Architecture Proposal

Status: **Approved 2026-08-04**, with one refinement made during review:
Alex chose the real DVSA fixed 5-year cycle over the originally
proposed rolling-window simplification (§2.2 rewritten below to match,
deriving the cycle from the existing `cpc_card` `DriverDocument`
instead of asking for a new setup field), and asked for CPC-1 and
CPC-2 to both be built in this pass rather than staged separately. See
[[decision-2026-08-04-working-time-cpc-training-architecture]].
Backlog origin: `30_PROJECTS/ACTIVE/project-working-time.md`, "Future
roadmap ideas" #2. Alex's explicit steering for this proposal: **the
check-off action itself must be easier and faster** than a full
course-management system — this shapes every design call below.

## 0. TL;DR

One entity, one number, one big button. A driver logs a completed CPC
training session in two required fields (date + hours) and sees one
rolling "hours toward the 35-hour/5-year requirement" status — same
visual idiom as the Documents tile shipped this session. No course
catalogue, no certificates, no company-wide dashboard in v1. Staged as
**CPC-1** (this proposal, driver-only) → an optional **CPC-2**
(company-side read-only view, same treatment Documents just got in
DE-2) only if Alex wants it afterward.

## 1. Why "easier and faster" drives every call here

The original backlog note (captured 2026-08-03) sketched a much bigger
surface: "training history, course/session records, ... certificates/
evidence, expiry/renewal awareness, reminders, a driver personal CPC
dashboard, company-wide CPC status ... eventual training/course
management." Alex's instruction today cuts that down on purpose: the
real-world pain point is remembering to log a training day at all, not
managing a catalogue of courses. So v1 is deliberately the smallest
useful shape — one form, two required fields — not a scaled-down
version of the bigger idea.

## 2. Proposed domain model

### 2.1 `CpcTrainingRecord`

```js
/**
 * One completed CPC training session, logged by the driver. PERSON-
 * scoped, no workspaceId — same reasoning as DriverDocument (see
 * decision-2026-08-04-working-time-driver-document-expiry-architecture):
 * a driver's training hours follow them across employers, not any one
 * agency. Deliberately minimal — `date` and `hours` are the only
 * required fields, so logging one takes seconds, not a form.
 * @typedef {Object} CpcTrainingRecord
 * @property {string} id
 * @property {string} personId
 * @property {string} date - "YYYY-MM-DD", the day the session was completed
 * @property {number} hours - typically 7 (one DVSA training day), but any positive value is accepted (half-day/partial modules exist)
 * @property {string|null} provider - optional, e.g. "DVSA-approved training co. name" — record-keeping only, never validated
 * @property {string|null} notes
 * @property {string} createdAt
 */
```

No `documentType`, no status field, no archive/edit-history machinery
like `DriverDocument` — a training record is a plain fact, logged once;
if a driver mis-logs one, plain delete is enough (no compliance-history
concern the way a licence's expiry date has).

### 2.2 Status — the real fixed DVSA cycle, derived from the existing `cpc_card` document

**Revised during review** — Alex chose the legally accurate fixed
5-year cycle over the rolling-window simplification originally
proposed. The naive way to model a fixed cycle is a new "cycle start
date" setup field, which reintroduces the friction this proposal
otherwise avoids. Instead: this app already has a `DriverDocument` with
`documentType: 'cpc_card'` (shipped this session, DE-1) — and a real
DQC's own expiry date **is** the end of the driver's current 5-year
training cycle (DVSA re-issues the card each time the periodic
requirement is met). So the cycle needs **no new field at all**:

- `cycleEndDate` = the driver's active `cpc_card` `DriverDocument.expiryDate`.
- `cycleStartDate` = `cycleEndDate` minus 5 years (plain date arithmetic,
  not stored).
- `hoursCompleted` = sum of `CpcTrainingRecord.hours` where `date` falls
  within `[cycleStartDate, cycleEndDate]`.
- No active `cpc_card` document, or one with no `expiryDate` set →
  `status: 'unknown_cycle'`, prompting the driver to add/confirm their
  CPC card under Documents first — a genuine cross-feature dependency
  on DE-1, not a duplicated field.

```js
// status: 'ok' (hoursCompleted >= 35) | 'warning' (< 35, cycle still open)
//       | 'problem' (< 35, cycleEndDate has passed) | 'unknown_cycle' (no cpc_card expiryDate to anchor on)
resolveCpcCycleStatus(cpcCardDocument, trainingRecords, today)
  -> { cycleStartDate, cycleEndDate, hoursCompleted, hoursRequired: 35, status }
```

Same three/four-bucket shape `ComplianceStatusCard`/`DocumentStatusBadge`
already render — no new visual component needed.

## 3. UI — CPC-1 (driver) + CPC-2 (company), both built this pass

- New "CPC Training" nav item (Driver group, alongside Documents/
  Workplaces).
- Screen: a list of logged sessions (date, hours, provider if given) +
  one prominent "Log Training" action opening a 2-field form (date
  defaults to today, hours defaults to 7 — the common case needs zero
  typing beyond tapping Save). Provider/notes collapsed as optional.
- Dashboard gains a sixth status tile (Hours/Driving/Expected gross/
  Documents/**CPC Training**), reusing `ComplianceStatusCard` exactly
  like the Documents tile does today — including an honest "add your
  CPC card under Documents first" message for the `unknown_cycle` state.
- `DriverDrilldown` (CPC-2, same treatment DE-2 gave Documents) gets a
  read-only "CPC Training" section: cycle progress + the session list,
  no logging controls — a company may only ever read.
- i18n: new `cpcTraining` namespace, en-GB + pl-PL.

## 4. What's still explicitly deferred

- **Course/certificate management, provider catalogue** — explicitly
  out of scope, per §1.
- **Certificate/evidence upload** — same storage-strategy blocker as
  Vehicle Check's VC-4 and the Documents proposal's deferred
  scan/photo idea; no blob storage layer exists yet.
- **Reminders/push notifications** — already deferred platform-wide.
- **Company-wide "who's behind on CPC hours" roll-up across every
  driver at once** — that's Transport Manager territory (backlog idea
  #4); CPC-2 gives a company the per-driver drilldown view only.
- **A driver with an already-lapsed cycle and no `cpc_card` document
  at all** resolves to `unknown_cycle` rather than guessing a cycle —
  correct default, not a gap.

## 5. Scope calls — approved

1. **Fixed DVSA cycle derived from the existing `cpc_card`
   `DriverDocument`** (§2.2, revised from the original rolling-window
   proposal) — approved.
2. **`personId`-scoped, no `workspaceId`** — consistent with
   `DriverDocument` — approved.
3. **Two required fields only (date + hours)**, everything else
   optional — approved, the core "faster" ask.
4. **Both CPC-1 and CPC-2 built in this pass** (revised from
   originally proposing to stage them separately) — approved.

## 6. Migration impact

New migration `013_add_cpc_training.js`: adds the `cpcTrainingRecords`
IndexedDB store (DB_VERSION 7). No backfill — nothing in this app has
ever captured training data before.
