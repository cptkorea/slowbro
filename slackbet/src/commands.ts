import type { App } from "@slack/bolt";
import { postDailySummary } from "./analytics";
import * as handlers from "./commandHandlers";

export function registerCommands(app: App) {
  // /mk "Will we ship by Nov 15?"
  app.command("/mk", async ({ ack, command, client, respond }) => {
    await ack();
    const q = (command.text || "").trim().replace(/^"+|"+$/g, "");

    const result = handlers.handleCreateMarket(q, command.user_id);

    if (!result.success) {
      return respond(result.error!);
    }

    const id = result.marketId!;
    await client.chat.postMessage({
      channel: command.channel_id,
      text: `Market ${id}`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*${q}*` } },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Market *${id}* • by <@${command.user_id}>`,
            },
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
    const amt = parseInt(amtRaw, 10);

    const result = handlers.handlePlaceBet(
      id,
      sideRaw || "",
      amt,
      command.user_id
    );

    if (!result.success) {
      return respond(result.error!);
    }

    await client.chat.postMessage({
      channel: command.channel_id,
      text: result.message!,
    });
  });

  // /markets
  app.command("/markets", async ({ ack, command, client, respond }) => {
    await ack();

    const result = handlers.handleListMarkets();

    if (!result.success) {
      return respond(result.error!);
    }

    const lines = result
      .markets!.map((m) => `*${m.id}* — ${m.question} _(open)_`)
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

    const result = handlers.handleResolveMarket(id, outRaw || "");

    if (!result.success) {
      return respond(result.error!);
    }

    await client.chat.postMessage({
      channel: command.channel_id,
      text: result.message!,
    });
  });

  // /recall - Show all markets where user has active bets
  app.command("/recall", async ({ ack, command, client, respond }) => {
    await ack();

    const result = handlers.handleGetUserBets(command.user_id);

    if (!result.success) {
      return respond(result.error!);
    }

    const messageText = handlers.formatUserBetsMessage(result.marketBets!);

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

    const result = handlers.handleGetLeaderboard();

    if (!result.success) {
      return respond(result.error!);
    }

    const leaderboardText = handlers.formatLeaderboardText(result.leaderboard!);

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
              text: `Total players: ${result.leaderboard!.length}`,
            },
          ],
        },
      ],
    });
  });
}
