import type { App } from "@slack/bolt";
import { postDailySummary } from "./analytics";
import * as handlers from "./commandHandlers";

export function registerCommands(app: App) {
  // /mk - Open modal to create a market with multiple outcomes
  app.command("/mk", async ({ ack, body, client, command }) => {
    await ack();

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "create_market_modal",
        private_metadata: command.channel_id, // Store channel ID for later use
        title: {
          type: "plain_text",
          text: "Create Market",
        },
        submit: {
          type: "plain_text",
          text: "Create",
        },
        close: {
          type: "plain_text",
          text: "Cancel",
        },
        blocks: [
          {
            type: "input",
            block_id: "question_block",
            label: {
              type: "plain_text",
              text: "Question",
            },
            element: {
              type: "plain_text_input",
              action_id: "question_input",
              placeholder: {
                type: "plain_text",
                text: "Will we ship by Nov 15?",
              },
            },
          },
          {
            type: "input",
            block_id: "outcome1_block",
            label: {
              type: "plain_text",
              text: "Outcome 1",
            },
            element: {
              type: "plain_text_input",
              action_id: "outcome1_input",
              placeholder: {
                type: "plain_text",
                text: "Yes",
              },
            },
          },
          {
            type: "input",
            block_id: "outcome2_block",
            label: {
              type: "plain_text",
              text: "Outcome 2",
            },
            element: {
              type: "plain_text_input",
              action_id: "outcome2_input",
              placeholder: {
                type: "plain_text",
                text: "No",
              },
            },
          },
          {
            type: "input",
            block_id: "outcome3_block",
            optional: true,
            label: {
              type: "plain_text",
              text: "Outcome 3 (optional)",
            },
            element: {
              type: "plain_text_input",
              action_id: "outcome3_input",
            },
          },
          {
            type: "input",
            block_id: "outcome4_block",
            optional: true,
            label: {
              type: "plain_text",
              text: "Outcome 4 (optional)",
            },
            element: {
              type: "plain_text_input",
              action_id: "outcome4_input",
            },
          },
          {
            type: "input",
            block_id: "outcome5_block",
            optional: true,
            label: {
              type: "plain_text",
              text: "Outcome 5 (optional)",
            },
            element: {
              type: "plain_text_input",
              action_id: "outcome5_input",
            },
          },
        ],
      },
    });
  });

  // /bet mABC outcome_name 50
  app.command("/bet", async ({ ack, command, client, respond }) => {
    await ack();

    const parts = (command.text || "").trim().split(/\s+/);

    // Handle both 2 and 3 arguments (outcome name might have been quoted and contain spaces)
    // Format: /bet <market_id> <outcome_name> <amount>
    if (parts.length < 3) {
      return respond(
        "Usage: `/bet <market_id> <outcome_name> <points>`\n" +
          "Example: `/bet m123abc Yes 100` or `/bet m123abc Alice 50`"
      );
    }

    const marketId = parts[0];
    const amount = parseInt(parts[parts.length - 1], 10);
    const outcomeName = parts.slice(1, -1).join(" ");

    const result = handlers.handlePlaceBet(
      marketId,
      outcomeName,
      amount,
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

    await client.chat.postMessage({
      channel: command.channel_id,
      text: result.message!,
      blocks: result.blocks,
    });
  });

  // /resolve mABC outcome_name
  app.command("/resolve", async ({ ack, command, client, respond }) => {
    await ack();

    const parts = (command.text || "").trim().split(/\s+/);

    if (parts.length < 2) {
      return respond(
        "Usage: `/resolve <market_id> <outcome_name>`\n" +
          "Example: `/resolve m123abc Yes` or `/resolve m123abc Alice`"
      );
    }

    const marketId = parts[0];
    const outcomeName = parts.slice(1).join(" ");

    const result = handlers.handleResolveMarket(marketId, outcomeName);

    if (!result.success) {
      return respond(result.error!);
    }

    await client.chat.postMessage({
      channel: command.channel_id,
      text: result.message!,
    });
  });

  // /odds - Show detailed odds for a market
  app.command("/odds", async ({ ack, command, client, respond }) => {
    await ack();

    const parts = (command.text || "").trim().split(/\s+/);
    const marketId = parts[0];
    const betAmount = parts[1] ? parseInt(parts[1], 10) : 100;

    if (!marketId) {
      return respond(
        "Usage: `/odds <market_id> [bet_amount]`\nExample: `/odds m123abc 100`"
      );
    }

    const result = handlers.handleGetOdds(marketId, betAmount);

    if (!result.success) {
      return respond(result.error!);
    }

    await client.chat.postMessage({
      channel: command.channel_id,
      text: result.message!,
      blocks: result.blocks,
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
