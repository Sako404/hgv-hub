import { createServer } from "node:http";
import { exec, execSync } from "node:child_process";

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
// directory name by default — fine for a plain-compose deployment,
// but WRONG when the real running stack was actually created under a
// different project name (e.g. TrueNAS's "Custom App" system runs
// everything under `ix-<app_name>`, not the repo directory's own
// name). Without this, `docker compose up -d` here creates a second,
// independent stack that collides with the real one on host ports
// instead of updating it. Must be set explicitly for those
// deployments — see docs/BACKEND_SELF_HOSTING.md.
const COMPOSE_PROJECT_FLAG = process.env.COMPOSE_PROJECT_NAME
  ? `-p ${process.env.COMPOSE_PROJECT_NAME}`
  : "";

// The bind-mounted repo is owned by the host user, not whatever user
// this container runs as — git's ownership-safety check (correctly)
// refuses to operate on it otherwise. Wildcard is fine here: this
// container's whole purpose is operating on exactly one mounted repo,
// nothing else is exposed to it.
execSync("git config --global --add safe.directory '*'");

function runUpdate() {
  const cmd = [
    `cd ${REPO_PATH}`,
    "git fetch --tags",
    'LATEST_TAG=$(git tag -l --sort=-v:refname | head -1)',
    // -f: this directory is a pure deployment target, never somewhere
    // to hand-edit — any local diff here is stray cruft (or a failed
    // previous update), never something worth preserving over actually
    // applying the release the admin just confirmed.
    'git checkout -f "$LATEST_TAG"',
    `docker compose ${COMPOSE_PROJECT_FLAG} build`,
    `docker compose ${COMPOSE_PROJECT_FLAG} up -d`,
  ].join(" && ");

  exec(cmd, { shell: "/bin/sh" }, (err, stdout, stderr) => {
    if (err) {
      console.error("update failed:", err.message, stderr);
      return;
    }
    console.log("update applied:", stdout);
  });
}

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/apply") {
    // Responds immediately -- the actual git+docker work happens in the
    // background and can take minutes. The caller (server's
    // /api/updates/apply) already told the user "updating" before this
    // was even called.
    runUpdate();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "updating" }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => console.log(`updater listening on :${PORT}`));
