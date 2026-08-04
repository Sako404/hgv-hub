# HGV HUB — Data Ownership, Persistence & Deployment Architecture

Status: **Architecture decisions D1–D9 approved by Alex on 2026-07-28
(see §20).** Nothing in this file has been implemented yet — approval
covers *direction*, not code. Backend, authentication, documents, and
managed SaaS remain explicitly deferred; the immediate next phase is the
query-criteria refactor, IndexedDB migration, and the RateCard
versioning foundation, in that order, followed by CRUD modules. See the
project's task tracking for the concrete execution plan.

Grounded in the actual current codebase, not a fresh design: domain
model (`src/domain/types.js`), the existing `Repository`
(`src/storage/LocalStorageRepository.js`, `src/storage/db.js`), the
services layer, `docs/ARCHITECTURE.md`'s ownership rules, and
`src/settings/appSettings.js`.

---

## 0. TL;DR

The three-mode requirement (solo/local, self-hosted/company,
managed/future) from one codebase is achievable, and the proposed
layered shape (React/Vite → domain services → Repository abstraction →
Local or Api implementation) is **directionally correct and already
half-built** — the existing `Repository` interface
(`getById/getAll/query/insert/update/remove/replaceAll`) was designed
with exactly this swap in mind. It is **not** blindly acceptable as-is,
though: `query(predicate)` takes an opaque JS function, which cannot
survive a trip over HTTP. That single mismatch is the most important
finding in this document (§6) and should be fixed *before* any backend
work starts, not discovered mid-build.

Recommended stack — **approved**: **IndexedDB** (via the `idb`
micro-wrapper) for local structured data, **localStorage** demoted to
preferences-only, **PostgreSQL** for the server, **Node.js** with
**Fastify** and **Drizzle** for schema/migrations (keeps the pure
`payEngine.js`/`complianceEngine.js` modules reusable server-side
without a rewrite), packaged as a **Docker Compose modular monolith**
(web + api + postgres + volumes), no Kubernetes, no microservices, no
auth platform, no CRDT sync engine. Backend/Fastify/Drizzle
implementation is deferred until the backend phase; IndexedDB and the
query-criteria refactor (§5) proceed in the immediate next phase.

---

## 1. Evaluation of the proposed architecture

```
React/Vite/PWA → Domain/services → Repository abstraction → LocalRepository→IndexedDB
                                                            → ApiRepository→HTTP→PostgreSQL
```

**What's right:** the app already has this exact shape for the local
case. `storage/db.js` wires one generic `Repository` per collection over
an injectable storage backend; `services/` never touches
`localStorage`/IndexedDB/HTTP directly, only `db.<collection>`. That
discipline is *why* this proposal is achievable at all without a
rewrite — confirm and keep it.

**What's incomplete or wrong if accepted as-is:**

1. **`query(predicate)` cannot cross a network boundary.** Today,
   `db.shifts.query(s => s.driverId === personId)` passes a live JS
   closure. `LocalStorageRepository`/a future `IndexedDbRepository` can
   execute that in-process. An `ApiRepository` cannot serialize a
   function into an HTTP request. The only two honest options are (a)
   `ApiRepository.query()` fetches *every row* and filters client-side
   — defeats the purpose of a server, ships unrelated data over the
   wire, and is a real problem the moment a company workspace has more
   than a handful of shifts — or (b) the interface changes to a
   **serializable criteria object**. (b) is the only real answer; see
   §6.
