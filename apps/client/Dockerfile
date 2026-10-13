# The client: a Vite static build served by Caddy, which also proxies
# /colyseus/* to the game server. Build context: the repo root.
#
# VITE_* values are public (they end up in the browser bundle), which is why
# they are build args and not runtime env.

FROM oven/bun:1.4.2 AS build
WORKDIR /repo

COPY package.json bun.lock bunfig.toml ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/client apps/client

# A path: the browser talks to the game server through this same origin.
ARG VITE_SERVER_URL=/colyseus
ENV VITE_SERVER_URL=$VITE_SERVER_URL

# Error tracking (Sentry protocol): the same public Rustrak key as the server's
# SENTRY_DSN, passed by docker-compose.yaml's client build args. A bare
# `docker build` without compose passes none, so the client reports nothing.
ARG VITE_SENTRY_DSN
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN

# The Rustrak release tag inlined into the bundle at build time (Vite exposes
# VITE_* env vars to import.meta.env). Passed by docker-compose.yaml from
# SENTRY_RELEASE / SOURCE_COMMIT; a bare `docker build` gets none, so the
# client reports without a release.
ARG SENTRY_RELEASE
ENV VITE_SENTRY_RELEASE=$SENTRY_RELEASE
RUN cd apps/client && bun run build

FROM caddy:2-alpine
COPY apps/client/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/client/dist /srv
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
