#!/usr/bin/env node
// One-off migration: takes a JSON dump from window.__exportAllData()
// (run in your browser console on your local/solo install) and
// replays it into a real self-hosted (server-mode) account.
//
// You run this yourself, from your own machine — it needs your
// session cookie to make authenticated requests, and that should
// never be typed into or handled by anyone else. Get the cookie value
// from your browser: after logging into your server-mode account,
// open DevTools -> Application/Storage -> Cookies -> find "wt_session"
// -> copy its value.
//
// Usage:
//   node scripts/import-full-account.mjs \
//     --file hgv-hub-export-2026-08-04.json \
//     --server http://192.0.2.10:30101 \
//     --cookie <wt_session cookie value>
//
// Safe to re-run: every write is a plain insert: attempts to
// re-import an id that already exists on the server will fail loudly
// (logged, not silently skipped) rather than overwrite anything.

import { readFileSync } from "node:fs";

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, "")] = argv[i + 1];
  }
  return args;
}

// Dependency-ish order — not enforced by the server (no FK
// constraints, by design, see server/src/db/schema.js), but importing
// in this order means anything you inspect mid-run already has its
// natural "parent" rows present.
const COLLECTION_ORDER = [
  "workspaces", "organisations", "sites", "rateCardLineages", "rateCards",
  "memberships", "driverProfiles", "engagements", "placements", "assignments",
  "vehicles", "checklistTemplates", "shifts", "loads", "vehicleChecks",
  "defects", "driverDocuments", "cpcTrainingRecords", "complianceProfiles",
];

async function apiFetch(server, cookie, path, options = {}) {
  const res = await fetch(`${server}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", cookie: `wt_session=${cookie}`, ...options.headers },
  });
  return res;
}

function remapPersonId(row, oldPersonId, newPersonId) {
  const remapped = { ...row };
  for (const [key, value] of Object.entries(remapped)) {
    if (value === oldPersonId) remapped[key] = newPersonId;
  }
  return remapped;
}

async function main() {
  const { file, server, cookie, "old-person-id": oldPersonIdArg } = parseArgs();
  if (!file || !server || !cookie) {
    console.error("Usage: node scripts/import-full-account.mjs --file <export.json> --server <url> --cookie <wt_session value>");
    process.exit(1);
  }

  const bundle = JSON.parse(readFileSync(file, "utf8"));

  const meRes = await apiFetch(server, cookie, "/api/auth/me");
  if (!meRes.ok) {
    console.error(`Could not resolve the logged-in account (${meRes.status}) — is the cookie value correct and current?`);
    process.exit(1);
  }
  const newPersonId = (await meRes.json()).personId;
  console.log(`Importing into person: ${newPersonId}`);

  let oldPersonId = oldPersonIdArg;
  if (!oldPersonId) {
    if (bundle.people.length !== 1) {
      console.error(`Found ${bundle.people.length} people in the export — pass --old-person-id explicitly to say which one is you.`);
      process.exit(1);
    }
    oldPersonId = bundle.people[0].id;
  }
  console.log(`Migrating from local person: ${oldPersonId}`);

  // The new account already has its own fresh personal workspace (from
  // ensurePersonalWorkspace on first login) — don't import a second one.
  const skipWorkspaceIds = new Set(
    (bundle.workspaces ?? []).filter((w) => w.kind === "personal").map((w) => w.id)
  );

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const collection of COLLECTION_ORDER) {
    const rows = bundle[collection] ?? [];
    for (const rawRow of rows) {
      if ("workspaceId" in rawRow && skipWorkspaceIds.has(rawRow.workspaceId)) {
        skipped += 1;
        continue;
      }
      if (collection === "workspaces" && skipWorkspaceIds.has(rawRow.id)) {
        skipped += 1;
        continue;
      }
      const row = remapPersonId(rawRow, oldPersonId, newPersonId);
      const res = await apiFetch(server, cookie, `/api/${collection}`, {
        method: "POST",
        body: JSON.stringify(row),
      });
      if (res.ok) {
        inserted += 1;
      } else {
        failed += 1;
        const body = await res.json().catch(() => ({}));
        console.error(`FAILED ${collection}/${row.id}: ${res.status} ${body.error ?? ""}`);
      }
    }
  }

  console.log(`\nDone. Inserted ${inserted}, skipped ${skipped} (personal-workspace rows), failed ${failed}.`);
  if (failed > 0) {
    console.log("Failures are logged above — most likely a row that already exists (safe to ignore if you're re-running after a partial failure).");
  }
}

main();
