/**
 * Pure, unit-testable logic for the updater sidecar. Kept separate from
 * index.js (HTTP wiring + child_process/fs orchestration) so the parts
 * that matter most for correctness -- the SSH handoff protocol and the
 * GET /status merge rule -- can be tested without mocking a shell.
 */

/**
 * Builds the single-line SSH command deploy/truenas/bin/hgv_hub_update_trigger.py's
 * REQUEST_PATTERN parses. Field order/format must match that regex exactly.
 */
export function buildTriggerCommand({ runId, targetTag, previousRef, previousTag, previousImageIds }) {
  const none = (v) => v ?? "none";
  return [
    "update",
    runId,
    targetTag,
    previousRef,
    none(previousTag),
    none(previousImageIds?.server),
    none(previousImageIds?.client),
    none(previousImageIds?.updater),
  ].join(" ");
}

/**
 * The trigger script prints exactly one line: "started runId=<id>" on
 * success, anything else (including its own "rejected: ..." on stderr,
 * surfaced here via stdout being empty/different) means the handoff did
 * NOT happen -- checked for an exact match, not "contains", so a runId
 * mismatch (a stale/racing response) is never mistaken for acceptance.
 */
export function parseTriggerResponse(stdout, expectedRunId) {
  const trimmed = (stdout ?? "").trim();
  if (trimmed === `started runId=${expectedRunId}`) {
    return { accepted: true };
  }
  return { accepted: false, reason: trimmed || "empty response" };
}

/**
 * GET /status merge rule.
 *
 * state.json (host-side, written only by the detached Phase B worker) is
 * only authoritative for the run it actually describes:
 * - same runId as the in-memory state: Phase B has taken over reporting
 *   for the CURRENT run -- prefer the file.
 * - different runId: whichever run actually started more recently wins.
 *   This is what stops a stale completed run's "success" in the file
 *   from masking a brand-new in-memory "updating" run that hasn't
 *   reached Phase B yet (fresh in-memory startedAt is newer) -- and,
 *   symmetrically, stops a freshly recreated (memoryless) updater
 *   process's blank "idle" in-memory state from hiding a real run
 *   that's still in progress or just finished, recorded in the file
 *   (file startedAt is newer than the idle default of 0).
 */
export function mergeStatus(inMemoryState, fileState) {
  if (!fileState) return inMemoryState;
  if (inMemoryState.runId && inMemoryState.runId === fileState.runId) return fileState;
  return (inMemoryState.startedAt ?? 0) > (fileState.startedAt ?? 0) ? inMemoryState : fileState;
}

export const IDLE_STATE = Object.freeze({
  status: "idle",
  stage: null,
  runId: null,
  targetTag: null,
  previousRef: null,
  previousTag: null,
  startedAt: 0,
  updatedAt: 0,
  error: null,
});

/** Docker Compose's own default image-naming convention when a service
 * has no explicit `image:` -- used to resolve the exact tag to snapshot/
 * restore without depending on `docker compose config` output ordering. */
export function imageTagFor(projectName, service) {
  return `${projectName}-${service}:latest`;
}
