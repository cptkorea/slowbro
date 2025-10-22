import "dotenv/config";
import { App, ExpressReceiver } from "@slack/bolt";
import dotenv from "dotenv";
dotenv.config();

import * as db from "./db";

// --- HTTP receiver: one endpoint for commands + interactivity
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  endpoints: "/slack/events",
});
receiver.app.get("/", (_, res) => res.send("ok")); // healthcheck

const app = new App({ token: process.env.SLACK_BOT_TOKEN, receiver });

// /mk "Will we ship by Nov 15?"
app.command("/mk", async ({ ack, command, respond }) => {
  await ack();
  const q = (command.text || "").trim().replace(/^"+|"+$/g, "");
  if (!q) return respond('Usage: `/mk "Will we ship by Nov 15?"`');
  db.ensureUser(command.user_id);
  const id = db.createMarket(q, command.user_id);
  await respond({
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
app.command("/bet", async ({ ack, command, respond }) => {
  await ack();
  const [id, sideRaw, amtRaw] = (command.text || "").trim().split(/\s+/);
  const side = (sideRaw || "").toLowerCase();
  const amt = parseInt(amtRaw, 10);
  if (!id || !["yes", "no"].includes(side) || !Number.isFinite(amt) || amt <= 0)
    return respond("Usage: `/bet <market_id> <yes|no> <points>`");
  const m = db.market(id);
  if (!m || m.status !== "open") return respond("Market not found or closed.");
  db.ensureUser(command.user_id);
  if (db.pts(command.user_id) < amt)
    return respond(`Insufficient points. Balance: ${db.pts(command.user_id)}`);
  db.placeBet(id, command.user_id, side as "yes" | "no", amt);
  await respond(
    `Bet placed: *${amt}* on *${side.toUpperCase()}* in *${id}* • YES ${db.sumSide(
      id,
      "yes"
    )} / NO ${db.sumSide(id, "no")} • Your balance ${db.pts(command.user_id)}`
  );
});

// quick bet buttons: 10 points
app.action(/bet_(yes|no)/, async ({ ack, body, action, client }) => {
  await ack();
  const buttonAction = action as any;
  const side = buttonAction.action_id.endsWith("yes") ? "yes" : "no";
  const id = buttonAction.value;
  const m = db.market(id);
  if (!m || m.status !== "open") return;
  const user = body.user.id;
  db.ensureUser(user);
  if (db.pts(user) < 10) {
    await client.chat.postEphemeral({
      channel: (body as any).container.channel_id,
      user,
      text: "Need 10 points.",
    });
    return;
  }
  db.placeBet(id, user, side, 10);
  await client.chat.postEphemeral({
    channel: (body as any).container.channel_id,
    user,
    text: `Quick bet: 10 on ${side.toUpperCase()} • YES ${db.sumSide(
      id,
      "yes"
    )} / NO ${db.sumSide(id, "no")} • Balance ${db.pts(user)}`,
  });
});

// /markets
app.command("/markets", async ({ ack, respond }) => {
  await ack();
  const rows = db.listOpen();
  if (!rows.length) return respond("No open markets.");
  const lines = rows
    .map((m) => `*${m.id}* — ${m.question} _(open)_`)
    .join("\n");
  await respond({
    text: "Open markets",
    blocks: [{ type: "section", text: { type: "mrkdwn", text: lines } }],
  });
});

// /resolve mABC yes
app.command("/resolve", async ({ ack, command, respond }) => {
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
  await respond(
    `Resolved *${id}* → *${out.toUpperCase()}* • YES ${result.yes} / NO ${result.no} • Total ${result.total}`
  );
});

// /leaderboard
app.command("/leaderboard", async ({ ack, respond }) => {
  await ack();
  const rows = db.getLeaderboard();
  if (!rows.length) return respond("No players yet.");
  await respond({
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
