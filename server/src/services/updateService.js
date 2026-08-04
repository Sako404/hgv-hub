import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { GITHUB_REPO, UPDATE_CHECK_INTERVAL_MS, UPDATER_BASE_URL } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Baked into the image at build time (see server/Dockerfile — build
// context is the repo root specifically so this file is reachable).
// Overridable for tests.
function readRunningVersion() {
  try {
    return readFileSync(path.join(__dirname, "../../VERSION"), "utf8").trim();
  } catch {
    return "0.0.0";
  }
}

export const RUNNING_VERSION = readRunningVersion();

let cache = null; // { checkedAt: number, latestVersion: string, updateAvailable: boolean }

function stripV(tag) {
  return tag.replace(/^v/, "");
}

/**
 * Compares two "x.y.z" version strings numerically (not lexically —
 * "0.10.0" must sort after "0.9.0", not before it).
 */
function isNewer(latest, running) {
  const a = latest.split(".").map(Number);
  const b = running.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * Polls the public repo's latest GitHub Release (unauthenticated —
 * public repo, and a once-a-day check is well within the unauthenticated
 * rate limit) and caches the result for UPDATE_CHECK_INTERVAL_MS so a
 * burst of client requests never causes a burst of GitHub API calls.
 * @param {{ force?: boolean }} [options]
 */
export async function checkForUpdate({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache && now - cache.checkedAt < UPDATE_CHECK_INTERVAL_MS) {
    return cache;
  }

  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "hgv-hub-update-checker" },
  });
  if (!res.ok) {
    throw new Error(`GitHub releases check failed: ${res.status}`);
  }
  const release = await res.json();
  const latestVersion = stripV(release.tag_name);

  cache = {
    checkedAt: now,
    latestVersion,
    updateAvailable: isNewer(latestVersion, RUNNING_VERSION),
  };
  return cache;
}

/** Triggers the updater sidecar. Never exposed directly — only ever called from an already-authorized route. */
export async function applyUpdate() {
  const res = await fetch(`${UPDATER_BASE_URL}/apply`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Updater request failed: ${res.status}`);
  }
  return res.json();
}
