# The client: a Vite static build served by Caddy, which also proxies
# /colyseus/* to the game server. Build context: the repo root.
#
# VITE_* values are public (they end up in the browser bundle), which is why
# they are build args and not runtime env.

FROM oven/bun:1.4.0 AS build
WORKDIR /repo

COPY package.json bun.lock bunfig.toml ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
RUN bun install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/backend packages/backend
COPY apps/client apps/client

ARG VITE_CLERK_PUBLISHABLE_KEY=
ARG VITE_CONVEX_URL=
# A path: the browser talks to the game server through this same origin.
ARG VITE_SERVER_URL=/colyseus
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY \
    VITE_CONVEX_URL=$VITE_CONVEX_URL \
    VITE_SERVER_URL=$VITE_SERVER_URL
RUN cd apps/client && bun run build

FROM caddy:2-alpine
COPY apps/client/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/client/dist /srv
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
