import { SERVER_PORT } from "@bagarre/shared";
import { createServer } from "./app.ts";

const port = Number(process.env.PORT ?? SERVER_PORT);
const server = createServer();
await server.listen(port);
console.log(`[bagarre] server listening on ws://localhost:${port}`);
