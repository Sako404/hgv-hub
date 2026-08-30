# TrueNAS self-update lifecycle handoff — host setup

This directory holds the host-side half of the fix described in
`docs/BACKEND_SELF_HOSTING.md`'s "Resolved, 2026-08-30" note: the
`updater` sidecar still does `git checkout` + `docker compose build`
inside its own container, but the actual container lifecycle
(`up`/`down`/recreate) is now always performed by TrueNAS's own
`midclt call app.redeploy` — invoked through a single-purpose SSH
forced command, never by the sidecar running `docker compose up/down`
itself.

This is a **one-time, manual host setup** — deliberately not something
the app or its self-update feature can install itself (an app that can
grant itself more privileged access to its own host is a bootstrapping
problem, not a feature). Do this once per TrueNAS deployment.

## Why a detached worker, not a synchronous SSH call

`app.redeploy` recreates *every* container in the app's compose
project — including `updater` itself. A process can't usefully wait on
the result of the very call that kills it mid-wait. So
`bin/hgv_hub_update_trigger.py` only ever confirms, synchronously and
in under a second, that a **fully detached** worker has taken over
(double-forked, new session, stdio redirected away from the SSH
channel) — that worker then owns calling `app.redeploy`, polling it,
and health-checking the result, entirely independent of the SSH
session or the `updater` container's own lifecycle.

## One-time setup

Run these as `root` on the TrueNAS host (adjust `APPS` if your apps
pool has a different name — check with `midclt call docker.config`).

```bash
# 1. Directory layout — bin/ root-owned and never mounted into any
#    container; state/ is what gets bind-mounted read-only into the
#    updater container.
mkdir -p /mnt/APPS/hgv-hub-updater/bin /mnt/APPS/hgv-hub-updater/state
chown root:root /mnt/APPS/hgv-hub-updater /mnt/APPS/hgv-hub-updater/bin
chmod 755 /mnt/APPS/hgv-hub-updater /mnt/APPS/hgv-hub-updater/bin
chown truenas_admin:truenas_admin /mnt/APPS/hgv-hub-updater/state
chmod 755 /mnt/APPS/hgv-hub-updater/state

# 2. Copy the trigger script from this repo checkout onto the host at
#    the fixed path the authorized_keys entry below references.
cp bin/hgv_hub_update_trigger.py /mnt/APPS/hgv-hub-updater/bin/
chown root:root /mnt/APPS/hgv-hub-updater/bin/hgv_hub_update_trigger.py
chmod 755 /mnt/APPS/hgv-hub-updater/bin/hgv_hub_update_trigger.py

# 3. A dedicated keypair for the updater container — never reuse a
#    personal/admin key. No passphrase (it must run unattended).
ssh-keygen -t ed25519 -f /mnt/APPS/hgv-hub-updater/updater_key -N "" -C "hgv-hub-updater"
chmod 600 /mnt/APPS/hgv-hub-updater/updater_key
chmod 644 /mnt/APPS/hgv-hub-updater/updater_key.pub

# 4. Authorize its public key for truenas_admin, restricted to running
#    ONLY the trigger script -- `restrict` disables port/X11/agent
#    forwarding, ptys, and any future OpenSSH restriction, in one
#    keyword (safer than listing individual no-* options by hand).
echo "restrict,command=\"/usr/bin/python3 /mnt/APPS/hgv-hub-updater/bin/hgv_hub_update_trigger.py\" $(cat /mnt/APPS/hgv-hub-updater/updater_key.pub)" \
  >> /home/truenas_admin/.ssh/authorized_keys

# 5. Pin the TrueNAS host's own SSH host key into a known_hosts file
#    for the updater container to verify against (StrictHostKeyChecking
#    stays on — no trust-on-first-use inside a container). Scan the
#    SAME address TRUENAS_SSH_HOST below will actually connect
#    through, not 127.0.0.1 -- see the note under that variable for why.
ssh-keyscan -t ed25519 <TRUENAS_LAN_IP> > /mnt/APPS/hgv-hub-updater/known_hosts
```

Then set in the app's `.env` (or push via `midclt call app.update`, the
same way the restart-policy fix was deployed — see the Brain project
record for that exact pattern):

```
TRUENAS_SSH_HOST=<TRUENAS_LAN_IP, e.g. 192.0.2.10>
TRUENAS_SSH_KEY_HOST_PATH=/mnt/APPS/hgv-hub-updater/updater_key
TRUENAS_SSH_KNOWN_HOSTS_HOST_PATH=/mnt/APPS/hgv-hub-updater/known_hosts
UPDATER_STATE_HOST_PATH=/mnt/APPS/hgv-hub-updater/state
```

**Do not use `127.0.0.1` for `TRUENAS_SSH_HOST`** — found live during
this feature's own bootstrap: `127.0.0.1` inside the `updater`
container's network namespace means the container itself, not the
TrueNAS host (standard Docker networking — a bridge-networked
container never shares the host's loopback). The updater's own SSH
client failed with `Connection refused` until this was pointed at the
host's real LAN IP instead. `known_hosts` must be scanned against that
same address (a host key is tied to how you *reach* the box, not just
which box it is — `ssh`'s known_hosts matching is by hostname/IP).
A future improvement worth considering: `host.docker.internal` (with
`extra_hosts: ["host.docker.internal:host-gateway"]` in
`docker-compose.yml`) would decouple this from the LAN IP staying
stable — not done here, since fixing the immediate bug took priority.

## What the trigger script does and doesn't trust

`bin/hgv_hub_update_trigger.py` is invoked by `command=` no matter what
the SSH client asked for — sshd hands it the client's actual request
only via `$SSH_ORIGINAL_COMMAND`, which the script treats as untrusted
input: matched against one fixed regex
(`update <runId> <targetTag> <previousRef> <previousTag|none> <3 image ids or none>`),
every field format-checked, nothing ever passed to a shell or `eval`'d.
See the script's own docstring for the full protocol and
`updater/src/lib.js`'s `buildTriggerCommand`/`parseTriggerResponse` for
the client side that must match it exactly.

Concurrency is enforced with `flock` on `state/update.lock` — held by
the detached worker for its entire run (released automatically by the
kernel on exit, even a crash) — never by reading `state/state.json`'s
`status` field, which is a report, not a lock.

## Files

- `bin/hgv_hub_update_trigger.py` — the forced command; on a successful
  lock acquisition, forks/detaches and becomes the worker in the same
  process image (see its own docstring — this is deliberate, not a
  missing split into two scripts).
- `state/` (created by setup, not checked into git) — `state.json`
  (current/last run's progress, read read-only by the `updater`
  container), `update.lock` (flock target only, never parsed),
  `worker.log` (this run's own stdout/stderr, for manual debugging).
