import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchUpdateStatus, applyUpdate } from "./updateClient.js";

function mockFetchOnce(response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("updateClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchUpdateStatus GETs with credentials and returns the parsed body", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => ({ runningVersion: "0.2.0", latestVersion: "0.3.0", updateAvailable: true }),
    });
    const result = await fetchUpdateStatus("http://api.test");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/api/updates/status");
    expect(options.credentials).toBe("include");
    expect(options.method).toBeUndefined();
    expect(result).toEqual({ runningVersion: "0.2.0", latestVersion: "0.3.0", updateAvailable: true });
  });

  it("applyUpdate POSTs and returns the parsed body", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: async () => ({ status: "updating" }) });
    const result = await applyUpdate("http://api.test");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/api/updates/apply");
    expect(options.method).toBe("POST");
    expect(result).toEqual({ status: "updating" });
  });

  it("throws with the server's error message on a non-ok response", async () => {
    mockFetchOnce({ ok: false, status: 403, json: async () => ({ error: "Only an owner/admin can manage server updates" }) });
    await expect(fetchUpdateStatus("http://api.test")).rejects.toThrow("Only an owner/admin can manage server updates");
  });
});