2. **One global `db` singleton doesn't survive multi-backend
   workspaces.** `SessionContext.jsx` imports `db` from `storage/db.js`
   once and hands it to every screen via `useSession()`. The product
   requirement ("Alex Personal → local, Northline Transport Ltd → remote,
   same session") needs a *per-workspace* repository set, not one
   global one. This is a real, structural change to `SessionContext`,
   not just a new repository class — see §7.
3. **Cross-workspace aggregation becomes a fan-out, not a query.**
   `listShiftsForDriver(personId)` — the function that makes "no
   duplicated shift" work — currently does one `db.shifts.query(...)`
   call. If a driver's workspaces live on different physical backends
   (their own local IndexedDB *and* a company's remote Postgres), "all
   my shifts" is no longer one query. See §7 for the corrected design.
4. **Multi-repository writes need a transaction boundary the current
   Repository interface doesn't provide.** Creating an Engagement +
   Assignment today is two sequential `insert()` calls with no rollback
   if the second fails — invisible to notice on a single-tab
   localStorage app, a real correctness issue over a network to a
   shared Postgres instance. Don't build a general Unit-of-Work
   abstraction for this (over-engineering); expose specific compound
   operations as single backend endpoints instead (§6).

None of this invalidates the proposal — it corrects it before code is
written against it.

---

## 2. Local storage decision

**Move structured domain data off `localStorage`, onto IndexedDB.
Demote `localStorage` to lightweight preferences only**, exactly as the
task frames it. This is also mostly *already the direction the code is
quietly moving in* — `src/settings/appSettings.js` (language) and the
separate `wt-shell-sidebar-collapsed` key already keep UI preferences
out of the domain `Repository` layer; the fix is to finish that
separation, not invent it.

**Why not keep localStorage for domain data:** synchronous (blocks the
main thread on every read/write once shift history grows), ~5–10 MB
practical quota depending on browser, string-only (no real querying —
today's `query()` already does a full-array `.filter()`, which is fine
at solo-driver scale but won't be at a multi-driver company's *locally
cached* scale), and it's already carrying two unrelated
responsibilities (11 domain collections + ad hoc preference keys)
that should not share one storage class.

**Why IndexedDB is the right local database:** it's the only real
structured, transactional, reasonably-large-quota persistent store
browsers offer (WebSQL is gone; OPFS is file-oriented, not
record-oriented; Cache API is for HTTP responses). No serious
alternative exists inside a browser.

**Approved: `idb`.** Proceed with this in the next persistence phase.

**Should a wrapper library be used?** Yes — raw IndexedDB's
callback/event API is painful to hand-write eleven repositories against
safely. Compared:

| Option | Verdict |
|---|---|
| Raw `indexedDB` | Correct but verbose/error-prone; every repository reinvents promise-wrapping. |
| **`idb`** (Jake Archibald, ~1.5 kB) | **Recommended.** Pure promise wrapper over the native API — same data model, same object-store/index concepts, no new query DSL. Mature, minimal, maintained. Fits the project's existing minimalism (no TS, no Tailwind, no router-unless-needed) — it doesn't replace the `Repository` abstraction, it just makes implementing `IndexedDbRepository` sane. |
| Dexie.js (~28 kB) | Capable (live queries, better indexes) but layers its own abstraction *on top of* an abstraction we already own. Redundant ceremony for what a generic `Repository` + `idb` already covers. |
| localForage | Wrong shape — it's a key/value store with automatic WebSQL/localStorage fallback; we want one object store per collection with an `id`/`workspaceId` index, and the fallback layer is legacy weight IndexedDB-everywhere PWAs don't need. |

`IndexedDbRepository` implements the *same* 6-method interface
`LocalStorageRepository` does today (once the criteria-object fix in
§6 lands) — one object store per collection, `id` as key path, a
secondary index on `workspaceId` (and `driverId` where relevant) so
`query()` doesn't have to full-scan once data volume grows. Migrating
existing localStorage collections into IndexedDB is itself a one-time
migration, using the *same* `migrations/` pattern already in the
codebase — this is a natural fit, not a new mechanism.

**Local preference store** (language, sidebar collapsed, last active
workspace/person, PWA install dismissal, etc.) stays exactly where it
is conceptually — a small localStorage-backed key/value blob — but
should become the single explicit place for *all* such flags, not just
language. `src/settings/appSettings.js` is already that place; the only
change needed later is folding `wt-shell-sidebar-collapsed` and
`wt-current-person-id` into it for consistency.

---

## 3. Server database decision

**PostgreSQL — confirmed, not just accepted.** Given the domain model
(workspaces, memberships, engagements, assignments, rate cards, all
join-heavy and needing referential integrity, plus the versioning
requirement in §10), a relational database earns its keep here:
foreign keys and constraints get "an assignment can't reference a
deleted rate card" for free instead of hand-rolled in application code.

Alternatives considered and rejected for this domain:

- **SQLite** — excellent for solo/simple self-host, but the "multiple
  users/drivers, self-hosted, over a network" requirement needs a real
  multi-client server protocol; SQLite's story there (Litestream, Turso,
  etc.) adds complexity Postgres solves natively.
- **MySQL/MariaDB** — comparable, but weaker JSONB and Row-Level-Security
  story than Postgres (RLS matters for §17's shared-tenant future). No
  reason to prefer it here.
- **MongoDB/NoSQL** — fights the relational domain model directly;
  memberships/engagements/assignments are exactly the kind of
  join-and-constrain data a document database makes you re-implement by
  hand.

Postgres also has first-class Docker images, mature backup tooling, and
JSONB for the few genuinely flexible fields (`RateCard.rates`,
`ComplianceProfile.rules`) — best of both without abandoning the
relational core.

---

## 4. Backend technology recommendation

**Approved: Node.js + Fastify + Drizzle. Implementation deferred until
the backend phase** — nothing here is built yet; recorded so the choice
doesn't need re-litigating when that phase starts.

**Stay in Node.js.** The strongest argument is specific to this
codebase, not generic advice: `services/payEngine.js` and
`services/complianceEngine.js` are already pure, framework-independent
JS with zero DOM/React dependency (a deliberate property from the
original refactor — `complianceEngine.js` doesn't even import
`payEngine.js`). A Node backend can `import` those *exact* modules for
server-side pay/compliance calculation (validation, batch jobs, future
payroll exports) with **zero duplication risk** between client and
server business logic. Any other backend language throws that away and
requires a second, independently-maintained implementation of rules
that must never drift (the whole point of this app).

**Framework:** Fastify or Express — both fine, low-risk, boringly
mature. Fastify has a lighter plugin model and slightly better
throughput; Express has the largest ecosystem and the most examples to
crib from. Neither choice is architecturally significant. **Reject**
NestJS-style heavier frameworks for now — its DI/decorator ceremony
doesn't buy anything a "modular monolith" (a handful of route modules
calling service functions) doesn't already get more simply, and the
task explicitly asks not to over-engineer.

**Schema/query layer** — compared:

| Option | Notes |
|---|---|
| **Drizzle ORM** | SQL-first, thin runtime, no code-gen build step, migration tooling included. Fits the project's existing preference for less tooling over more (no TypeScript, no Tailwind, no router "unless genuinely required" were all prior calls in this same direction). **Recommended.** |
| Prisma | Very mature DX, excellent migration tooling, but a heavier runtime (a generated client + a query engine binary) and a schema DSL that's one more thing to learn on top of SQL. A safe, equally valid alternative if migration-tooling polish is valued over minimalism. |
| Raw `pg` + hand-written SQL | Most control, most boilerplate, no guardrails against typos in column names. Not recommended as the default — fine for a couple of hot-path queries later if ever needed. |

This is flagged as needing Alex's sign-off in §21 — it's foundational
and expensive to reverse once real data exists against a chosen schema
tool.

---

## 5. Repository / data-source architecture

**Approved: the `query(predicate) → query(criteria)` refactor happens
NOW, before any CRUD module work resumes** — not deferred to the
backend phase. This is the first item in the next implementation phase;
see the project's task tracking for the concrete plan.

Keep the **generic `Repository<T>` interface, one instance per
collection** — this is already the right answer to "don't create
one-interface-per-table ceremony." Domain-specific composition (e.g.
"shifts for a driver across all workspaces they belong to") correctly
lives one layer up, in `services/` (`shiftService.listShiftsForDriver`),
*not* as bespoke methods on a `ShiftRepository` class. That layering is
correct today and should not change.

