import { createServer } from "node:http";
import { exec as execCb, execSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { buildTriggerCommand, parseTriggerResponse, mergeStatus, imageTagFor, IDLE_STATE } from "./lib.js";

// The only component in this stack with access to the host's Docker
// socket -- deliberately isolated here so the internet-facing
// server/client containers never touch it. Reachable only over the
// docker-compose internal network (no published port -- see
// docker-compose.yml), and only ever called by the already-authenticated,
// owner/admin-gated server/src/routes/updates.js.
const PORT = process.env.PORT ?? 4000;

// Must be the exact same absolute path on the host and inside this
// container (see docker-compose.yml's updater volume mount) -- this
// container's docker CLI talks to the HOST's Docker daemon over the
// mounted socket, so any path it passes to `docker compose` is
// resolved by that host daemon, not by anything inside this container.
const REPO_PATH = process.env.REPO_HOST_PATH ?? "/repo";

// Plain `docker compose` derives its project name from the current
// directory name by default -- fine for a plain-compose deployment,
// but WRONG when the real running stack was actually created under a
// different project name (e.g. TrueNAS's "Custom App" system runs
// everything under `ix-<app_name>`, not the repo directory's own
// name). Without this, `docker compose up -d` here creates a second,
// independent stack that collides with the real one on host ports
// instead of updating it. Must be set explicitly for those
// deployments -- see docs/BACKEND_SELF_HOSTING.md.
const COMPOSE_PROJECT_NAME = process.env.COMPOSE_PROJECT_NAME || path.basename(REPO_PATH);
const COMPOSE_PROJECT_FLAG = process.env.COMPOSE_PROJECT_NAME ? `-p ${process.env.COMPOSE_PROJECT_NAME}` : "";

// Presence of this var is what selects the TrueNAS lifecycle-handoff
// branch below. Unset (plain/generic self-hosting): the original,
// unchanged `docker compose up -d` path -- see
// docs/BACKEND_SELF_HOSTING.md's "Known limitation" history for why
// that path used to be the only one and stays as-is for non-TrueNAS
// hosts.
const TRUENAS_SSH_HOST = process.env.TRUENAS_SSH_HOST;
const TRUENAS_SSH_USER = process.env.TRUENAS_SSH_USER ?? "truenas_admin";
const TRUENAS_SSH_KEY_PATH = process.env.TRUENAS_SSH_KEY_PATH ?? "/updater-ssh/id_ed25519";
const TRUENAS_SSH_KNOWN_HOSTS_PATH = process.env.TRUENAS_SSH_KNOWN_HOSTS_PATH ?? "/updater-ssh/known_hosts";

// Read-only bind mount of the host-side worker's state directory (see
// deploy/truenas/README.md). Never written from inside this container --
// the detached host worker (deploy/truenas/bin/hgv_hub_update_trigger.py)
// is the sole writer, precisely because it must keep reporting after
// THIS container gets recreated by the very redeploy it triggers.
const UPDATER_STATE_MOUNT_PATH = process.env.UPDATER_STATE_MOUNT_PATH ?? "/updater-state";

// The only services with a `build:` in docker-compose.yml -- postgres
// uses a pulled base image and must never be snapshotted/retagged here.
const LOCALLY_BUILT_SERVICES = ["server", "client", "updater"];

const exec = promisify(execCb);

// The bind-mounted repo is owned by the host user, not whatever user
// this container runs as -- git's ownership-safety check (correctly)
// refuses to operate on it otherwise. Wildcard is fine here: this
// container's whole purpose is operating on exactly one mounted repo,
// nothing else is exposed to it.
execSync("git config --global --add safe.directory '*'");

/** Structured, secret-free progress logging -- every field here is a
 * runId/tag/image-id/exit-code/short-reason we constructed ourselves,
 * never raw stdout/stderr from ssh/midclt passed through unexamined. */
function log(stage, extra = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), stage, ...extra }));
}

let inMemoryState = { ...IDLE_STATE };
let phaseARunning = false;

