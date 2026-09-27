# The game server as one compiled Bun binary in a distroless image.
# Build context: the repo root (see docker-compose.yml).
#
# The binary is compiled for the architecture the image is built on (amd64 or
# arm64), so the same file works whatever the host is. Nothing from the
# environment is baked in: every variable is read at runtime.
#
# The database schema is created and updated by the binary itself when it
# starts (see src/db.ts): no migration files or tools in the image. PGlite,
# the embedded Postgres used in dev and tests, is left out of the binary.

FROM oven/bun:1.4.0 AS build
WORKDIR /repo

# Manifests first, so the install layer is cached until a dependency changes.
# bunfig.toml keeps linker = "hoisted" (one copy of @colyseus/core).
COPY package.json bun.lock bunfig.toml ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN cd apps/server && bun run build:bin

# glibc + libstdc++, no shell, runs as uid 65532.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /repo/apps/server/dist/bagarre-server /app/bagarre-server
ENV NODE_ENV=production PORT=2567
EXPOSE 2567
USER nonroot
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD ["/app/bagarre-server", "--healthcheck"]
# Exec form, no shell: the binary is PID 1 and receives `docker stop`'s
# SIGTERM itself (a shell form would leave /bin/sh as PID 1, which doesn't
# forward it, and the container would be SIGKILLed after the timeout). On
# SIGTERM the server closes every match with close code 4001, which clients
# show as "the server is restarting", and exits 0 (see src/index.ts).
STOPSIGNAL SIGTERM
ENTRYPOINT ["/app/bagarre-server"]
