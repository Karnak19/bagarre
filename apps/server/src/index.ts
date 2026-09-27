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

const server = createServer();
await server.listen(port);
console.log(`[bagarre] server listening on ws://localhost:${port}`);
