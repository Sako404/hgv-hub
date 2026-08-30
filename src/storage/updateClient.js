/**
 * Thin fetch wrapper for the server's /api/updates/* endpoints — used
 * only in server (API) mode, by UpdateBanner. Mirrors authClient.js's
 * shape (credentials included for the session cookie, same error
 * handling), not part of the Repository contract since updates aren't
 * a client domain entity.
 */
async function updatesFetch(baseUrl, path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    credentials: "include",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export function fetchUpdateStatus(baseUrl) {
  return updatesFetch(baseUrl, "/api/updates/status");
}

export function applyUpdate(baseUrl) {
  return updatesFetch(baseUrl, "/api/updates/apply", { method: "POST" });
}

/** Progress of an in-flight (or just-finished) update — see UpdateBanner.jsx,
 * which polls this after applyUpdate() resolves, since accepting the
 * request is not the same as the update having actually succeeded. */
export function fetchApplyStatus(baseUrl) {
  return updatesFetch(baseUrl, "/api/updates/apply/status");
}
