import { Application } from "express";
import * as db from "./db";

export function setupApiRoutes(app: Application) {
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
  app.get("/api/users", (_, res) => {
    try {
      const users = db.getLeaderboard();
      res.json(users);
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
