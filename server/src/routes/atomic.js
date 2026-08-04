import { resolveCollectionTable } from "../db/collections.js";
import { requireSession } from "../middleware/session.middleware.js";

/**
 * Mirrors the client's db.insertAtomic(writes) contract
 * (src/storage/db.js): an array of {collection, item}, all inserted in
 * one real transaction — the server-side equivalent of that helper's
 * IndexedDB-transaction backend, used by driverService.js's two
 * multi-collection inserts (Person+Membership, RateCard version chain).
 */
export default async function atomicRoutes(fastify) {
  fastify.addHook("preHandler", requireSession);

  fastify.post("/api/atomic", async (request, reply) => {
    const writes = request.body;
    if (!Array.isArray(writes) || writes.length === 0) {
      reply.code(400).send({ error: "Expected a non-empty array of {collection, item} writes" });
      return;
    }

    const tables = writes.map((write) => {
      const table = resolveCollectionTable(write.collection);
      if (!table) {
        throw new Error(`Unknown collection: ${write.collection}`);
      }
      return table;
    });

    try {
      await fastify.db.transaction(async (tx) => {
        for (let i = 0; i < writes.length; i += 1) {
          await tx.insert(tables[i]).values(writes[i].item);
        }
      });
    } catch (err) {
      reply.code(400).send({ error: err.message });
      return;
    }

    reply.code(204);
  });
}
