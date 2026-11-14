// Entry point. Run with: node server/index.js   (or: npm start / docker compose up)
import { config } from "./config.js";
import { createApp } from "./app.js";

const app = createApp(config);
await app.ready;
app.server.listen(config.port, config.host, () => {
  console.log(`ProspectAI ${config.simulate ? "(demo traffic on) " : ""}listening on http://localhost:${config.port}`);
  if (!config.apiKey) console.warn("API_KEY is not set: write endpoints are open. Set it before exposing this server.");
});

const shutdown = sig => { console.log(`${sig}: shutting down`); app.close().then(() => process.exit(0)); setTimeout(() => process.exit(1), 5000).unref(); };
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
