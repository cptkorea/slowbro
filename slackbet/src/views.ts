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

  // Quick bet buttons: open modal for stake input
  app.action(/bet_(yes|no)/, async ({ ack, body, action, client }) => {
    await ack();
    const buttonAction = action as { action_id: string; value: string };
    const side = buttonAction.action_id.endsWith("yes") ? "yes" : "no";
    const id = buttonAction.value;

    // Open a modal to ask for stake amount
    await client.views.open({
      trigger_id: (body as { trigger_id: string }).trigger_id,
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
              text: `*Market:* ${id}\n*Your balance:* ${db.pts((body as { user: { id: string } }).user.id)} points`,
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

    const userId = (body as { user: { id: string } }).user.id;
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
}
