# HGV HUB — Owner-Operator (Solo TM) Enablement: Architecture Proposal

Status: **Partially approved 2026-08-04** — see
[[decision-2026-08-04-working-time-owner-operator-architecture]]. Only
§3 (tractor+trailer paired Vehicle Check) is approved to build now.
§2 (personal-workspace Transport Manager access) is **deferred**, not
rejected: mid-review, Alex clarified Janek's actual arrangement —
he pays a genuinely **separate, external** Transport Manager (a
different real person on a different device), not himself. This app
has no backend/sync yet, so a `Membership` role granted in Janek's own
local IndexedDB is invisible to anyone not physically using Janek's own
device — building §2 now would produce a feature that mostly doesn't
work for the actual arrangement it was meant to serve. Alex chose to
wait for the already-queued backend/auth phase rather than build a
workaround now (the existing export/import-JSON flow remains available
as a manual, snapshot-based stopgap in the meantime, not something new
built for this). Prompted by a concrete real scenario ("Janek": a
one-person company running one tractor unit + one trailer on
subcontract per-load work for Amazon). Grounded in an investigation of
the actual current code, not assumption — see §1.

## 0. TL;DR

Most of a solo owner-operator's needs already work today: per-load pay
(built with an Amazon Relay example), the personal-workspace
`Workplaces` self-service flow, and personal-workspace `Vehicle`
ownership (VC-1's solo-driver fix) all already let a driver with no
company run their own show. **What's missing, confirmed by
investigation:** (1) there is no path — anywhere in the app, not just
"not built for solo drivers" — for a `transport_manager`-role holder's
**personal** workspace to reach the Transport Manager dashboard, since
that screen is gated on `kind === "company"` and no real UI flow exists
to create a company-kind `Workspace` at all (only a dev seeder and the
legacy migration ever do); (2) a tractor+trailer combination still
requires two separate Vehicle Check submissions, a limitation VC-1's
own proposal already flagged as likely to matter once a real
artic-driving user existed — which it now does.

## 1. What the investigation confirmed (with citations)

- **No `createWorkspace` function exists anywhere in the codebase.**
  The only inserts into `kind: 'agency'`/`'transport_company'`
  `Workspace` rows are `seedSecondCompany.js` (explicitly a dev/test
  seeder) and the legacy Example Driver Agency migration. No view calls the
  seeder. **A real signed-in user cannot create their own company
  workspace today, at all.**
- **`driverService.createSoloWorkContext` never creates a Workspace** —
  every write it makes uses the caller's existing `workspaceId`
  verbatim, and its only caller (`WorkplacesApp.jsx`) always passes the
  driver's own personal workspace. It was built to let a solo driver
  set up a rate card/work context WITHOUT needing a company workspace —
  exactly the right shape for "I log my own shifts," but it structurally
  cannot produce something the Transport Manager screen will render for.
- **The gate is unconditional on workspace kind**:
  `AppShell.jsx`'s `isTransportManager` check requires
  `activeView?.kind === "company"` — and a personal workspace is always
  surfaced as `kind: "driver"` in the `views` array, never `"company"`,
  regardless of what roles its own `Membership` row carries. Even if a
  `transport_manager` role were added to a personal workspace's
  `Membership.roles` (nothing in the schema forbids it), the screen has
  no way to render from that context today.
- **`Vehicle` ownership by a personal workspace already works** — the
  VC-1 solo-driver fix already routes `VehiclesApp`/`ChecklistTemplatesApp`
  at `session.personalWorkspace.id` for exactly this reason (a true
  solo driver has no company workspace to manage vehicles through). This
  precedent is directly reusable for the TM dashboard.
- **Trailer pairing**: confirmed still absent.
  `docs/VEHICLE_CHECK_ARCHITECTURE_PROPOSAL.md` already named this
  exact tradeoff: *"Trailers modeled as a separate `Vehicle` row...
  checked via a separate `VehicleCheck`... I can add a `pairedVehicleId`
  on `VehicleCheck` in a later stage if this friction turns out to
  matter in practice."* It now does.

## 2. Proposed fix #1 — let a personal workspace's own TM role reach the dashboard (DEFERRED, see Status)

Rather than building a whole "create your own company" flow (a bigger,
more disruptive change — it would mean migrating a solo driver's
existing Organisation/Site/RateCard/Engagement/Assignment data out of
their personal workspace into a new one, or duplicating the pattern),
extend the existing "personal workspace acting as its own tiny company"
precedent (already established for self-rate `RateCard`s and VC-1's
solo `Vehicle` ownership) to the Transport Manager screen too:

- `resolveSession()` (`workspaceService.js`) starts also returning the
  person's own **personal workspace `Membership.roles`** (currently
  discarded — only the `Workspace` object is kept), so the app can know
  whether *this* person holds `transport_manager` in their own personal
  workspace, not just in company workspaces.
