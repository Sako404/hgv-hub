import { useCallback, useState } from "react";

// UI-only preference (not domain data), so it deliberately lives outside
// the storage/ Repository abstraction and STORAGE_KEYS.
const COLLAPSED_KEY = "wt-shell-sidebar-collapsed";

function readInitial() {
  try {
    return globalThis.localStorage?.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function useSidebarCollapsed() {
  const [collapsed, setCollapsedState] = useState(readInitial);

  const setCollapsed = useCallback((next) => {
    setCollapsedState(next);
    try {
      globalThis.localStorage?.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // localStorage unavailable — collapse state just won't persist
    }
  }, []);

  const toggle = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);

  return { collapsed, setCollapsed, toggle };
}
