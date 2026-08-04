# HGV HUB — In-App Reminders: Architecture Proposal

Status: **Approved 2026-08-04**, both scope calls confirmed as
recommended. See
[[decision-2026-08-04-working-time-reminders-architecture]]. Backlog
origin: this session's gap analysis ("what's needed for a full HUB"),
narrowed from "push notifications/alerts" (already listed as
deferred platform-wide in `docs/ARCHITECTURE.md`) to something
buildable without a backend.

## 0. TL;DR

True push notifications (working while the app/browser is closed)
need a server to trigger sends at arbitrary times — exactly the
backend phase just queued without a timeline. What's buildable today:
a prominent, unmissable **in-app reminder banner** on the two screens
that are already the default landing point after opening the app
(driver Dashboard, company Transport Manager dashboard), surfacing
anything `expired`/`problem` or `expiring_soon`/`warning` across
Documents, CPC training, and (TM-side) vehicle roadworthiness/defects
— all derived from statuses this app already computes, no new data
capture.

## 1. Scope calls — decided

1. **Lives only on Dashboard + Transport Manager screens**, not a new
   app-wide mechanism in `AppShell`. Both are already the default
   landing screen after opening the app (`driverTab` always resets to
   `"week"`; the TM dashboard is one click from the company switcher),
   so this is genuinely "seen on open" without a new cross-cutting
   aggregation layer computed for every user on every load.
2. **Both severity tiers shown** — `expired`/`problem` (red) and
   `expiring_soon`/`warning` (amber), not just the urgent tier — same
   two-tier distinction the Dashboard's existing status tiles already
   use.

## 2. Design

Pure, testable derivation — no new data capture, no i18n inside the
engine (translated in the view layer, same split every other engine in
this app already uses):

- `reminderEngine.resolveDriverReminders(driverDocuments, cpcCycleStatus, today)`
  → one entry per active `DriverDocument` that's `expired`/`expiring_soon`
  (reusing `documentExpiryEngine.resolveDocumentStatus`), plus one entry
  if the CPC cycle is `problem`/`warning`. `unknown_cycle` deliberately
  excluded — that's a setup nudge (already shown on the tile itself),
  not an urgent reminder.
- `reminderEngine.resolveTransportManagerReminders(drivers, vehicles, externalTmLimitStatus)`
  → one entry per driver with `hoursStatus === 'problem'`,
  `documentStatus` expired/expiring, or `cpcCycleStatus` problem/warning;
  one entry per vehicle with `motStatus`/`insuranceStatus`
  expired/expiring or an open dangerous defect; one entry if the
  external-TM limit is exceeded (folding the dashboard's existing
  standalone limit banner into the same unified list instead of two
  separate banner components).

A new shared `ReminderBanner` component (`views/shared/atoms.jsx`)
renders a list of `{severity, message}` rows (message pre-translated,
same convention `ComplianceStatusCard` already uses) — reused by both
screens.

## 3. What this doesn't touch

- The existing driving-hours compliance alert block on the Dashboard
  (`compliance.alerts`) is untouched — it's already its own visible
  mechanism; this proposal only covers the two newer areas (Documents,
  CPC) that currently have no proactive alert, only a passive tile.
- No dismiss/mark-as-seen state persisted anywhere — the banner is a
  pure render of current status, reappears next load if the underlying
  condition is still true. No new storage.
- No push, no service worker, no background sync — genuinely
  impossible to do reliably without a backend; not attempted.
