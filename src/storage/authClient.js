/**
 * Thin fetch wrapper for the server's /api/auth/* endpoints — used only
 * in server (API) mode, by SessionContext. Not part of the Repository
 * contract (accounts/sessions aren't client domain entities), so it
 * lives alongside ApiRepository.js rather than in src/services/.
 */
async function authFetch(baseUrl, path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    credentials: "include",
    // Only set a JSON content type when there's actually a body —
    // Fastify's default JSON body parser rejects an empty body sent
    // with this header as invalid JSON (400), which logout() (no
    // body) hit every time.
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined;
  return res.json();
}

export function registerAccount(baseUrl, { email, password, name }) {
  return authFetch(baseUrl, "/api/auth/register", { body: JSON.stringify({ email, password, name }) });
}

export function loginAccount(baseUrl, { email, password }) {
  return authFetch(baseUrl, "/api/auth/login", { body: JSON.stringify({ email, password }) });
}

export function logoutAccount(baseUrl) {
  return authFetch(baseUrl, "/api/auth/logout");
}

/** Returns { personId } for a live session cookie, or null if unauthenticated. */
export async function fetchCurrentSession(baseUrl) {
  const res = await fetch(`${baseUrl}/api/auth/me`, { credentials: "include" });
  if (!res.ok) return null;
  return res.json();
}
