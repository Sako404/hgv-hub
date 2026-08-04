// Small local application-settings store — UI/app preferences (not
// domain data), deliberately outside the storage/ Repository layer used
// for Workspace/Person/Shift/etc. Backed by one JSON blob in
// localStorage today; swapping to a backend-synced store later only
// means changing the two functions below, not any caller.

const SETTINGS_KEY = "wt-app-settings";

function readAll() {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(settings) {
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable — setting just won't persist
  }
}

export function getAppSetting(key, fallback) {
  const all = readAll();
  return key in all ? all[key] : fallback;
}

export function setAppSetting(key, value) {
  const all = readAll();
  all[key] = value;
  writeAll(all);
}
