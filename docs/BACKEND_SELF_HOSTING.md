# Self-hosting HGV HUB (backend/server mode)

This is one of two ways to run HGV HUB — see
`docs/DATA_ARCHITECTURE_PROPOSAL.md` §2/§17 for the full context. If
you just want the app for yourself, on one device, with no server:
**you don't need any of this** — run the client alone (`npm run dev` /
`npm run build`), it works entirely offline against the browser's own
IndexedDB.

Use this guide if you want:
- more than one device to see the same data, or
- more than one person (e.g. a driver + their Transport Manager) to
  share a workspace, or
- to run this as a small hosted service on your own hardware (a NAS,
  a home server, a VPS).

## What gets installed

Four containers, via Docker Compose:
- `postgres` — the database, with a named volume so data survives
  container recreation.
- `server` — the Fastify API (auth, all data access).
- `client` — the React app, pre-built as static files and served by
  nginx, with the API's address baked in at build time.
- `updater` — a small sidecar that applies self-updates (see "Staying
  up to date" below). No published port; only `server` can reach it.

## Setup

1. Install Docker and Docker Compose.
2. `cp .env.example .env`, then edit `.env`:
   - Set a real `POSTGRES_PASSWORD`.
   - Set `VITE_API_BASE_URL` to the address *other devices* will
     reach the server at — not `localhost`, unless you only ever plan
     to use the app from the same machine the server runs on. E.g.
     `http://192.0.2.10:3001` or a real domain if you're putting
     this behind a reverse proxy.
   - Set `CORS_ORIGIN` to match the address you'll load the client
     from (its origin, not the API's) — the server rejects requests
     from anywhere not listed here.
   - Set `REPO_HOST_PATH` to the absolute path where you cloned this
     repo, as it exists **on the host** — required for self-updates to
     work at all (see "Staying up to date"); get it wrong and updates
     fail loudly rather than silently doing the wrong thing.
3. `docker compose up -d --build`
4. Open the client's address in a browser (`http://localhost:8080` by
   default). You'll land on a sign-in screen — register the first
   account there.

The server runs its database migrations automatically on every
container start (idempotent — safe to restart as often as you like).

## Changing `VITE_API_BASE_URL` later

The client is a static build with this value compiled in — a plain
restart won't pick up a change. After editing `.env`:

```
docker compose build client
docker compose up -d client
```

## Backup

Everything that matters lives in the `pgdata` named volume. A simple
logical backup:

```
docker compose exec postgres pg_dump -U workingtime workingtime > backup.sql
```

Restore into a fresh volume:

```
cat backup.sql | docker compose exec -T postgres psql -U workingtime workingtime
```

Take a backup before every upgrade (below), and on whatever schedule
suits how much data loss you could tolerate.

## TrueNAS SCALE

Plain `docker compose up -d --build` works, but on TrueNAS SCALE the
`docker` group isn't assigned to regular users (including admin
accounts) and can't be granted through the TrueNAS UI/API — so neither
a normal SSH session nor even TrueNAS's own web Shell can run Docker
commands directly (`permission denied` on `/var/run/docker.sock`). Two
ways around it, in order of how well they integrate with the rest of
TrueNAS:

**Option A — register it as a TrueNAS "Custom App"** (recommended —
shows up in the Apps tab like any other app, and gets uniform
start/stop/logs through the UI). From an SSH session as your admin
user (no elevated privileges needed — `midclt` talks to the
middleware, not the Docker socket directly):

```bash
cd /path/to/hgv-hub
docker compose config | tail -n +2 > /tmp/compose-resolved.yml
python3 -c "
import json
with open('/tmp/compose-resolved.yml') as f:
    compose = f.read()
print(json.dumps({'app_name': 'hgv-hub', 'custom_app': True, 'custom_compose_config_string': compose}))
" > /tmp/create-payload.json
midclt call -j app.create "$(cat /tmp/create-payload.json)"
```

`docker compose config` resolves every `${VAR}` from your `.env` into
literal values first — TrueNAS's Custom App system wants a
fully-resolved compose file, not one that depends on a sibling `.env`.

**To redeploy after pulling new code** (e.g. after `git pull`, or
before the self-update feature existed): regenerate the payload the
same way but call `app.update` instead of `app.create`, passing just
`{"custom_compose_config_string": "..."}`. One real gotcha: if the
compose YAML's *structure* hasn't changed (only the application source
inside an unchanged build context has), TrueNAS won't detect a reason
to rebuild the image — it'll recreate containers from the stale image.
Force a rebuild by removing the old images first
(`sudo docker rmi -f ix-<app-name>-<service>` for each service — needs
`sudo`, which only works from a real interactive terminal since
`truenas_admin` has no *passwordless* sudo), then re-run `app.update`.

**If you use the self-update feature (below) with a Custom App
deployment, `COMPOSE_PROJECT_NAME` in `.env` is required, not
optional.** TrueNAS's containers are named `ix-<app_name>-*`, but a
plain `docker compose up -d` run from the repo directory (which is
exactly what the `updater` service does) defaults to a project name
derived from the *directory name* instead — with nothing telling it
otherwise, it creates a second, independent stack that collides with
the real one on host ports rather than updating it. Set
`COMPOSE_PROJECT_NAME=ix-<app_name>` (e.g. `ix-hgv-hub`) to fix this —
found and fixed after exactly this happened on a real deployment.

