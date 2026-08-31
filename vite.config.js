import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  test: {
    environment: "node",
    setupFiles: ["./test/setup.js"],
    // server/ is an independent package with its own vitest config and
    // real-Postgres-backed tests — the client runner must not pick it up.
    exclude: ["**/node_modules/**", "server/**"],
    // Vitest's default testTimeout is 5000ms. The heaviest end-to-end UI
    // flows run in roughly 1-2s on a development machine, but CI runners are
    // measurably slower — the same suite takes ~7.5s locally and ~19.6s on
    // GitHub Actions, about 2.7x — which puts those flows over the default
    // and fails them with "Test timed out", not with a disagreeing assertion.
    //
    // Headroom for the environment, not a relaxed assertion: every test still
    // has to reach the same end state. Kept well above Testing Library's
    // asyncUtilTimeout (5000ms, set in test/setup.js) so a genuinely missing
    // element still reports the useful "Unable to find an element" error
    // rather than a bare timeout.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
