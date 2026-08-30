#!/usr/bin/env python3
"""
hgv_hub_update_trigger.py -- SSH forced command for hgv-hub's self-update
Phase B, on a TrueNAS SCALE Custom App deployment.

Why this exists: `app.redeploy` recreates every container in the app's
compose project, INCLUDING the `updater` sidecar that triggers it. A
process can't wait on the result of an action that kills it mid-wait --
so the updater's own container (Phase A: git checkout + docker compose
build) only ever gets this script to CONFIRM a detached worker has taken
over. That worker (this script, after it forks and detaches) then owns
calling app.redeploy, polling it, and health-checking the result --
entirely independent of whether/when the updater container comes back.

Installed at a FIXED, root-owned path outside both the app's own git
checkout and any ix-apps-managed dataset, so it survives a TrueNAS
upgrade and can never be modified from inside the updater container
(which never mounts this directory -- only `state/` below, read-only).
See deploy/truenas/README.md for the one-time host setup steps.

Wired via authorized_keys:
  restrict,command="/usr/bin/python3 /mnt/APPS/hgv-hub-updater/bin/hgv_hub_update_trigger.py" ssh-ed25519 AAAA... hgv-hub-updater

`command=` makes sshd run THIS script no matter what the client asked
for. The client's actual request arrives only via $SSH_ORIGINAL_COMMAND,
which this script treats as untrusted input: parsed against one fixed
regex, never executed, every field bounded and format-checked before
use.

Protocol (single line, see updater/src/lib.js's buildTriggerCommand --
field order and format must match exactly):
  update <runId> <targetTag> <previousRef> <previousTag|none> \
         <prevServerImageId|none> <prevClientImageId|none> <prevUpdaterImageId|none>

Output (stdout, exactly one line, read by updater/src/lib.js's
parseTriggerResponse):
  started runId=<runId>          -- worker handed off and detached
  (nonzero exit, stderr instead) -- rejected; Phase A must self-heal
"""
import fcntl
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

STATE_DIR = "/mnt/APPS/hgv-hub-updater/state"
LOCK_FILE = os.path.join(STATE_DIR, "update.lock")
STATE_FILE = os.path.join(STATE_DIR, "state.json")
LOG_FILE = os.path.join(STATE_DIR, "worker.log")

TRUENAS_APP_NAME = "hgv-hub"
HEALTH_URL = "http://127.0.0.1:30101/api/health"
HEALTH_TIMEOUT_SECONDS = 90
HEALTH_POLL_INTERVAL_SECONDS = 3
JOB_POLL_INTERVAL_SECONDS = 2
JOB_POLL_TIMEOUT_SECONDS = 600

REQUEST_PATTERN = re.compile(
    r"^update "
    r"(?P<run_id>[A-Za-z0-9-]{1,64}) "
    r"(?P<target_tag>v\d+\.\d+\.\d+) "
    r"(?P<previous_ref>[0-9a-f]{40}) "
    r"(?P<previous_tag>v\d+\.\d+\.\d+|none) "
    r"(?P<prev_server_id>sha256:[0-9a-f]{64}|none) "
    r"(?P<prev_client_id>sha256:[0-9a-f]{64}|none) "
    r"(?P<prev_updater_id>sha256:[0-9a-f]{64}|none)$"
)


def reject(reason):
    sys.stderr.write(f"rejected: {reason}\n")
    sys.exit(1)


def midclt_call(method, *args):
    cmd = ["midclt", "call", method] + [json.dumps(a) for a in args]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(f"{method} failed: {result.stderr.strip()}")
    return json.loads(result.stdout) if result.stdout.strip() else None


def write_state(doc):
    doc["updatedAt"] = int(time.time())
    tmp_path = f"{STATE_FILE}.tmp.{os.getpid()}"
    with open(tmp_path, "w") as f:
        json.dump(doc, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, STATE_FILE)  # atomic rename on the same filesystem


def none_or(value):
    return None if value == "none" else value