function readHostState() {
  const filePath = path.join(UPDATER_STATE_MOUNT_PATH, "state.json");
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    // Mid-write (the host worker writes via tmp-file-then-rename, so this
    // should be rare/never) or corrupt -- treat as "no file yet" rather
    // than crash a status read.
    return null;
  }
}

async function getImageId(tag) {
  try {
    const { stdout } = await exec(`docker image inspect --format '{{.Id}}' ${tag}`);
    return stdout.trim() || null;
  } catch {
    return null; // image doesn't exist yet (e.g. the very first build ever)
  }
}

async function snapshotImages() {
  const ids = {};
  for (const svc of LOCALLY_BUILT_SERVICES) {
    ids[svc] = await getImageId(imageTagFor(COMPOSE_PROJECT_NAME, svc));
  }
  return ids;
}

/** Re-points each service's :latest tag back to its pre-build image ID
 * and verifies the restore stuck. Never touches postgres. A partial
 * multi-service build failure must not leave an EARLIER service's
 * successfully-rebuilt tag pointing at new (untested-as-a-whole) content
 * while a LATER service's build fails -- this restores the full set. */
async function restoreImages(previousIds) {
  const verified = {};
  for (const svc of LOCALLY_BUILT_SERVICES) {
    const prevId = previousIds[svc];
    if (!prevId) {
      verified[svc] = true; // nothing existed before (fresh install) -- nothing to restore
      continue;
    }
    const tag = imageTagFor(COMPOSE_PROJECT_NAME, svc);
    try {
      await exec(`docker tag ${prevId} ${tag}`);
      verified[svc] = (await getImageId(tag)) === prevId;
    } catch (err) {
      verified[svc] = false;
      log("restore-images-error", { service: svc, error: String(err.message ?? err) });
    }
  }
  const allOk = Object.values(verified).every(Boolean);
  if (!allOk) log("restore-images-inconsistent", { verified });
  return allOk;
}

async function gitPreviousRef() {
  const { stdout } = await exec(`git -C ${REPO_PATH} rev-parse HEAD`);
  return stdout.trim();
}

async function gitPreviousTag() {
  try {
    const { stdout } = await exec(`git -C ${REPO_PATH} describe --tags --exact-match`);
    return stdout.trim();
  } catch {
    return null; // HEAD isn't exactly on a tag -- previousRef (the SHA) stays authoritative
  }
}

async function gitLatestTag() {
  await exec(`git -C ${REPO_PATH} fetch --tags`);
  const { stdout } = await exec(`git -C ${REPO_PATH} tag -l --sort=-v:refname`);
  return stdout.trim().split("\n").filter(Boolean)[0];
}

async function gitCheckout(ref) {
  // -f: this directory is a pure deployment target, never somewhere to
  // hand-edit -- any local diff here is stray cruft (or a failed
  // previous update), never something worth preserving over the release
  // that was just confirmed.
  await exec(`git -C ${REPO_PATH} checkout -f ${ref}`);
}

/** Invokes the TrueNAS host's forced SSH command and waits only for its
 * near-instant "started" acknowledgement -- never for the update itself,
 * which the host-side worker performs fully detached (see
 * deploy/truenas/README.md for why: app.redeploy recreates this very
 * container, so nothing running in it can wait out that call). */
function runSshTrigger(commandString, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const args = [
      "-i", TRUENAS_SSH_KEY_PATH,
      "-o", `UserKnownHostsFile=${TRUENAS_SSH_KNOWN_HOSTS_PATH}`,
      "-o", "StrictHostKeyChecking=yes",
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=10",
      `${TRUENAS_SSH_USER}@${TRUENAS_SSH_HOST}`,
      commandString,
    ];
    const child = spawn("ssh", args);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: "", stderr: String(err.message ?? err) });
    });
  });
}