**The one required interface change:** `query(predicate: fn)` →
`query(criteria: object)`, e.g.:

```js
// today (breaks over HTTP):
db.shifts.query(s => s.driverId === personId)

// proposed (works identically local or remote):
db.shifts.query({ where: { driverId: personId } })
```

`LocalStorageRepository`/`IndexedDbRepository` interpret `criteria` as
an in-memory filter; `ApiRepository` translates it into a query string
or a small JSON body the API turns into a `WHERE` clause. Keep the
criteria shape *deliberately small* (an equality-only `where` map,
maybe `orderBy`/`limit` later) — this is not a general query language,
just enough to describe what every current call site already needs.
Every existing `db.<collection>.query(fn)` call site would need this
mechanical rewrite — real work, but bounded and worth doing *before*
any `ApiRepository` is built (§19, Phase 4).

**Compound writes** (Engagement+Assignment created together,
RateCard-revision-plus-Assignment-repoint, etc.) should be exposed as
**dedicated backend endpoints/service functions**, not client-orchestrated
sequences of repository calls — the server wraps them in one DB
transaction. This avoids inventing a Unit-of-Work abstraction while
still getting real atomicity where it matters.

---

## 6. Workspace ownership & the multi-backend consequence

Add a `storageMode: 'local' | 'remote'` (+ connection info when remote)
concept to how a `Workspace` resolves its data — e.g. Alex's personal
workspace resolves to a local `IndexedDbRepository` set; a joined
company workspace resolves to an `ApiRepository` set pointed at that
company's server.

