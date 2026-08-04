import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAccount, loginAccount, logoutAccount, fetchCurrentSession } from "./authClient.js";

function mockFetchOnce(response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("authClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("logoutAccount sends no body and no Content-Type header — Fastify's JSON parser 400s on an empty JSON body", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 204 });
    await logoutAccount("http://api.test");

    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toBeUndefined();
    expect(options.headers).toBeUndefined();
    expect(options.credentials).toBe("include");
  });

  it("loginAccount sends a JSON body with a matching Content-Type header", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({ person: { id: "p1" } }) });
    await loginAccount("http://api.test", { email: "a@b.com", password: "pw" });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(options.body)).toEqual({ email: "a@b.com", password: "pw" });
  });

  it("registerAccount sends a JSON body with a matching Content-Type header", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 201, json: async () => ({ person: { id: "p1" } }) });
    await registerAccount("http://api.test", { email: "a@b.com", password: "pw", name: "A" });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(options.body)).toEqual({ email: "a@b.com", password: "pw", name: "A" });
  });

  it("a non-ok response throws with the server's error message", async () => {
    mockFetchOnce({ ok: false, status: 401, json: async () => ({ error: "Invalid email or password" }) });
    await expect(loginAccount("http://api.test", { email: "a@b.com", password: "wrong" })).rejects.toThrow(
      "Invalid email or password"
    );
  });

  it("fetchCurrentSession returns null on an unauthenticated (non-ok) response", async () => {
    mockFetchOnce({ ok: false, status: 401 });
    expect(await fetchCurrentSession("http://api.test")).toBeNull();
  });

  it("fetchCurrentSession returns the parsed session on success", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ personId: "p1" }) });
    expect(await fetchCurrentSession("http://api.test")).toEqual({ personId: "p1" });
  });
});
