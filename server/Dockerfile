# Build context is the repo root (see docker-compose.yml), not
# server/, so this image can also read the root VERSION file — the
# same pattern Dockerfile.client already uses to reach src/.
FROM node:20-slim
WORKDIR /app
COPY server/package*.json ./
RUN npm install
COPY server/. .
COPY VERSION ./VERSION
EXPOSE 3001
# drizzle-kit is a devDependency but needed at container start — every
# start re-runs migrations (idempotent, drizzle-kit tracks what's
# already applied), so a self-hosted deployment never needs a separate
# manual migrate step.
CMD ["sh", "-c", "npx drizzle-kit migrate && node src/index.js"]
