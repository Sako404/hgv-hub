import { resolveCollectionTable } from "../db/collections.js";
import { DrizzleRepository } from "../repository/drizzleRepository.js";
import { requireSession } from "../middleware/session.middleware.js";

/**
 * Generic REST surface over every collection, mirroring the client's
 * own Repository contract (getById/getAll/query/insert/update/remove/
 * replaceAll) rather than bespoke per-resource routes — access control
 * and business rules stay in the client-side service layer, which just
 * swaps IndexedDbRepository for ApiRepository (see the backend plan).
 *
 * Every route here requires a valid session (requireSession runs
 * first); auth routes themselves live in a sibling plugin that never
 * sees this hook, per Fastify's plugin encapsulation.
 */
export default async function collectionsRoutes(fastify) {
  fastify.addHook("preHandler", requireSession);

  fastify.addHook("preHandler", async (request, reply) => {
    const table = resolveCollectionTable(request.params.collection);
    if (!table) {
      reply.code(404).send({ error: `Unknown collection: ${request.params.collection}` });
      return;
    }
    request.repository = new DrizzleRepository(fastify.db, table);
  });

  fastify.get("/api/:collection", async (request) => {
    const { where } = request.query;
    if (where) {
      return request.repository.query({ where: JSON.parse(where) });
    }
    return request.repository.getAll();
  });

  fastify.get("/api/:collection/:id", async (request, reply) => {
    const item = await request.repository.getById(request.params.id);
    if (!item) {
      reply.code(404).send({ error: "Not found" });
      return;
    }
    return item;
  });

  fastify.post("/api/:collection", async (request, reply) => {
    const item = await request.repository.insert(request.body);
    reply.code(201);
    return item;
  });

  fastify.patch("/api/:collection/:id", async (request, reply) => {
    try {
      return await request.repository.update(request.params.id, request.body);
    } catch (err) {
      reply.code(404).send({ error: err.message });
    }
  });

  fastify.delete("/api/:collection/:id", async (request, reply) => {
    await request.repository.remove(request.params.id);
    reply.code(204);
  });

  fastify.put("/api/:collection", async (request, reply) => {
    await request.repository.replaceAll(request.body);
    reply.code(204);
  });
}
