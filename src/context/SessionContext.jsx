import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { STORAGE_KEYS } from "../storage/keys.js";
import { resolveSession } from "../services/workspaceService.js";
import { ensurePersonalWorkspace } from "../services/driverService.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { registerAccount, loginAccount, logoutAccount, fetchCurrentSession } from "../storage/authClient.js";

const SessionCtx = createContext(null);

/**
 * `db` is handed down from AppBootstrap (already open + migrated) —
 * this provider only resolves the signed-in person's session over it,
 * async, and exposes it as plain reactive state once loaded.
 *
 * `apiBaseUrl` (undefined in local/IndexedDB mode) switches identity
 * resolution from the local-only "pick a person from localStorage"
 * model to a real server-mode auth flow: personId comes exclusively
 * from a live session cookie (checked once via /api/auth/me, then set
 * by register()/login()), never from localStorage or switchPerson — an
 * account maps to exactly one person server-side.
 */
export function SessionProvider({ db, apiBaseUrl, children }) {
  const apiMode = Boolean(apiBaseUrl);

  const [localPersonId, setLocalPersonId] = useState(
    () => globalThis.localStorage?.getItem(STORAGE_KEYS.CURRENT_PERSON_ID) ?? null
  );
  const switchPerson = useCallback((nextPersonId) => {
    globalThis.localStorage?.setItem(STORAGE_KEYS.CURRENT_PERSON_ID, nextPersonId);
    setLocalPersonId(nextPersonId);
  }, []);

  const [authPersonId, setAuthPersonId] = useState(null);
  const [authChecked, setAuthChecked] = useState(!apiMode);

  useEffect(() => {
    if (!apiMode) return;
    let cancelled = false;
    fetchCurrentSession(apiBaseUrl)
      .then(async (result) => {
        const personId = result?.personId ?? null;
        if (personId) {
          // Self-healing: a returning session might belong to an account
          // whose personal-workspace provisioning never completed (e.g.
          // the browser closed mid-register, before this same step ran
          // there) — idempotent, so safe to re-check on every load.
          const person = await db.people.getById(personId);
          if (person) await ensurePersonalWorkspace(person, db);
        }
        if (!cancelled) setAuthPersonId(personId);
      })
      .finally(() => {
        if (!cancelled) setAuthChecked(true);
      });
    return () => {
      cancelled = true;
    };
    // apiBaseUrl/db are fixed for the lifetime of a build/session — this
    // only ever needs to run once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiMode]);

  const login = useCallback(
    async (email, password) => {
      const result = await loginAccount(apiBaseUrl, { email, password });
      // Same self-healing as the mount check above — an existing account
      // logging in for the first time since an interrupted registration
      // must still end up with a personal workspace.
      await ensurePersonalWorkspace(result.person, db);
      setAuthPersonId(result.person.id);
      return result;
    },
    [apiBaseUrl, db]
  );
  const register = useCallback(
    async (email, password, name) => {
      const result = await registerAccount(apiBaseUrl, { email, password, name });
      // A brand-new account has no personal workspace yet — local
      // installs have always gotten one for free via migration 002's
      // hardcoded data; a genuine first-run registration needs this
      // explicit step (see driverService.ensurePersonalWorkspace).
      await ensurePersonalWorkspace(result.person, db);
      setAuthPersonId(result.person.id);
      return result;
    },
    [apiBaseUrl, db]
  );
  const logout = useCallback(async () => {
    await logoutAccount(apiBaseUrl);
    setAuthPersonId(null);
  }, [apiBaseUrl]);

  const personId = apiMode ? authPersonId : localPersonId;
  const isAuthenticated = apiMode ? Boolean(authPersonId) : true;

  const { data: session, loading: sessionLoading } = useAsyncData(
    () => (personId ? resolveSession(personId, db) : Promise.resolve(null)),
    [personId, db]
  );

  const value = useMemo(
    () => ({
      db,
      personId,
      session,
      sessionLoading,
      switchPerson,
      apiMode,
      apiBaseUrl,
      authChecked,
      isAuthenticated,
      canManageServer: session?.canManageServer ?? false,
      login,
      register,
      logout,
    }),
    [db, personId, session, sessionLoading, switchPerson, apiMode, apiBaseUrl, authChecked, isAuthenticated, login, register, logout]
  );

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
