import "dotenv/config";
import { App, ExpressReceiver } from "@slack/bolt";
import dotenv from "dotenv";
dotenv.config();

import { setupApiRoutes } from "./api";
import { registerCommands } from "./commands";
import { registerViews } from "./views";
import { initializeAnalytics } from "./analytics";

// --- HTTP receiver: one endpoint for commands + interactivity
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  endpoints: "/slack/events",
});
receiver.app.get("/", (_, res) => res.send("ok")); // healthcheck

const app = new App({ token: process.env.SLACK_BOT_TOKEN, receiver });

// Setup API routes with Slack client
setupApiRoutes(receiver.app, app.client);

// Register all commands
registerCommands(app);

// Register all views, actions, and event handlers
registerViews(app);

// Initialize analytics and scheduled tasks
initializeAnalytics(app);

(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log("⚡️ listening on", port);
})();
