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
  },
});
