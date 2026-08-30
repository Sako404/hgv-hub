import { describe, it, expect } from "vitest";
import { buildTriggerCommand, parseTriggerResponse, mergeStatus, imageTagFor, IDLE_STATE } from "./lib.js";

describe("buildTriggerCommand", () => {
  it("formats all fields in the exact order the host-side regex expects", () => {
    expect(
      buildTriggerCommand({
        runId: "abc123",
        targetTag: "v0.3.15",
        previousRef: "a".repeat(40),
        previousTag: "v0.3.14",
        previousImageIds: { server: `sha256:${"b".repeat(64)}`, client: null, updater: null },
      })
    ).toBe(`update abc123 v0.3.15 ${"a".repeat(40)} v0.3.14 sha256:${"b".repeat(64)} none none`);
  });

  it("uses the literal none for every missing optional field", () => {
    expect(
      buildTriggerCommand({
        runId: "r1",
        targetTag: "v1.0.0",
        previousRef: "0".repeat(40),
        previousTag: null,
        previousImageIds: {},
      })
    ).toBe(`update r1 v1.0.0 ${"0".repeat(40)} none none none none`);
  });
});

describe("parseTriggerResponse", () => {
  it("accepts an exact started-runId match", () => {
    expect(parseTriggerResponse("started runId=abc123\n", "abc123")).toEqual({ accepted: true });
  });

  it("rejects a mismatched runId (could be a stale/racing response)", () => {
    expect(parseTriggerResponse("started runId=other", "abc123")).toEqual({
      accepted: false,
      reason: "started runId=other",
    });
  });

  it("rejects anything that isn't the exact expected line", () => {
    expect(parseTriggerResponse("rejected: update already in progress", "abc123").accepted).toBe(false);
  });

  it("treats empty/missing output as a rejection with a clear reason", () => {
    expect(parseTriggerResponse("", "abc123")).toEqual({ accepted: false, reason: "empty response" });
    expect(parseTriggerResponse(undefined, "abc123")).toEqual({ accepted: false, reason: "empty response" });
  });
});

describe("mergeStatus", () => {
  it("returns in-memory state when no file state exists yet", () => {
    expect(mergeStatus(IDLE_STATE, null)).toBe(IDLE_STATE);
  });

  it("prefers file state once it matches the current in-memory runId (Phase B took over)", () => {
    const inMemory = { ...IDLE_STATE, status: "updating", stage: "redeploy", runId: "r1", startedAt: 100 };
    const file = { status: "updating", stage: "health-check", runId: "r1", startedAt: 100, updatedAt: 105 };
    expect(mergeStatus(inMemory, file)).toBe(file);
  });

  it("does not let a stale completed file state mask a brand-new in-memory run", () => {
    const staleFile = { status: "success", runId: "old-run", startedAt: 50, updatedAt: 60 };
    const freshInMemory = { ...IDLE_STATE, status: "updating", stage: "build", runId: "new-run", startedAt: 200 };
    expect(mergeStatus(freshInMemory, staleFile)).toBe(freshInMemory);
  });

  it("lets a real file state show through for a freshly recreated (memoryless) process", () => {
    const file = { status: "updating", stage: "health-check", runId: "r1", startedAt: 100, updatedAt: 150 };
    expect(mergeStatus(IDLE_STATE, file)).toBe(file);
  });
});

describe("imageTagFor", () => {
  it("matches Docker Compose's own default <project>-<service>:latest convention", () => {
    expect(imageTagFor("ix-hgv-hub", "server")).toBe("ix-hgv-hub-server:latest");
    expect(imageTagFor("hgv-hub", "client")).toBe("hgv-hub-client:latest");
  });
});