async function failPhaseA({ runId, stage, reason, previousImageIds, previousRef }) {
  const restored = await restoreImages(previousImageIds);
  await gitCheckout(previousRef);
  inMemoryState = {
    ...inMemoryState,
    status: "failed",
    stage,
    error: restored ? reason : `${reason} (WARNING: image tag restore verification failed -- manual check needed)`,
    updatedAt: Date.now(),
  };
  log(restored ? "phase-a-failed" : "phase-a-failed-restore-inconsistent", { runId, stage, reason });
}

async function runUpdate() {
  const runId = randomUUID();
  const startedAt = Date.now();
  inMemoryState = { ...IDLE_STATE, status: "updating", stage: "checkout", runId, startedAt, updatedAt: startedAt };

  try {
    const previousRef = await gitPreviousRef();
    const previousTag = await gitPreviousTag();
    const targetTag = await gitLatestTag();
    inMemoryState = { ...inMemoryState, previousRef, previousTag, targetTag, updatedAt: Date.now() };
    log("checkout", { runId, previousRef, previousTag, targetTag });

    await gitCheckout(targetTag);

    inMemoryState = { ...inMemoryState, stage: "build", updatedAt: Date.now() };
    const previousImageIds = await snapshotImages();
    log("build-start", { runId, previousImageIds });

    try {
      await exec(`cd ${REPO_PATH} && docker compose ${COMPOSE_PROJECT_FLAG} build`);
    } catch (err) {
      log("build-failed", { runId, error: String(err.message ?? err) });
      await failPhaseA({ runId, stage: "build", reason: String(err.message ?? err), previousImageIds, previousRef });
      return;
    }
    log("build-success", { runId, targetTag });

    if (TRUENAS_SSH_HOST) {
      const commandString = buildTriggerCommand({ runId, targetTag, previousRef, previousTag, previousImageIds });
      const { code, stdout, stderr } = await runSshTrigger(commandString);
      const { accepted, reason } = parseTriggerResponse(stdout, runId);

      if (!accepted || code !== 0) {
        log("handoff-failed", { runId, code, stdout, stderr, reason });
        await failPhaseA({
          runId,
          stage: "handoff",
          reason: reason ?? `ssh exited ${code}`,
          previousImageIds,
          previousRef,
        });
        return;
      }

      log("handoff-success", { runId, targetTag });
      // Phase A's job ends here. state.json (host-side, written by the
      // detached worker) becomes authoritative for this runId from this
      // point on -- see lib.js's mergeStatus. This container may be
      // recreated at any moment by the very redeploy it just triggered.
      inMemoryState = { ...inMemoryState, stage: "redeploy", updatedAt: Date.now() };
      return;
    }

    // Generic (non-TrueNAS) self-hosting -- deliberately unchanged: this
    // container recreating itself via its own `up -d` is the existing,
    // accepted shape for that deployment target, not something this fix
    // revisits (see docs/BACKEND_SELF_HOSTING.md).
    await exec(`cd ${REPO_PATH} && docker compose ${COMPOSE_PROJECT_FLAG} up -d`);
    log("generic-up-success", { runId, targetTag });
    inMemoryState = { ...inMemoryState, status: "success", stage: "up", updatedAt: Date.now() };
  } catch (err) {
    log("unexpected-error", { runId, error: String(err.message ?? err) });
    inMemoryState = { ...inMemoryState, status: "failed", error: String(err.message ?? err), updatedAt: Date.now() };
  } finally {
    phaseARunning = false;
  }
}

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/apply") {
    if (phaseARunning || readHostState()?.status === "updating") {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "update already in progress" }));
      return;
    }
    // Set synchronously, before returning control to the event loop, so
    // a second request arriving before runUpdate()'s first await can
    // never slip past the check above.
    phaseARunning = true;
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "updating" }));
    runUpdate().catch((err) => {
      phaseARunning = false;
      log("apply-unhandled-error", { error: String(err.message ?? err) });
    });
    return;
  }

  if (req.method === "GET" && req.url === "/status") {
    const merged = mergeStatus(inMemoryState, readHostState());
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(merged));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => console.log(`updater listening on :${PORT}`));
