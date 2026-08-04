import * as authService from "../services/authService.js";
import { requireSession } from "../middleware/session.middleware.js";
import { SESSION_COOKIE_NAME } from "../config.js";

function setSessionCookie(reply, session) {
  reply.setCookie(SESSION_COOKIE_NAME, session.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
}

/**
 * Un-gated auth entry points — registered as a sibling plugin to
 * collectionsRoutes/atomicRoutes, so Fastify's hook encapsulation keeps
 * requireSession (added inside those plugins) from applying here.
 */
export default async function authRoutes(fastify) {
  fastify.post("/api/auth/register", async (request, reply) => {
    const { email, password, name } = request.body ?? {};
    if (!email || !password) {
      reply.code(400).send({ error: "email and password are required" });
      return;
    }
    try {
      const { person, account, session } = await authService.register(fastify.db, { email, password, name });
      setSessionCookie(reply, session);
      reply.code(201);
      return { person, account: { id: account.id, email: account.email } };
    } catch (err) {
      if (err instanceof authService.AuthError) {
        reply.code(409).send({ error: err.message });
        return;
      }
      throw err;
    }
  });

  fastify.post("/api/auth/login", async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || !password) {
      reply.code(400).send({ error: "email and password are required" });
      return;
    }
    try {
      const { person, account, session } = await authService.login(fastify.db, { email, password });
      setSessionCookie(reply, session);
      return { person, account: { id: account.id, email: account.email } };
    } catch (err) {
      if (err instanceof authService.AuthError) {
        reply.code(401).send({ error: err.message });
        return;
      }
      throw err;
    }
  });

  fastify.post("/api/auth/logout", async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    await authService.logout(fastify.db, sessionId);
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    reply.code(204);
  });

  fastify.get("/api/auth/me", { preHandler: requireSession }, async (request) => {
    return { personId: request.personId };
  });
}
