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

Three containers, via Docker Compose:
- `postgres` — the database, with a named volume so data survives
  container recreation.
- `server` — the Fastify API (auth, all data access).
- `client` — the React app, pre-built as static files and served by
  nginx, with the API's address baked in at build time.

## Setup

1. Install Docker and Docker Compose.
2. `cp .env.example .env`, then edit `.env`:
   - Set a real `POSTGRES_PASSWORD`.
   - Set `VITE_API_BASE_URL` to the address *other devices* will
     reach the server at — not `localhost`, unless you only ever plan
     to use the app from the same machine the server runs on. E.g.
     `http://192.168.1.50:3001` or a real domain if you're putting
     this behind a reverse proxy.
   - Set `CORS_ORIGIN` to match the address you'll load the client
     from (its origin, not the API's) — the server rejects requests
     from anywhere not listed here.
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

## Upgrade procedure

1. Back up (above).
2. `git pull` (or however you're tracking releases).
3. `docker compose build`
4. `docker compose up -d` — migrations run automatically as part of
   the server container's startup.

If a migration ever needs a manual step, it will be called out in that
release's notes — none of the migrations that exist today require one.

## Troubleshooting

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
