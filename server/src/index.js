import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { db } from "./db/pool.js";
import { seedDefaultComplianceProfile } from "./db/seed.js";
import collectionsRoutes from "./routes/collections.js";
import atomicRoutes from "./routes/atomic.js";
import authRoutes from "./routes/auth.js";
import updatesRoutes from "./routes/updates.js";
import { RUNNING_VERSION } from "./services/updateService.js";

export async function buildApp() {
  const fastify = Fastify({ logger: process.env.NODE_ENV !== "test" });

  fastify.decorate("db", db);
  await seedDefaultComplianceProfile(db);

  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN?.split(",") ?? true,
    credentials: true,
  });
  await fastify.register(cookie);

  // collectionsRoutes/atomicRoutes each register their own requireSession
  // preHandler hook (Fastify plugin encapsulation keeps it from leaking
  // into authRoutes, which must stay reachable before a session exists).
  await fastify.register(authRoutes);
  await fastify.register(collectionsRoutes);
  await fastify.register(atomicRoutes);
  await fastify.register(updatesRoutes);

  fastify.get("/api/health", async () => ({ ok: true, version: RUNNING_VERSION }));

  return fastify;
}

async function start() {
  const fastify = await buildApp();
  const port = Number(process.env.PORT ?? 3001);
  try {
    await fastify.listen({ port, host: "0.0.0.0" });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  start();
}
