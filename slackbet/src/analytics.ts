import type { App } from "@slack/bolt";
import cron from "node-cron";
import * as db from "./db";

let appInstance: App;

export function initializeAnalytics(app: App) {
  appInstance = app;

  // Schedule daily summary at 9am
  // Cron format: minute hour day month weekday
  // "0 9 * * *" = At 9:00 AM every day
  cron.schedule("0 9 * * *", () => {
    console.log("Running daily summary at 9am");
    postDailySummary();
  });

  console.log("Daily summary scheduled for 9:00 AM");
}

export async function postDailySummary() {
  const channelId = process.env.DAILY_SUMMARY_CHANNEL;
  if (!channelId) {
    console.log("DAILY_SUMMARY_CHANNEL not set, skipping daily summary");
    return;
  }

  try {
    const markets = db.listOpen();
    const leaderboard = db.getLeaderboard().slice(0, 5); // Top 5 players

    let messageText = "🌅 *Good Morning! Daily Market Summary*\n\n";

    // Markets section
    if (markets.length > 0) {
      messageText += "📈 *Top Active Markets*\n\n";

      const topMarkets = markets.slice(0, 5); // Show top 5 markets
      for (const market of topMarkets) {
        const yesTotal = db.sumSide(market.id, "yes");
        const noTotal = db.sumSide(market.id, "no");
        const total = yesTotal + noTotal;

        let odds = "";
        if (total > 0) {
          const yesPercent = Math.round((yesTotal / total) * 100);
          const noPercent = Math.round((noTotal / total) * 100);
          odds = `YES ${yesPercent}% (${yesTotal}) / NO ${noPercent}% (${noTotal})`;
        } else {
          odds = "No bets yet";
        }

        messageText += `*${market.question}*\n`;
        messageText += `${odds}\n`;
        messageText += `_Market ID: ${market.id}_\n\n`;
      }

      if (markets.length > 5) {
        messageText += `_...and ${markets.length - 5} more markets_\n\n`;
      }
    } else {
      messageText += "📈 *No active markets*\n\n";
    }

    messageText += "---\n\n";

    // Leaderboard section
    if (leaderboard.length > 0) {
      messageText += "🏆 *Top Players*\n\n";

      leaderboard.forEach((r, i) => {
        const rank = i + 1;
        const medal =
          rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}.`;
        const name = r.name || `<@${r.user}>`;
        messageText += `${medal} ${name} — *${r.points}* points\n`;
      });
    } else {
      messageText += "🏆 *No players yet*\n";
    }

    messageText += "\n_Use `/markets` to see all markets and `/leaderboard` for full standings_";

    await appInstance.client.chat.postMessage({
      channel: channelId,
      text: messageText,
    });

    console.log("Daily summary posted successfully");
  } catch (error) {
    console.error("Failed to post daily summary:", error);
  }
}
