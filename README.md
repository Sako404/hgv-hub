# HGV HUB

A working-time, pay, and EU/tachograph compliance tracking platform
for HGV drivers — built to serve an independent driver and an agency/
transport company on one shared data model (a shift exists once; the
driver view and the company view are different queries over the same
record). See `docs/ARCHITECTURE.md` for the full domain model
(Workspace/Person/Membership/Organisation/Engagement/Assignment/Shift/
RateCard/ComplianceProfile) and its data-ownership rules.

## Features

- **Hours & pay**: hourly rate cards (Days/Lates/Nights × Mon–Thu/Fri/
  Sat/Sun, base + holiday), per-load pay for spot-booked work, a
  midnight-crossing shift-splitting engine, payslip check, and shift
  history with edit/delete/export/import (JSON).
- **EU/tachograph compliance**: extended driving, reduced rest, long
  shifts, hard daily/weekly/two-week limits — rules configurable per
  driver, never per company.
- **Vehicle Check / daily walkaround**: configurable checklist
  templates, paired tractor+trailer checks with per-item defect
  attribution, and a defect status workflow.
- **Driver document expiry tracking**: driving licence, tachograph
  card, CPC card, with a warning window before each lapses.
- **CPC training log**: tracks the 35-hour/5-year Driver CPC training
  cycle, derived from the driver's own CPC card expiry date.
- **Transport Manager dashboard**: a compliance roll-up for the named
  UK O-licence Transport Manager role — driver hours/CPC/document
  status, vehicle roadworthiness, and the regulatory checks from the
  Senior Traffic Commissioner's Statutory Document No. 3.
- **In-app reminders**: a banner surfacing anything expired or about
  to expire, on both the driver and Transport Manager dashboards.
- Fully bilingual (English UK default, Polish fully supported) — see
  Languages below.

## Two ways to run it

**Solo / local** — no server, no account, data stays in the browser's
own IndexedDB on that one device:

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173` (or a LAN address with `--host`, so
it's reachable from a phone on the same network). `npm run build`
produces a static `dist/` you can serve with any static file server.

**Self-hosted, multi-device** — a real Fastify + PostgreSQL backend
with proper accounts (email/password, Argon2id, server-side sessions),
packaged for Docker Compose:

```bash
cp .env.example .env   # edit it first — see docs/BACKEND_SELF_HOSTING.md
docker compose up -d --build
```

See `docs/BACKEND_SELF_HOSTING.md` for the full setup, backup, and
upgrade guide. Both modes share the exact same client code — a
`Repository` interface abstracts local IndexedDB vs. the backend API,
so nothing in the UI or business logic differs between them.

## Languages

- **English (UK)** — default, canonical product language.
- **Polish** — fully supported second language.

English is always the language for a first launch, regardless of the
browser/OS locale — the app never auto-switches to Polish just because
the system is set to Polish. A user's explicit language choice is
persisted locally (via `src/settings/appSettings.js`, a small
localStorage-backed key/value store separate from the domain data) and
restored on the next visit, no reload needed to see it take effect.

Translation resources live under `src/i18n/locales/<locale>/`, split
by namespace (`common`, `driver`, `company`, `compliance`, `pay`,
`management`, `rateCards`, `placements`, `vehicleCheck`,
`driverDocument`, `cpcTraining`, `transportManager`, `reminders`,
`auth`) so no single file becomes a dumping ground.

UI localisation is strictly separated from business logic: the
compliance and pay engines (`src/services/complianceEngine.js`,
`payEngine.js`) never contain a hardcoded English or Polish string —
compliance alerts are returned as `{code, params}` (e.g.
`reducedRestBudgetExceeded`), and only the UI layer turns a code into
a sentence via `t('compliance:alerts.<code>', params)`. Switching
language never changes a calculated number, a date's underlying
value, or any stored data — only how it's displayed. Currency is
always GBP in both languages (`Intl.NumberFormat` with
`currencyDisplay: "narrowSymbol"`); dates use
`Intl.DateTimeFormat`/`toLocaleDateString` with the active locale
(`en-GB` or `pl-PL`) and a 24-hour clock in both.

Data is never translated: organisation, site, and person names are
stored values, shown as-is regardless of UI language.

**Adding a future locale** means adding one more
`src/i18n/locales/<new-locale>/` directory with the same JSON files
and one entry in `SUPPORTED_LANGUAGES` (`src/i18n/index.js`) — no
component changes required, since every screen already reads strings
through `useTranslation()` rather than hardcoding them.

## Testing

```bash
npm test            # client — Vitest + jsdom + Testing Library
cd server && npm test   # server — Vitest, against a real local Postgres
```

Client tests cover the pay/compliance engines, migrations, the
storage layer, and full end-to-end renders of the whole app for key
scenarios (solo driver, workspace switching, company drill-down,
sidebar/drawer, and the complete i18n behaviour). Server tests run
against a real local Postgres (not an in-memory emulator) via
Fastify's `.inject()`.

## Project structure

```
working-time/
├── docs/
│   ├── ARCHITECTURE.md              ← data model, ownership rules, what's not built yet
│   └── BACKEND_SELF_HOSTING.md      ← Docker Compose setup/backup/upgrade guide
├── server/                          ← Fastify + Drizzle + Postgres backend (self-hosted mode)
├── docker-compose.yml, .env.example, Dockerfile.client
└── src/
    ├── domain/types.js              ← JSDoc typedefs for every entity
    ├── storage/                     ← Repository interface: IndexedDB, LocalStorage (test double), API (backend mode)
    ├── settings/appSettings.js      ← local app preferences (e.g. language), outside the domain model
    ├── i18n/                        ← i18next: locales/en-GB, locales/pl-PL
    ├── migrations/                  ← versioned IndexedDB schema/data migrations
    ├── services/                    ← pay engine, compliance engine, CRUD services, export/import
    ├── context/SessionContext.jsx   ← signed-in identity (local person-switch, or real auth in backend mode)
    ├── views/shell/                 ← AppShell: sidebar, mobile drawer, workspace switcher, auth gate
    ├── views/driver/                ← driver-facing screens
    ├── views/management/            ← company-facing CRUD + Transport Manager dashboard
    ├── views/company/               ← driver list + read-only drill-down
    ├── views/shared/                ← UI components shared across views
    ├── App.jsx                      ← root: I18nextProvider + SessionProvider + AppShell
    └── main.jsx
```

## What's not built yet

See `docs/ARCHITECTURE.md` for the full list — notably: fleet
management beyond identity/roadworthiness, jobs/loads marketplace,
invoicing/billing, real payroll integration, rota/timesheet approval,
and CSV/PDF export.
