import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const { Pool } = pg;

// Single shared pg.Pool for the process lifetime — same singleton
// pattern smoke-and-steel's server/src/db/pool.js already uses.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on("error", (err) => {
  // An idle client emitting an error (e.g. connection dropped) is a
  // process-level problem, not a per-request one — matches
  // smoke-and-steel's own pool error handling.
  // eslint-disable-next-line no-console
  console.error("Unexpected Postgres pool error", err);
  process.exit(1);
});

export const db = drizzle(pool, { schema });
