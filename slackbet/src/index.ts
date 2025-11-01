import "dotenv/config";
import { App, ExpressReceiver } from "@slack/bolt";
import dotenv from "dotenv";
dotenv.config();
import cron from "node-cron";

import * as db from "./db";
import { setupApiRoutes } from "./api";

// --- HTTP receiver: one endpoint for commands + interactivity
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  endpoints: "/slack/events",
});
receiver.app.get("/", (_, res) => res.send("ok")); // healthcheck

const app = new App({ token: process.env.SLACK_BOT_TOKEN, receiver });

// Setup API routes with Slack client
setupApiRoutes(receiver.app, app.client);

// Listen for users joining channels to pre-populate them in the database
app.event("member_joined_channel", async ({ event, client }) => {
  try {
    await db.ensureUserWithSlackInfo(event.user, client);
    console.log(`User ${event.user} joined channel, added to database`);
  } catch (error) {
    console.error(`Failed to add user ${event.user} to database:`, error);
  }
});

// Listen for app_mention or when bot is added to a channel to sync all members
app.event("app_mention", async ({ event, client }) => {
  try {
    // Sync all channel members when the bot is mentioned
    const result = await client.conversations.members({
      channel: event.channel,
    });

    if (result.members) {
      await Promise.all(
        result.members.map(async (userId) => {
          try {
            await db.ensureUserWithSlackInfo(userId, client);
          } catch (error) {
            console.error(`Failed to sync user ${userId}:`, error);
          }
        })
      );
      console.log(
        `Synced ${result.members.length} members from channel ${event.channel}`
      );
    }
  } catch (error) {
    console.error("Failed to sync channel members:", error);
  }
});

// /mk "Will we ship by Nov 15?"
app.command("/mk", async ({ ack, command, client, respond }) => {
  await ack();
  const q = (command.text || "").trim().replace(/^"+|"+$/g, "");
  if (!q) {
    return respond('Usage: `/mk "Will we ship by Nov 15?"`');
  }

  const id = db.createMarket(q, command.user_id);
  await client.chat.postMessage({
    channel: command.channel_id,
    text: `Market ${id}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${q}*` } },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `Market *${id}* • by <@${command.user_id}>` },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Bet YES" },
            action_id: "bet_yes",
            value: id,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Bet NO" },
            action_id: "bet_no",
            value: id,
          },
        ],
      },
    ],
  });
});

// /bet mABC yes 50
app.command("/bet", async ({ ack, command, client, respond }) => {
  await ack();
  const [id, sideRaw, amtRaw] = (command.text || "").trim().split(/\s+/);
  const side = (sideRaw || "").toLowerCase();
  const amt = parseInt(amtRaw, 10);
  if (!id || !["yes", "no"].includes(side) || !Number.isFinite(amt) || amt <= 0)
    return respond("Usage: `/bet <market_id> <yes|no> <points>`");
  const m = db.market(id);
  if (!m || m.status !== "open") return respond("Market not found or closed.");

  if (db.pts(command.user_id) < amt)
    return respond(`Insufficient points. Balance: ${db.pts(command.user_id)}`);
  db.placeBet(id, command.user_id, side as "yes" | "no", amt);
  await client.chat.postMessage({
    channel: command.channel_id,
    text: `Bet placed: *${amt}* on *${side.toUpperCase()}* in *${id}* • YES ${db.sumSide(
      id,
      "yes"
    )} / NO ${db.sumSide(id, "no")} • Your balance ${db.pts(command.user_id)}`,
  });
});