**Resolved, 2026-08-30: self-update no longer races TrueNAS's own
supervisor.** This used to be a known limitation — the `updater`
sidecar ran `docker compose build && docker compose up -d` directly,
and TrueNAS's own supervisor could fight it, briefly leaving the app
stuck `Created`/`CRASHED` until a manual **Apps → hgv-hub → Start**.
Fixed by splitting responsibilities: the `updater` still does
`git checkout` + `docker compose build` locally (build never touches a
running container — it only creates/retags an image), but the actual
`up`/`down`/recreate step is now always performed by TrueNAS's own
`midclt call app.redeploy` instead, invoked via a dedicated, tightly
scoped SSH forced command on the TrueNAS host (see
`deploy/truenas/README.md` for the one-time setup this needs — a
dedicated keypair, an `authorized_keys` forced command, and a
persistent state directory under `/mnt/<POOL>/hgv-hub-updater/`).
TrueNAS's own middleware is now the sole owner of the app's container
lifecycle in every case — a self-update, a manual `app.stop`/`app.start`,
a `docker.backup_to_pool` cycle, or a host reboot all go through
exactly the same path, so nothing outside TrueNAS's own bookkeeping can
leave it out of sync with what's actually running.

Since `app.redeploy` recreates *every* container in the app, including
`updater` itself, the sidecar can't wait for the redeploy's own result —
that would mean waiting on an action that kills the waiter. The forced
command instead confirms only that a **detached, host-side worker**
has taken over (a few seconds), then that worker independently calls
`app.redeploy`, polls it to completion, and health-checks the new
version — all as a plain host process, immune to the container churn
it's causing. Its progress is written to a state file the (possibly
already-recreated) `updater` container reads read-only, so
`GET /api/updates/apply/status` (polled by the "Update now" banner)
keeps reporting accurately across the whole cycle. If the build itself
fails, or the handoff to that worker isn't cleanly confirmed, the
`updater` restores every locally-built image tag to its pre-build ID
(verified, never guessed) and reverts the git checkout — the running
app and the next redeploy both stay on the previous, known-good state
without ever calling `app.redeploy` at all. Postgres's image is never
touched by any of this (it isn't rebuilt on a source-only release).

A failed post-redeploy health-check does **not** automatically roll the
app back — the worker's state file records `previousRef`,
`previousTag`, and every service's pre-update image ID specifically so
a human can recover deterministically (re-run the same flow targeting
`previousRef`), not so it happens silently.

This mechanism is TrueNAS-specific — a plain generic Docker Compose
self-hosting deployment (no `TRUENAS_SSH_HOST` set) keeps the original
`docker compose up -d` path unchanged, including its own pre-existing
behaviour of recreating the `updater` container as part of applying its
own update.

**Option B — plain `docker compose`, run once via `sudo`** from an
interactive SSH session (a real terminal, so it can prompt for the
sudo password — a non-interactive `ssh host command` won't work):

```bash
cd /path/to/hgv-hub
sudo docker compose up -d --build
```

Simpler for a one-off, but it won't show up in the Apps tab, and this
project's own self-update feature (below) recreates containers via
`docker compose` directly too — it works fine either way since it also
runs from inside the `updater` container (which already has the
Docker socket mounted, sidestepping the TrueNAS permission model
entirely), but Option A's app-registration state won't reflect updates
applied this way.

## Staying up to date

Once a day, the server checks the project's GitHub Releases for
something newer than what's running. If you're signed in as an
owner/admin of any workspace (including your own personal one — see
`server/src/routes/updates.js`), you'll see a banner. Confirming it
tells the `updater` sidecar to `git fetch`, check out the new tag, and
rebuild — happens in the background, the app comes back up on its own
once it's done.

This requires `REPO_HOST_PATH` to be set correctly (see Setup) and
your deployment to actually be a `git clone` of the public repo, not a
one-off download — `git fetch`/`checkout` need real git history to
pull from.

## Manual upgrade procedure

The self-update path above covers the common case; do this instead if
you'd rather not wait for the automatic check, or the automatic path
isn't set up:

1. Back up (above).
2. `git pull` (or however you're tracking releases).
3. `docker compose build`
4. `docker compose up -d` — migrations run automatically as part of
   the server container's startup.

If a migration ever needs a manual step, it will be called out in that
release's notes — none of the migrations that exist today require one.

## Troubleshooting

- **Login/register appears to succeed, then everything says "Not
  authenticated"**: you're almost certainly running over plain HTTP
  with `COOKIE_SECURE=true` — a Secure cookie is silently never sent
  back by the browser except over HTTPS. Leave `COOKIE_SECURE=false`
  (the default) unless this is genuinely served over HTTPS.
- **Client loads but every action fails / a permanent "Not
  authenticated"**: `VITE_API_BASE_URL` almost always doesn't match
  where the server is actually reachable from your browser, or
  `CORS_ORIGIN` doesn't match where the client is served from. Check
  both against the exact origin (scheme + host + port) your browser's
  address bar shows.
- **`server` container keeps restarting**: check
  `docker compose logs server` — almost always `DATABASE_URL`/Postgres
  connectivity (`postgres` not yet healthy, or a wrong password in
  `.env`).
