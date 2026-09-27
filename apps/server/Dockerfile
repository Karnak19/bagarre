# The game server as one compiled Bun binary in a distroless image.
# Build context: the repo root (see docker-compose.yml).
#
# The binary is compiled for the architecture the image is built on (amd64 or
# arm64), so the same file works whatever the host is. Nothing from the
# environment is baked in: every variable is read at runtime.

FROM oven/bun:1.4.0 AS build
WORKDIR /repo

# Manifests first, so the install layer is cached until a dependency changes.
# bunfig.toml keeps linker = "hoisted" (one copy of @colyseus/core).
COPY package.json bun.lock bunfig.toml ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
RUN bun install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/backend packages/backend
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
ENTRYPOINT ["/app/bagarre-server"]