// quick bet buttons: open modal for stake input
app.action(/bet_(yes|no)/, async ({ ack, body, action, client }) => {
  await ack();
  const buttonAction = action as any;
  const side = buttonAction.action_id.endsWith("yes") ? "yes" : "no";
  const id = buttonAction.value;

  // Open a modal to ask for stake amount
  await client.views.open({
    trigger_id: (body as any).trigger_id,
    view: {
      type: "modal",
      callback_id: `bet_modal_${side}_${id}`,
      title: {
        type: "plain_text",
        text: `Bet ${side.toUpperCase()}`,
      },
      submit: {
        type: "plain_text",
        text: "Place Bet",
      },
      close: {
        type: "plain_text",
        text: "Cancel",
      },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Market:* ${id}\n*Your balance:* ${db.pts((body as any).user.id)} points`,
          },
        },
        {
          type: "input",
          block_id: "stake_block",
          label: {
            type: "plain_text",
            text: "Stake (points)",
          },
          element: {
            type: "number_input",
            action_id: "stake_input",
            is_decimal_allowed: false,
            min_value: "1",
          },
        },
      ],
    },
  });
});

// Handle modal submission for custom stakes
app.view(/bet_modal_/, async ({ ack, body, view, client }) => {
  await ack();

  const userId = (body as any).user.id;
  const stakeStr = view.state.values.stake_block.stake_input.value;
  const stake = parseInt(stakeStr || "0", 10);

  // Extract side and market ID from callback_id
  const callbackId = view.callback_id;
  const match = callbackId.match(/bet_modal_(yes|no)_(.+)/);
  if (!match || !match[2]) return;

  const side = match[1] as "yes" | "no";
  const marketId = match[2];

  // Validate
  const m = db.market(marketId);
  if (!m || m.status !== "open") {
    await client.chat.postEphemeral({
      channel: userId,
      user: userId,
      text: "Market not found or closed.",
    });
    return;
  }

  const balance = db.pts(userId);

  if (balance < stake) {
    await client.chat.postEphemeral({
      channel: userId,
      user: userId,
      text: `Insufficient points. You have ${balance}, but need ${stake}.`,
    });
    return;
  }

  if (stake <= 0) {
    await client.chat.postEphemeral({
      channel: userId,
      user: userId,
      text: "Stake must be greater than 0.",
    });
    return;
  }

  // Place the bet
  db.placeBet(marketId, userId, side, stake);

  await client.chat.postEphemeral({
    channel: userId,
    user: userId,
    text: `Bet placed: *${stake}* on *${side.toUpperCase()}* in *${marketId}* • YES ${db.sumSide(
      marketId,
      "yes"
    )} / NO ${db.sumSide(marketId, "no")} • Your balance: ${db.pts(userId)}`,
  });
});

// /markets
app.command("/markets", async ({ ack, command, client, respond }) => {
  await ack();
  const rows = db.listOpen();
  if (!rows.length) return respond("No open markets.");
  const lines = rows
    .map((m) => `*${m.id}* — ${m.question} _(open)_`)
    .join("\n");
  await client.chat.postMessage({
    channel: command.channel_id,
    text: "Open markets",
    blocks: [{ type: "section", text: { type: "mrkdwn", text: lines } }],
  });
});

// /resolve mABC yes
app.command("/resolve", async ({ ack, command, client, respond }) => {
  await ack();
  const [id, outRaw] = (command.text || "").trim().split(/\s+/);
  const out = (outRaw || "").toLowerCase();
  if (!id || !["yes", "no"].includes(out))
    return respond("Usage: `/resolve <market_id> <yes|no>`");
  const m = db.market(id);
  if (!m) return respond("Market not found.");
  if (m.status !== "open") return respond(`Market already ${m.status}.`);
  const result = db.resolveMarket(id, out as "yes" | "no");
  if (!result) return respond("Error resolving market.");
  await client.chat.postMessage({
    channel: command.channel_id,
    text: `Resolved *${id}* → *${out.toUpperCase()}* • YES ${result.yes} / NO ${result.no} • Total ${result.total}`,
  });
});

// /mybets - Show all markets where user has active bets
app.command("/recall", async ({ ack, command, client, respond }) => {
  await ack();
  const bets = db.getUserBets(command.user_id);

  if (!bets.length) {
    return respond("You haven't placed any bets yet.");
  }

  // Group bets by market
  const marketBets = new Map<
    string,
    {
      question: string;
      status: string;
      bets: Array<{ side: string; amount: number }>;
    }
  >();

  for (const bet of bets) {
    if (!marketBets.has(bet.market_id)) {
      marketBets.set(bet.market_id, {
        question: bet.question,
        status: bet.status,
        bets: [],
      });
    }
    marketBets.get(bet.market_id)!.bets.push({
      side: bet.side,
      amount: bet.amount,
    });
  }

  // Build message text
  let messageText = "📊 *Your Bets*\n\n";

  for (const [marketId, data] of marketBets) {
    const yesTotal = db.sumSide(marketId, "yes");
    const noTotal = db.sumSide(marketId, "no");
    const totalStaked = data.bets.reduce((sum, b) => sum + b.amount, 0);

    const statusEmoji =
      data.status === "open"
        ? "🟢"
        : data.status.startsWith("resolved")
          ? "🔒"
          : "⚫";
    const statusText =
      data.status === "open"
        ? "Open"
        : data.status.replace("resolved_", "Resolved: ").toUpperCase();

    const betsList = data.bets
      .map((b) => `• ${b.side.toUpperCase()}: ${b.amount} points`)
      .join("\n");

    messageText += `*${data.question}*\n`;
    messageText += `${betsList}\n\n`;
    messageText += `*Market:* YES ${yesTotal} / NO ${noTotal}\n`;
    messageText += `*Status:* ${statusEmoji} ${statusText}\n`;
    messageText += `_Market ID: ${marketId} • Your stake: ${totalStaked} points_\n`;
    messageText += `\n---\n\n`;
  }

  await client.chat.postMessage({
    channel: command.channel_id,
    text: messageText,
  });
});

// /summary - Manual trigger for daily summary (useful for testing)
app.command("/summary", async ({ ack }) => {
  await ack();
  await postDailySummary();
});

// /leaderboard
app.command("/leaderboard", async ({ ack, command, client, respond }) => {
  await ack();
  const rows = db.getLeaderboard();
  if (!rows.length) return respond("No players yet.");

  // Format leaderboard entries with medals for top 3
  const leaderboardText = rows
    .map((r, i) => {
      const rank = i + 1;
      const medal =
        rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}.`;
      const name = r.name || `<@${r.user}>`;
      return `${medal} ${name} — *${r.points}* points`;
    })
    .join("\n");

  await client.chat.postMessage({
    channel: command.channel_id,
    text: "Leaderboard",
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🏆 Leaderboard",
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: leaderboardText,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Total players: ${rows.length}`,
          },
        ],
      },
    ],
  });
});

// Daily summary function
async function postDailySummary() {
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

    await app.client.chat.postMessage({
      channel: channelId,
      text: messageText,
    });

    console.log("Daily summary posted successfully");
  } catch (error) {
    console.error("Failed to post daily summary:", error);
  }
}

(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log("⚡️ listening on", port);

  // Schedule daily summary at 9am
  // Cron format: minute hour day month weekday
  // "0 9 * * *" = At 9:00 AM every day
  cron.schedule("0 9 * * *", () => {
    console.log("Running daily summary at 9am");
    postDailySummary();
  });

  console.log("Daily summary scheduled for 9:00 AM");
})();