- A new self-service toggle in `WorkplacesApp` (or a small new
  "Am I my own Transport Manager?" control near it) lets a solo driver
  add `transport_manager` to their own personal-workspace `Membership` —
  the same "declare a fact about your own work context" spirit
  `createSoloWorkContext`/`setPreferredAssignment` already have.
- `AppShell`'s `isTransportManager` gate is extended: true when
  `activeView.kind === "company" && roles.includes('transport_manager')`
  **OR** `activeView.kind === "driver" && session.personalWorkspaceRoles.includes('transport_manager')`.
  When true from a personal-workspace context, the TM dashboard renders
  with `workspace = session.personalWorkspace` — no other change needed:
  `resolveTransportManagerDashboardData`/`resolveTransportManagerWorkspaces`
  already work generically over whatever `workspaceId` they're given
  (confirmed — they don't special-case workspace `kind` anywhere), so
  Janek's own `Vehicle`s and his own `driver`-role membership (himself)
  already roll up correctly with zero service-layer changes.

This is a small, additive change reusing an established precedent —
not a new "company creation" subsystem.

## 3. Approved fix — tractor+trailer paired Vehicle Check, full per-item defect attribution

`VehicleCheck` gains an optional `pairedVehicleId` (the trailer, when
the primary `vehicleId` is a `tractor_unit`, or vice versa) — a single
submission covers both. **Alex chose full per-item vehicle
attribution** over the simpler "all defects against the primary
vehicle" default — so each checklist item's result needs to know which
physical vehicle it was actually checked against, not just the
submission as a whole.

Design (minimal structural change, no `ChecklistTemplate` schema
change needed): when a check is paired, the driver walks the SAME
shared checklist **twice** — once framed as "Tractor unit," once as
"Trailer" — rather than inventing a way to mark individual template
items as tractor-only/trailer-only/shared (the current default
templates mix categories like "Tyres & wheels"/"Lights" that
legitimately apply to both halves of an artic, so a single flat
per-item tagging scheme wouldn't cleanly resolve which items need
duplicating anyway). Concretely:

- `VehicleCheck.items[].vehicleId` (new field) — every item result now
  carries which physical vehicle it belongs to. For a normal
  (non-paired) check this is always `VehicleCheck.vehicleId` (set
  automatically, invisible to the driver — no behaviour change for the
  common case). For a paired check it's `vehicleId` for the tractor
  pass's items and `pairedVehicleId` for the trailer pass's items.
- `defectService.raiseDefectsFromVehicleCheck` reads each failed item's
  own `item.vehicleId` (not always `check.vehicleId`) when creating its
  `Defect` — so a trailer light failure now genuinely raises a defect
  against the trailer's own `Vehicle` row, not the tractor's.
- `VehicleCheckApp`: when the chosen vehicle is a `tractor_unit`, an
  optional "+ pair a trailer" step lists the driver's other available
  `trailer`-type vehicles; once paired, the walkthrough presents two
  clearly-labelled passes over the same checklist (Tractor unit →
  Trailer) before sign-off, one submission at the end.
- Check History / `DefectsApp`: unaffected in shape — a paired check's
  defects simply show up correctly split across the tractor's and
  trailer's own defect lists, same rendering code as today.

## 4. Scope calls — please confirm or override

1. **Extend the personal-workspace pattern (§2) rather than building a
   real "create your own company" flow.** Recommended — smaller, reuses
   precedent, and a full company-creation flow is a materially bigger
   change (data migration story, a "which kind of business are you"
   onboarding flow) that nothing today actually needs yet.
2. **Trailer defects all attribute to the primary (tractor) vehicle**,
   not split per-item between tractor/trailer. Recommended for v1 —
   avoids adding per-checklist-item vehicle attribution, a bigger
   change than the pairing friction itself warrants.
3. **Self-declared TM status** (a driver can mark themselves as their
   own personal workspace's Transport Manager via a toggle, no
   verification) — consistent with this app's existing stance (roles
   are modeled/stored, never enforced/verified; see
   `docs/ARCHITECTURE.md`'s "NOT built yet" list). Flagging since it's
   a slightly more consequential self-declaration than most existing
   toggles (it's a real named legal duty), but the app has no
   mechanism anywhere to verify any qualification claim, so treating
   this one differently would be inconsistent.

## 5. Out of scope (separate, non-architectural)

**Hosting/distribution** (so Janek can actually reach the app without
running it locally) is not an architecture question — `npm run build`
already produces a static `dist/`; this is a deployment/hosting task
(e.g. serving it from TrueNAS via nginx, as already floated) that can
happen once the code above ships, no proposal/approval cycle needed for
that step itself.
