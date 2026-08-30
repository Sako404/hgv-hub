# docker:cli already has the docker CLI + compose plugin baked in —
# this container talks to the HOST's Docker daemon via the mounted
# socket (see docker-compose.yml), it never runs its own nested daemon.
FROM docker:27-cli
# openssh-client: only used on TrueNAS deployments, to hand off the actual
# container lifecycle to TrueNAS's own middleware (see
# deploy/truenas/README.md and src/index.js) instead of this container
# running `docker compose up/down` itself. Harmless/unused on a plain
# generic deployment (TRUENAS_SSH_HOST unset).
RUN apk add --no-cache nodejs git openssh-client
WORKDIR /updater
COPY updater/src/index.js ./index.js
EXPOSE 4000
# The docker:cli base image's own ENTRYPOINT wraps its CMD as
# arguments to the `docker` binary itself (so a bare `node` CMD gets
# interpreted as `docker node`, the swarm-node subcommand) — must be
# reset here or our CMD never actually runs.
ENTRYPOINT []
CMD ["node", "index.js"]
