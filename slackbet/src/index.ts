import "dotenv/config";
import { App, ExpressReceiver } from "@slack/bolt";
import dotenv from "dotenv";
dotenv.config();

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

// /mk "Will we ship by Nov 15?"
app.command("/mk", async ({ ack, command, client, respond }) => {
  await ack();
  const q = (command.text || "").trim().replace(/^"+|"+$/g, "");
  if (!q) {
    return respond('Usage: `/mk "Will we ship by Nov 15?"`');
  }
  await db.ensureUserWithSlackInfo(command.user_id, client);
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
  await db.ensureUserWithSlackInfo(command.user_id, client);
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

  await db.ensureUserWithSlackInfo(userId, client);
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

// /leaderboard
app.command("/leaderboard", async ({ ack, command, client, respond }) => {
  await ack();
  const rows = db.getLeaderboard();
  if (!rows.length) return respond("No players yet.");
  await client.chat.postMessage({
    channel: command.channel_id,
    text: "Top balances",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: rows
            .map((r, i) => `${i + 1}. <@${r.user}> — *${r.points}*`)
            .join("\n"),
        },
      },
    ],
  });
});

(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log("⚡️ listening on", port);
})();
