import { Application } from "express";
import type { App } from "@slack/bolt";
import * as db from "./db";

export function setupApiRoutes(app: Application, slackClient: App["client"]) {
  // Health check with database connectivity test
  app.get("/api/health", (_, res) => {
    try {
      // Test database connection
      db.getLeaderboard();
      res.json({
        status: "healthy",
        database: "connected",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        status: "unhealthy",
        database: "disconnected",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Get the leaderboard (top 10 users by points)
  app.get("/api/users", async (_, res) => {
    try {
      const users = db.getLeaderboardWithNames();

      // If names are missing in DB, try to fetch from Slack
      const usersWithNames = await Promise.all(
        users.map(async (user) => {
          if (user.name) {
            // Already have name from DB
            return {
              userId: user.user,
              name: user.name,
              points: user.points,
            };
          }

          console.log("Fetching user from Slack", user.user);

          // Try to fetch from Slack if not in DB
          try {
            const slackUser = await slackClient.users.info({ user: user.user });
            const name =
              slackUser.user?.real_name || slackUser.user?.name || "Unknown";
            // Update DB with the name for future use
            db.updateUserName(user.user, name);
            return {
              userId: user.user,
              name: name,
              points: user.points,
            };
          } catch (error) {
            console.error("Failed to fetch user from Slack", error);
            return {
              userId: user.user,
              name: "Unknown",
              points: user.points,
            };
          }
        })
      );

      res.json(usersWithNames);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // Get all open markets
  app.get("/api/markets", (_, res) => {
    try {
      const markets = db.listOpen();
      res.json(markets);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch markets" });
    }
  });

  // Get details for a specific market including betting totals
  app.get("/api/market/:id", (req, res) => {
    try {
      const market = db.market(req.params.id);
      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      const yesTotal = db.sumSide(req.params.id, "yes");
      const noTotal = db.sumSide(req.params.id, "no");

      res.json({
        ...market,
        yesTotal,
        noTotal,
        total: yesTotal + noTotal,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch market" });
    }
  });

  // Get points for a specific user
  app.get("/api/user/:userId/points", (req, res) => {
    try {
      const points = db.pts(req.params.userId);
      res.json({ userId: req.params.userId, points });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user points" });
    }
  });
}
