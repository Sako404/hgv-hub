import { resolveSession } from "../services/authService.js";
import { SESSION_COOKIE_NAME } from "../config.js";

/**
 * Reads the httpOnly session cookie, loads the session, and attaches
 * request.personId/request.accountId — or 401s. Fastify hook
 * encapsulation means this only needs registering inside the plugins
 * that require auth (collections, atomic); auth routes themselves
 * (register/login/logout) are registered as sibling plugins and never
 * see this hook.
 */
export async function requireSession(request, reply) {
  const sessionId = request.cookies[SESSION_COOKIE_NAME];
  const resolved = await resolveSession(request.server.db, sessionId);
  if (!resolved) {
    reply.code(401).send({ error: "Not authenticated" });
    return reply;
  }
  request.personId = resolved.account.personId;
  request.accountId = resolved.account.id;
}