**A `RepositoryResolver`/`WorkspaceDataSource` abstraction is not just
appropriate here, it's required** — but it has a real consequence the
surface-level diagram hides: **`SessionContext.jsx` currently hands out
one global `db`.** That has to become "resolve the right repository set
for the workspace currently being read/written," which in turn means
**`listShiftsForDriver(personId)` becomes a fan-out**, not a single
query:

```
for each workspace the person belongs to (their memberships):
    resolve that workspace's data source (local or that workspace's remote API)
    ask it for shifts where driverId = personId
merge and sort the results client-side
```

This is bounded (a person realistically belongs to a handful of
workspaces) and does not require a distributed query engine — but it
must be designed as a fan-out from day one of the remote backend,
because it directly implements the "no duplicated shift" rule that is
this app's core architectural promise. For the dominant V1 case (one
person, one local personal workspace, zero remote workspaces) this
degenerates to exactly today's single-call behaviour — no regression
for solo drivers.

---

## 7. Canonical record ownership (extended to the remote case)

`docs/ARCHITECTURE.md`'s existing rule stands and generalises cleanly:
every record has exactly one owning `workspace_id`, fixed at creation.
The extension needed for the remote case is purely about *where* that
row physically lives, never about duplicating it:

- **Personal shift:** `workspace_id` = Alex's personal workspace,
  lives in **his local IndexedDB**.
- **Company-created shift** (Alex logging time against Northline Transport
  Ltd): `workspace_id` = the company workspace, `driver_id` = Alex,
  lives in **the company's remote Postgres**, fetched over the API when
  Alex's own "my shifts" view needs it.
- Alex sees both because his driver history is a fan-out over every
  workspace he has a membership in (§6) — never a second copy written
  anywhere.

**Deferred, not designed in detail (per instruction):** a future
sharing/submission/import concept — e.g. a solo driver later joining a
company and wanting their pre-existing local shifts to become visible
to (but not owned by) the company. Note only that the ownership model
already has the right shape to support this later (a shift's
`workspace_id` could be *reassigned* on submission, or a separate
"shared read grant" concept added) without redesigning the core rule —
worth a full design pass when it's actually needed, not now.

---

## 8. PostgreSQL conceptual schema

Conceptual only — no migrations. UUID primary keys throughout.
`created_at`/`updated_at` on everything; `archived_at` and `created_by`
where the CRUD/history requirements in §10/§9 call for them.

```
workspaces          id, kind ('personal'|'agency'|'transport_company'), name,
                     owner_person_id (nullable fk→people), created_at, updated_at

people               id, name, email (nullable), created_at, updated_at
                     -- global identity, not owned by any workspace

memberships          id, workspace_id fk, person_id fk, roles text[],
                     created_at, archived_at

organisations        id, workspace_id fk (unique), legal_name, trading_name,
                     created_at, updated_at, archived_at

sites                id, organisation_id fk, name, kind, client_name (nullable),
                     created_at, updated_at, archived_at

driver_profiles      id, person_id fk (unique), default_break_minutes,
                     created_at, updated_at

engagements          id, organisation_id fk, workspace_id fk, driver_id fk→people,
                     role, start_date, end_date (nullable), status,
                     created_at, updated_at, created_by

assignments           id, engagement_id fk, site_id fk, rate_card_id fk,
                     start_date, end_date (nullable),
                     created_at, updated_at, created_by

rate_cards           id, workspace_id fk, name, rates jsonb,
                     effective_from, effective_to (nullable),
                     version int, supersedes_id (nullable, self-fk),
                     created_at, created_by
                     -- IMMUTABLE once referenced by a shift — see §9

shifts               id, workspace_id fk, driver_id fk→people,
                     assignment_id fk (nullable),
                     rate_card_id fk (nullable)   -- NEW: pinned at creation, see §9
                     date, start_time, end_time, break_minutes, driving_hours,
                     source, created_at, updated_at, created_by

compliance_profiles  id, scope ('default'|driver_id), rules jsonb, version int,
                     effective_from, created_at

-- future, not yet in domain/types.js — sketched for completeness:
expenses             id, workspace_id fk, driver_id fk, shift_id fk (nullable),
                     category, amount numeric, currency default 'GBP', date,
                     notes, created_at, created_by, archived_at

documents            id, workspace_id fk, owner_type, owner_id, filename,
                     mime_type, size_bytes, storage_backend, storage_key,
                     created_at, created_by, archived_at
```

---

## 9. Historical integrity / versioning model

**Approved: immutable/versioned RateCards from day one, no exceptions.**
Historical shifts must reference the exact RateCard/version used for
their expected-pay calculation; no edit-in-place behaviour may ever
change a historical calculation. This is the third item in the next
implementation phase — the versioning foundation lands *before* Rate
Card CRUD, not alongside or after it.

