import { GAMES_ROUTE, SERVER_PORT } from "@bagarre/shared";
import { createServer } from "./app.ts";

const port = Number(process.env.PORT ?? SERVER_PORT);

// `bagarre-server --healthcheck`: the Docker healthcheck. The runtime image
// has no shell and no curl, so the binary checks its own running copy.
if (process.argv.includes("--healthcheck")) {
  const res = await fetch(`http://127.0.0.1:${port}${GAMES_ROUTE}`, { signal: AbortSignal.timeout(3000) }).catch(
    () => null,
  );
  process.exit(res?.ok ? 0 : 1);
}

// SIGTERM (a redeploy: `docker stop` sends it to the binary, PID 1 in the
// container) and SIGINT run Colyseus' graceful shutdown, which createServer
// turns on: every room is locked, then disconnects its clients with close
// code 4001 (SERVER_SHUTDOWN), which the client shows as "the server is
// restarting"; joins are refused meanwhile (DuelRoom.onAuth), then the
// process exits 0.
const server = createServer();
server.onBeforeShutdown(() => console.log("[bagarre] shutting down: closing every room"));
server.onShutdown(() => console.log("[bagarre] shut down"));
await server.listen(port);
console.log(`[bagarre] server listening on ws://localhost:${port}`);
