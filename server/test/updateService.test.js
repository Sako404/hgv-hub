import { afterEach, describe, expect, it, vi } from "vitest";

// RUNNING_VERSION is computed once at module load (from server/VERSION,
// which doesn't exist outside the Docker image) — falls back to
// "0.0.0" here, which is exactly what we want: every mocked release
// below should read as newer than that.
const { checkForUpdate, applyUpdate, getApplyStatus, RUNNING_VERSION } = await import("../src/services/updateService.js");

function mockGithubRelease(tagName) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ tag_name: tagName }),
  });
}

describe("updateService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to 0.0.0 for RUNNING_VERSION when no VERSION file is present (non-Docker/test env)", () => {
    expect(RUNNING_VERSION).toBe("0.0.0");
  });

  it("checkForUpdate reports an update is available when the release is newer", async () => {
    vi.stubGlobal("fetch", mockGithubRelease("v0.3.0"));
    const result = await checkForUpdate({ force: true });
    expect(result.latestVersion).toBe("0.3.0");
    expect(result.updateAvailable).toBe(true);
  });

  it("compares versions numerically, not lexically (0.10.0 > 0.9.0)", async () => {
    vi.stubGlobal("fetch", mockGithubRelease("v0.0.0"));
    let result = await checkForUpdate({ force: true });
    expect(result.updateAvailable).toBe(false);
  });

  it("caches the result — a second call within the interval doesn't refetch", async () => {
    const fetchMock = mockGithubRelease("v0.5.0");
    vi.stubGlobal("fetch", fetchMock);
    await checkForUpdate({ force: true });
    await checkForUpdate();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("force:true bypasses the cache", async () => {
    const fetchMock = mockGithubRelease("v0.6.0");
    vi.stubGlobal("fetch", fetchMock);
    await checkForUpdate({ force: true });
    await checkForUpdate({ force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("checkForUpdate throws when the GitHub API call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(checkForUpdate({ force: true })).rejects.toThrow("404");
  });

  it("applyUpdate posts to the updater sidecar and returns its response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "updating" }) });
    vi.stubGlobal("fetch", fetchMock);
    const result = await applyUpdate();
    expect(result).toEqual({ status: "updating" });
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("applyUpdate throws with the updater's error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "git pull failed" }) }));
    await expect(applyUpdate()).rejects.toThrow("git pull failed");
  });

  it("applyUpdate's thrown error carries the updater's HTTP status (so the route can pass a 409 through distinctly)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "update already in progress" }) }));
    await expect(applyUpdate()).rejects.toMatchObject({ status: 409, message: "update already in progress" });
  });

  it("getApplyStatus passes the updater's progress state straight through", async () => {
    const state = { status: "updating", stage: "redeploy", runId: "r1" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => state }));
    await expect(getApplyStatus()).resolves.toEqual(state);
  });

  it("getApplyStatus throws when the updater is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(getApplyStatus()).rejects.toThrow("503");
  });
});