**This is the most important correctness requirement in the whole
document, and the one most at risk from a naive CRUD implementation.**

Today's chain is `Shift.assignment_id → Assignment.rate_card_id →
RateCard.rates` — a *live* lookup. Nothing currently breaks because
there is no rate-card-editing UI yet, so rates are immutable only by
accident. The moment §11's Rate Card CRUD ships, editing a `RateCard`'s
`rates` in place would silently recompute *every past shift's* expected
pay on next render — exactly the bug the task asks to prevent.

**Required design, before Rate Card CRUD ships:**

1. `RateCard` rows are **append-only** once a shift references them:
   "editing" a rate card creates a **new row** (new id, `version + 1`,
   new `effective_from`) and closes the old row's `effective_to` —
   never an in-place `UPDATE rates`.
2. `Shift` gets an **explicit, pinned `rate_card_id`**, resolved and
   stored at creation time — not re-derived live through
   `assignment → rate_card` on every render. A shift's expected pay
   must remain reproducible even if its assignment later points
   somewhere else.
3. The same principle applies to `Assignment` (site/rate-card changes
   → new row, old row gets `end_date`) and to `ComplianceProfile` rule
   changes (versioned, `effective_from`) — lower urgency than rate
   cards (compliance is evaluated fresh from shift history each time,
   not stored), but worth the same discipline for audit/legal
   defensibility if UK rules ever change.

This is **not event sourcing** — no event log, no replay. Just: the
handful of tables whose historical values must stay stable are
insert-a-new-version instead of update-in-place. A dedicated service
function (e.g. `reviseRateCard(oldId, newRates, effectiveFrom, db)`)
should own this, rather than routing rate-card edits through the
generic `Repository.update()`.

---

## 10. File/document storage plan

**Approved direction: filesystem storage by default for self-hosted
installations, S3-compatible storage optional through the abstraction
below. Implementation deferred until a documents module actually
exists** — not started now.

Metadata in Postgres (`documents`, §8), binary content behind a small
storage-abstraction interface — the same philosophy already applied to
domain data:

```
DocumentStorage.put(key, stream) → storageKey
DocumentStorage.get(storageKey)  → stream/url
DocumentStorage.delete(storageKey)
```

Two implementations: **filesystem** (default for self-hosted — zero
extra infrastructure, a bind-mounted Docker volume) and
**S3-compatible object storage** (MinIO for self-hosters who want it,
or a managed provider — R2/S3/Backblaze — for the future managed
offering). Not implemented now; the interface shape is what matters —
it lets a self-hosted org start on filesystem and move to S3-compatible
storage later without an application rewrite.

---

## 11. CRUD / configuration architecture

Management modules: People/Drivers, Organisations, Sites/Depots,
Memberships/Roles, Engagements, Assignments, Rate Cards, Compliance
Profiles — each create/view/edit/archive, built on the *existing*
Repository+service layering (no new architectural concept beyond what's
above).

**Archive vs. hard delete** — decided per whether historical shifts
could reference the row:

- **Archive-only** (default for almost everything): Organisation, Site,
  Engagement, Assignment, RateCard, ComplianceProfile, and any Person
  once they have shift/membership history. Deleting these could orphan
  a historical Shift's resolved context — directly violates §9. Archive
  = `archived_at` timestamp, hidden from active pickers, still
  resolvable for history.
- **Hard-delete safe:** only records that provably have zero historical
  references yet — e.g. a `RateCard` draft deleted before it was ever
  applied to a shift, or a `Membership` with no shifts logged under it.

**Rate Card edits specifically must not go through generic
`update()`** — they need the versioning-aware service function from §9,
not a plain CRUD form bound directly to `Repository.update()`.

**On hardcoded names:** `docs/ARCHITECTURE.md` and the current codebase
already avoid branching application logic on organisation names
("Example"/"Example Logistics" appear only as *seed/migration data* in
`seedSecondCompany.js`/`002_migrate_legacy_demo_agency.js`, which is
one-time data population, not decision logic — no navigation, pay, or
compliance code path checks a specific name). CRUD work should preserve
that distinction; it does not need to fix anything that's currently
broken.

---

## 12. Authentication path (design only — not implemented now)

**Approved direction: self-hosted email/password login with secure
server-side sessions, built on mature security libraries, Argon2id-style
password hashing. No custom cryptography. No Auth0/Clerk/Keycloak now.
Implementation deferred until the backend/auth phase.**

Self-hosted company mode eventually needs: login, sessions, and
enforcement of the **already-modeled** `Role` enum
(`driver|owner|admin|manager|dispatcher|payroll|viewer`) — auth's job
is to *enforce* what `Membership.roles` already represents, not invent
a new permission model.

**Recommended, once needed:** a hand-rolled or `lucia-auth`-style
email+password + `httpOnly` session cookie, Argon2id password hashing
via a mature, actively-maintained library (never a bespoke hashing
routine). **Explicitly reject** a heavy identity platform (Auth0,
Keycloak, Clerk) for now — genuinely disproportionate for "a handful of
people log into their own self-hosted instance," and a well-reviewed
lightweight session library avoids the real risks of fully hand-rolled
crypto without the operational weight of a full IdP.

**Safe to defer:** SSO/OAuth/social login, MFA, SCIM/enterprise
federation, email-based password reset (needs an email-sending
dependency — can start with an admin-set password bootstrap for the
first self-hosted release).

**Solo mode needs no auth at all** — single local user, device-level
trust. This must stay true; it's the whole reason solo mode requires
"no server administration."

---

## 13. Offline / sync path

**V1 (now, solo): already offline-first by construction** — everything
is local, there are no network calls to fail. The only *additional*
piece needed to formalise "installable offline app" is a service worker
+ manifest (standard `vite-plugin-pwa`) caching the app shell/assets —
a bounded, well-understood task, unrelated to the data-layer questions
above.

**Future (company-connected driver, intermittent connectivity) — the
genuinely hard, honestly-deferred problem.** No CRDT/operational-
transform sync engine, per instruction. Recommended narrow starting
scope when this is actually tackled: only the driver's **own
newly-created records** (a shift they log while offline) get a local
"pending writes" queue (an IndexedDB outbox table), replayed against
the API when connectivity returns. Editing *shared, company-owned*
mutable state (rate cards, assignments) while offline is **not**
solved by this and should simply require connectivity for the
foreseeable future — a much narrower, tractable slice of "offline sync"
than general bidirectional sync, and honest about what it doesn't
cover.

---

## 14. Backup / recovery model

**Solo — partially already done.** `exportWorkspace`/`importWorkspace`
(`src/services/exportImportService.js`) already provides workspace-
scoped JSON export/import today — the "JSON/full-data export initially"
requirement is met by existing code, not a gap. Future: an
*encrypted automatic* backup (e.g. periodic export to a user-chosen
location via the File System Access API, client-side WebCrypto
encryption keyed by a passphrase that's never transmitted) — genuinely
future work, sketched only.

**Company:** standard `pg_dump`/`pgBackRest` on a schedule into the
persistent volume (or off-box), filesystem/S3 backup for documents
(`rsync`/`restic`, or provider-side versioning for S3), and a
**written, periodically-tested restore runbook** — untested backups
should not be counted as backups.

**Principle:** browser-local storage (IndexedDB or otherwise) must
never be treated as a user's *sole* permanent copy — eviction, device
loss, or a cleared profile can destroy it. Export should be actively
reminded/prompted, not merely theoretically available.

---

## 15. Privacy implications

- **Solo local:** data never leaves the device unless explicitly
  exported. Minimal third-party processing surface — Alex is both
  controller and subject of his own data.
- **Self-hosted company:** the **company**, not this software's author,
  becomes the data controller for its drivers' working-time/pay data
  (UK GDPR-relevant, employment-monitoring-adjacent). **Self-hosting
  does not remove the organisation's legal obligations** — it only
  keeps the data off third-party infrastructure. The company still
  needs its own lawful basis, privacy notice, retention policy, and
  driver-access-request process; none of that is solved by the
  software. State this explicitly wherever self-hosting is marketed.
- **Future managed hosting:** introduces the hosting operator as an
  explicit data processor (or joint controller, depending on terms) —
  needs a real Data Processing Agreement, defined data residency
  (UK/EU hosting is the likely requirement for UK driver data), and a
  breach-notification process. This is a real regulatory cost of the
  managed path, not just an infra decision — factor it into *whether*
  and *when* to build §16, not just how.
- **Data minimisation:** collect only what pay/compliance calculation
  needs — no reason to ever add precise GPS/location.

### Retention classification model — approved, design only (no automatic deletion yet)

**Not one global retention period.** Different record types are
regulated differently, so retention is modelled **per category**, each
anchored to its own clock. UK baselines below were confirmed by Alex
against GOV.UK, not asserted by this document:

| Category | Applies to | Legal minimum | Anchor |
|---|---|---|---|
| `tachograph_driving_hours` | driving-hours evidence within a `Shift` | 12 months | record date |
| `working_time` | Road Transport Working Time Regulations records (duty/working time within a `Shift`) | 24 months | record date |
| `payroll` *(future)* | PAYE/payroll records, once that module exists | 3 years | **end of the relevant tax year** — not record date |
| `general` | anything not otherwise classified | defaults to the longest applicable category, never a shorter guess | record date |

**A `Shift` row satisfies two categories in one record** — it carries
both driving hours and duty/working-time together, and retention isn't
split at the field level. The whole row is retained for the **longer**
of the two applicable minimums (24 months, since Road Transport Working
Time exceeds the tachograph minimum). Splitting retention per-field
would add complexity for no benefit while both concepts live in one
table row.

Conceptual model (design only — nothing below is implemented):

```
RetentionCategory   id ('tachograph_driving_hours'|'working_time'|'payroll'|'general'),
                     legal_minimum_months, legal_minimum_anchor ('record_date'|'tax_year_end'),
                     source_note   -- e.g. "GOV.UK — employer record-keeping"; a citation
                                      string for audit purposes, never hardcoded logic

