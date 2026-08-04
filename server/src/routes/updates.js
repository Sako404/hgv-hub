import { eq } from "drizzle-orm";
import { memberships } from "../db/schema.js";
import { requireSession } from "../middleware/session.middleware.js";
import { checkForUpdate, applyUpdate, RUNNING_VERSION } from "../services/updateService.js";

const SERVER_MANAGEABLE_ROLES = ["owner", "admin"];

/**
 * Owner/admin in ANY workspace, personal included — deliberately NOT
 * the client's managerialMemberships concept (src/services/
 * workspaceService.js), which excludes the personal workspace so the
 * company-workspace switcher never appears for a solo driver. A solo
 * driver's own personal-workspace `owner` role (granted automatically
 * by ensurePersonalWorkspace/migration 002 to every account) is
 * exactly who should be able to manage THEIR OWN server.
 */
async function requireServerManager(request, reply) {
  const rows = await request.server.db.select().from(memberships).where(eq(memberships.personId, request.personId));
  const canManage = rows.some((m) => (m.roles ?? []).some((r) => SERVER_MANAGEABLE_ROLES.includes(r)));
  if (!canManage) {
    reply.code(403).send({ error: "Only an owner/admin can manage server updates" });
    return reply;
  }
}

export default async function updatesRoutes(fastify) {
  fastify.addHook("preHandler", requireSession);
  fastify.addHook("preHandler", requireServerManager);

  fastify.get("/api/updates/status", async (request, reply) => {
    try {
      const result = await checkForUpdate();
      return { runningVersion: RUNNING_VERSION, ...result };
    } catch (err) {
      reply.code(502).send({ error: err.message });
    }
  });

  fastify.post("/api/updates/apply", async (request, reply) => {
    try {
      const status = await checkForUpdate();
      if (!status.updateAvailable) {
        reply.code(400).send({ error: "No update available" });
        return;
      }
      return await applyUpdate();
    } catch (err) {
      reply.code(502).send({ error: err.message });
    }
  });
}
