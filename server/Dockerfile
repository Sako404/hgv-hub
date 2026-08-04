FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3001
# drizzle-kit is a devDependency but needed at container start — every
# start re-runs migrations (idempotent, drizzle-kit tracks what's
# already applied), so a self-hosted deployment never needs a separate
# manual migrate step.
CMD ["sh", "-c", "npx drizzle-kit migrate && node src/index.js"]
