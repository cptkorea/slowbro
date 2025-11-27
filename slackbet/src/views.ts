import type { App } from "@slack/bolt";
import * as db from "./db";

export function registerViews(app: App) {
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

  // Quick bet buttons: open modal for stake input (outcome-based)
  app.action(/bet_outcome_/, async ({ ack, body, action, client }) => {
    await ack();
    const buttonAction = action as { action_id: string; value: string };
    const outcomeId = buttonAction.value;
    
    const outcome = db.getOutcomeById(outcomeId);
    if (!outcome) return;

    const userId = (body as { user: { id: string } }).user.id;
    const userBalance = db.pts(userId);
    
    // Calculate odds for a 100-point bet
    const odds = db.calculateOdds(outcome.market_id, outcomeId, 100);
    const oddsText = odds 
      ? `\n*Current odds:* Bet 100 → Get ${odds.potentialPayout} (${odds.profit} profit)`
      : "";

    // Open a modal to ask for stake amount
    await client.views.open({
      trigger_id: (body as { trigger_id: string }).trigger_id,
      view: {
        type: "modal",
        callback_id: `bet_outcome_modal_${outcomeId}`,
        title: {
          type: "plain_text",
          text: `Bet ${outcome.name}`,
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
              text: `*Market:* ${outcome.market_id}\n*Outcome:* ${outcome.name}\n*Your balance:* ${userBalance} points${oddsText}`,
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

  // Handle modal submission for outcome-based bets
  app.view(/bet_outcome_modal_/, async ({ ack, body, view, client }) => {
    await ack();

    const userId = (body as { user: { id: string } }).user.id;
    const stakeStr = view.state.values.stake_block.stake_input.value;
    const stake = parseInt(stakeStr || "0", 10);

    // Extract outcome ID from callback_id
    const callbackId = view.callback_id;
    const match = callbackId.match(/bet_outcome_modal_(.+)/);
    if (!match || !match[1]) return;

    const outcomeId = match[1];
    const outcome = db.getOutcomeById(outcomeId);
    if (!outcome) return;

    const marketId = outcome.market_id;

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

    // Calculate odds before placing bet
    const odds = db.calculateOdds(marketId, outcomeId, stake);

    // Place the bet
    db.placeBet(marketId, userId, outcomeId, stake);

    // Get updated pools
    const outcomes = db.getMarketOutcomes(marketId);
    const poolSummary = outcomes.map(o => `${o.name}: ${o.total_bet}`).join(" / ");

    await client.chat.postEphemeral({
      channel: userId,
      user: userId,
      text: `✅ Bet placed: *${stake} points* on *${outcome.name}* in market *${marketId}*\n` +
        `Expected payout: *${odds?.potentialPayout || 0} points* (${odds?.profit || 0} profit)\n` +
        `Pool: ${poolSummary}\n` +
        `Your balance: *${db.pts(userId)} points*`,
    });
  });

  // Handle market creation modal submission
  app.view("create_market_modal", async ({ ack, body, view, client }) => {
    const values = view.state.values;
    const question = values.question_block.question_input.value || "";
    const outcome1 = values.outcome1_block.outcome1_input.value || "";
    const outcome2 = values.outcome2_block.outcome2_input.value || "";
    const outcome3 = values.outcome3_block?.outcome3_input?.value || "";
    const outcome4 = values.outcome4_block?.outcome4_input?.value || "";
    const outcome5 = values.outcome5_block?.outcome5_input?.value || "";

    // Validation
    const errors: Record<string, string> = {};

    if (!question.trim()) {
      errors.question_block = "Question is required";
    }

    if (!outcome1.trim()) {
      errors.outcome1_block = "At least 2 outcomes are required";
    }

    if (!outcome2.trim()) {
      errors.outcome2_block = "At least 2 outcomes are required";
    }

    // Collect all non-empty outcomes
    const outcomes = [outcome1, outcome2, outcome3, outcome4, outcome5]
      .filter((o) => o && o.trim())
      .map((o) => o.trim());

    // Check for duplicates
    const uniqueOutcomes = new Set(outcomes.map((o) => o.toLowerCase()));
    if (uniqueOutcomes.size !== outcomes.length) {
      errors.outcome2_block = "Outcome names must be unique";
    }

    if (Object.keys(errors).length > 0) {
      return ack({
        response_action: "errors",
        errors,
      });
    }

    await ack();

    const userId = (body as { user: { id: string } }).user.id;
    const channelId = view.private_metadata;

    // Validate we have a channel ID
    if (!channelId) {
      console.error("No channel ID available in modal private_metadata");
      return;
    }

    // Create market with outcomes
    const marketId = db.createMarket(question, userId, outcomes);
    const marketOutcomes = db.getMarketOutcomes(marketId);

    // Build buttons for each outcome (max 5)
    const buttons = marketOutcomes.slice(0, 5).map((outcome) => ({
      type: "button" as const,
      text: { type: "plain_text" as const, text: `Bet ${outcome.name}` },
      action_id: `bet_outcome_${outcome.id}`,
      value: outcome.id,
    }));

    // Post message to channel
    try {
      await client.chat.postMessage({
        channel: channelId,
        text: `Market ${marketId}: ${question}`,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `*${question}*` } },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Market *${marketId}* • by <@${userId}> • ${marketOutcomes.length} outcomes`,
              },
            ],
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Outcomes:* ${marketOutcomes.map((o) => o.name).join(", ")}`,
            },
          },
          {
            type: "actions",
            elements: buttons,
          },
        ],
      });
    } catch (error) {
      console.error("Error posting market to channel:", error);
      // Try to notify user via ephemeral message
      try {
        await client.chat.postEphemeral({
          channel: userId,
          user: userId,
          text: `✅ Market *${marketId}* created, but couldn't post to the channel. Use \`/markets\` to see it.`,
        });
      } catch (ephemeralError) {
        console.error("Error sending ephemeral message:", ephemeralError);
      }
    }
  });
}