def run_worker(fields):
    """Runs entirely detached (see daemonize_and_run) -- everything here
    happens well after the SSH session that requested it has closed."""
    base = {
        "runId": fields["run_id"],
        "targetTag": fields["target_tag"],
        "previousRef": fields["previous_ref"],
        "previousTag": none_or(fields["previous_tag"]),
        "startedAt": int(time.time()),
        "recovery": {
            "previousRef": fields["previous_ref"],
            "previousTag": none_or(fields["previous_tag"]),
            "previousImageIds": {
                "server": none_or(fields["prev_server_id"]),
                "client": none_or(fields["prev_client_id"]),
                "updater": none_or(fields["prev_updater_id"]),
            },
        },
    }

    def state(status, stage, error=None):
        doc = dict(base)
        doc["status"] = status
        doc["stage"] = stage
        doc["error"] = error
        write_state(doc)
        print(f"[{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}] "
              f"runId={base['runId']} stage={stage} status={status}"
              + (f" error={error}" if error else ""))
        sys.stdout.flush()  # os._exit() below skips normal buffer flushing

    state("updating", "redeploy")
    try:
        job_id = midclt_call("app.redeploy", TRUENAS_APP_NAME)
    except Exception as exc:
        state("failed", "redeploy", f"failed to start app.redeploy: {exc}")
        return

    deadline = time.time() + JOB_POLL_TIMEOUT_SECONDS
    job_state = None
    while time.time() < deadline:
        try:
            jobs = midclt_call("core.get_jobs", [["id", "=", job_id]])
        except Exception as exc:
            state("failed", "redeploy", f"failed to poll job {job_id}: {exc}")
            return
        if jobs:
            job_state = jobs[0]["state"]
            if job_state in ("SUCCESS", "FAILED", "ABORTED"):
                break
        time.sleep(JOB_POLL_INTERVAL_SECONDS)
    else:
        state("failed", "redeploy", f"app.redeploy job {job_id} did not finish within {JOB_POLL_TIMEOUT_SECONDS}s")
        return

    if job_state != "SUCCESS":
        state("failed", "redeploy", f"app.redeploy job {job_id} ended in state {job_state!r}")
        return

    state("updating", "health-check")
    target_version = fields["target_tag"].lstrip("v")
    deadline = time.time() + HEALTH_TIMEOUT_SECONDS
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=5) as resp:
                body = json.loads(resp.read())
            if body.get("version") == target_version:
                state("success", "health-check")
                return
        except Exception:
            pass
        time.sleep(HEALTH_POLL_INTERVAL_SECONDS)

    state("failed", "health-check",
          f"new version never reported version={target_version!r} at {HEALTH_URL} within {HEALTH_TIMEOUT_SECONDS}s")


def daemonize_and_run(fields):
    """Standard double-fork daemonize: detaches the worker from this SSH
    session so it survives both the session closing AND (unlike the
    session) the updater container being recreated out from under it --
    it's a plain host process, not something app.redeploy can touch."""
    if os.fork() > 0:
        return  # original (SSH-invoked) process: falls through to print "started"

    os.setsid()
    if os.fork() > 0:
        os._exit(0)  # first child: done, no further output

    devnull = os.open(os.devnull, os.O_RDWR)
    os.dup2(devnull, 0)
    log_fd = os.open(LOG_FILE, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    os.dup2(log_fd, 1)
    os.dup2(log_fd, 2)

    run_worker(fields)
    os._exit(0)


def main():
    os.makedirs(STATE_DIR, exist_ok=True)

    match = REQUEST_PATTERN.match(os.environ.get("SSH_ORIGINAL_COMMAND", ""))
    if not match:
        reject("malformed request")
    fields = match.groupdict()

    # Atomic concurrency lock -- state.json is a status report, never a
    # synchronization primitive; TOCTOU-checking its "status" field is not
    # mutual exclusion. This fd, once locked, is held open across both
    # forks below (flock is per-open-file-description; fork() duplicates
    # the descriptor, not the lock) for the detached worker's entire
    # lifetime, and released automatically by the kernel the moment every
    # process holding it exits -- including a crash -- so it can never be
    # left stuck locked by a dead worker.
    lock_fd = os.open(LOCK_FILE, os.O_CREAT | os.O_RDWR, 0o644)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        reject("update already in progress")

    daemonize_and_run(fields)
    # Only the original process reaches here (the first child _exit()s
    # instead of returning) -- lock confirmed held before this prints, so
    # "started" is only ever emitted once the handoff is real.
    print(f"started runId={fields['run_id']}")


if __name__ == "__main__":
    main()