RetentionPolicy     id, workspace_id fk, retention_category_id fk,
                     policy_months  -- organisation override; must be >= the category's
                                        legal_minimum_months, enforced at the service layer —
                                        an organisation may extend retention, never shorten
                                        it below the legal minimum
                     created_at, updated_at, created_by
```

**Retention is a distinct concern from the `archive` mechanism in
§11.** Archiving hides inactive *configuration* (RateCard, Assignment,
Organisation rows) from active pickers while preserving it for
historical resolution. Retention classification applies to
evidentiary/event records (Shifts, future payroll/expense records) —
config entities aren't "kept for N months," they're kept indefinitely
(archived, not deleted) precisely because historical shifts may still
reference them (§9). Conflating the two would be a mistake.

**No automatic deletion is implemented or planned.** This model exists
so that if/when "flag records past their legal minimum for review" (or,
far more cautiously, actual deletion) is ever designed, it has real
per-category data to compute from, rather than one guessed number
applied uniformly to data that isn't legally uniform.

---

## 16. Managed SaaS evolution path (future — not implemented now)

**Approved: defer.** Keep the architecture capable of managed hosting
(the shared-tenancy design below), but do not implement or optimise for
it until real demand exists beyond this document's speculation.

**A. Dedicated deployment/database per customer** — maximum isolation,
simplest security reasoning (no cross-tenant query is even possible),
but operationally expensive to provision/patch/back up at any real
customer count, and overkill for a small transport company.

**B. Shared PostgreSQL, `workspace_id`-scoped tenancy, enforced by
Postgres Row-Level-Security as a database-level backstop *in addition
to* application-layer authorization** (never RLS alone, never
app-layer `WHERE` clauses alone — an app-layer filter is one missed
clause away from a cross-tenant leak; RLS makes that leak
database-impossible even if application code has a bug).

**Recommendation: B for an early managed offering.** Cheaper, faster to
onboard, and the standard proven pattern for early-stage B2B SaaS.
Treat A as a later "enterprise/high-sensitivity tier" escape hatch, not
the default. Worth noting: every **self-hosted** customer already gets
A's isolation for free, by definition (their own dedicated Postgres) —
the shared-tenancy isolation problem only exists once *managed* hosting
is offered.

---

## 17. Deployment (self-hosted target experience)

```
docker compose up -d
```

- Services: `web` (built static frontend, served by a small static/
  reverse-proxy container or bundled into `api`), `api` (Node), `db`
  (Postgres, named + persistent volume), later `documents` (bind-mount
  or MinIO).
- Documented environment variables (DB connection, session secret,
  storage backend selection, base URL).
- Persistent named volume for Postgres data (and documents, once that
  exists) — survives container recreation.
- Documented backup command (§14) and a documented upgrade procedure
  (stop → back up → pull new images → run migrations → start) — written
  down before the first real self-hosted install, not improvised then.
- **Solo Driver mode requires none of this** — no server, no Compose
  file, no admin. That split must stay crisp in the docs so solo users
  are never told to run infrastructure they don't need.
- No Kubernetes. No microservices split beyond `web`/`api`/`db` — a
  modular monolith (route modules → service functions, same shape the
  frontend already uses) is the right size for the foreseeable future.

---

## 18. Migration phases from today's application

Design-only roadmap — sequencing matters more than the list itself.

0. **Today:** client-only, `localStorage`, single global `db`.
1. Consolidate all local *preferences* (language, sidebar-collapsed,
   current person, last workspace) under one explicit local-settings
   store — tidy-up, `appSettings.js` mostly already does this.
2. Swap `LocalStorageRepository` → `IndexedDbRepository` (`idb`),
   migrate existing data via the existing `migrations/` mechanism.
   *Does not* need the query-criteria fix yet — an all-local app can
   keep using in-memory predicates safely.
3. PWA installability (`vite-plugin-pwa`, manifest, offline shell
   caching) — additive, no data-layer dependency.
4. **Query-criteria refactor** (`query(predicate)` → `query(criteria)`)
   across every call site — done *before* any remote repository exists,
   so Local and future Api repositories share one real interface from
   day one.
5. Backend build: Node + Fastify/Express + Postgres + Drizzle/Prisma;
   conceptual schema (§8) → real migrations; `ApiRepository`;
   `WorkspaceDataSource`/`RepositoryResolver`; `SessionContext` updated
   to resolve per-workspace repositories instead of one global `db`.
6. Auth (login/sessions/role enforcement) — only needed once a real
   multi-user remote backend exists.
7. CRUD management UI (§11) — **can start earlier than backend work**,
   since it works against the local IndexedDB repository too (a solo/
   self-employed user configuring their own rate cards). Must land the
   §9 versioning discipline before or alongside Rate Card CRUD
   specifically.
8. Docker Compose self-hosted packaging + written deployment/backup/
   upgrade runbook.
9. *(Much later, optional)* managed SaaS shared tenancy + RLS.

---

## 19. Major architectural risks

- **`query(predicate)` over HTTP** — the single biggest hidden risk if
  not fixed before backend work starts (§6).
- **Naive Rate Card CRUD corrupting historical pay** — high risk
  specifically because CRUD is the very next planned work; the §9
  versioning discipline must land with or before it, not after.
- **One global `db` singleton assumption baked into `SessionContext`
  and every screen** — needs deliberate rework, not a drop-in swap
  (§7).
- **IndexedDB eviction** — Safari/iOS in particular has a history of
  more aggressive site-data eviction than Chrome; a solo driver's
  *only* copy of income-relevant data must not silently vanish.
  Mitigate with `navigator.storage.persist()` plus actively prompting
  export, not trusting durability alone.
- **Self-hosted upgrade risk** once real companies depend on it —
  schema migrations become a one-way door; needs tested migrations and
  a "back up before upgrade" habit from the first release.
- **Sequencing/scope risk** — this is a large roadmap for a
  single-user product today. Don't build §16–18 speculatively before
  Phases 1–4 plus a real second user validates that self-hosted/managed
  demand is real.
- **Hand-rolled auth risk** — right-sized, but only if built on a
  reviewed session library rather than fully bespoke crypto.

---

## 20. Decision log — approved 2026-07-28

All nine decisions below were reviewed and approved by Alex on
2026-07-28. "Deferred" means the *decision* is final but *implementation*
has not started; "proceed" means implementation begins in the immediate
next phase (see the project's task tracking for the concrete plan).

| # | Decision | Approved | Status |
|---|---|---|---|
| D1 | Backend framework | **Fastify** | Deferred to backend phase |
| D2 | Schema/query tool | **Drizzle** | Deferred to backend phase |
| D3 | IndexedDB wrapper | **`idb`** | **Proceed** — next persistence phase |
| D4 | `query(predicate)` → `query(criteria)` | **Refactor now**, before CRUD modules | **Proceed** — first item of next phase |
| D5 | RateCard versioning | **Immutable/versioned from day one**; historical shifts pin the exact RateCard/version used; no edit-in-place that changes historical calculations | **Proceed** — third item of next phase, lands before Rate Card CRUD |
| D6 | Document storage | Filesystem default for self-hosted, S3-compatible optional via the abstraction | Deferred until a documents module exists |
| D7 | Authentication | Self-hosted email/password + secure server-side sessions, mature libraries, Argon2id hashing; no custom cryptography; no Auth0/Clerk/Keycloak now | Deferred to backend/auth phase |
| D8 | Managed SaaS | **Defer** — keep the architecture capable of it, do not build or optimise for it until real demand exists | Deferred indefinitely, revisit only after external validation |
| D9 | Retention architecture | **No single global period — per-category classification** (§15), UK baselines confirmed against GOV.UK: tachograph/driving-hours 12 months, Road Transport Working Time 24 months, future payroll 3 years from tax-year end. No automatic deletion. | Modelled (§15); no implementation |
