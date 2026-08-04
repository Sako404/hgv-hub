import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test files share one real Postgres database (deliberate — see
    // test/*.test.js header context: verifying against the real thing,
    // not an in-memory emulator), so they must not run concurrently
    // against it or one file's inserts leak into another's assertions.
    fileParallelism: false,
    env: { NODE_ENV: "test" },
  },
});
