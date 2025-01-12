import { serve } from "@hono/node-server";
import { app } from "./hono.js";
import { jetstream } from "./jetstream.js";

jetstream.start();

serve({
	fetch: app.fetch,
	port: 3000,
});
