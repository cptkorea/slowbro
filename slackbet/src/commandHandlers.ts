import * as db from "./db";

export interface CreateMarketResult {
  success: boolean;
  marketId?: string;
  error?: string;
}

export interface PlaceBetResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface ResolveMarketResult {
  success: boolean;
  message?: string;
  error?: string;
}

export function handleCreateMarket(
  question: string,
  userId: string
): CreateMarketResult {
  if (!question || question.trim() === "") {
    return {
      success: false,
      error: 'Usage: `/mk "Will we ship by Nov 15?"`',
    };
  }

  const marketId = db.createMarket(question, userId);
  return {
    success: true,
    marketId,
  };
}

export function handlePlaceBet(
  marketId: string,
  outcomeName: string,
  amount: number,
  userId: string
): PlaceBetResult {
  // Validate inputs
  if (!marketId || !outcomeName || !Number.isFinite(amount) || amount <= 0) {
    return {
      success: false,
      error: "Usage: `/bet <market_id> <outcome_name> <points>`",
    };
  }

  // Check if market exists and is open
  const market = db.market(marketId);
  if (!market || market.status !== "open") {
    return {
      success: false,
      error: "Market not found or closed.",
    };
  }

  // Find the outcome
  const outcome = db.getOutcomeByName(marketId, outcomeName);
  if (!outcome) {
    const availableOutcomes = db.getMarketOutcomes(marketId);
    const outcomesList = availableOutcomes.map(o => o.name).join(", ");
    return {
      success: false,
      error: `Outcome "${outcomeName}" not found. Available outcomes: ${outcomesList}`,
    };
  }

  // Check user has enough points
  db.ensureUser(userId);
  const userPoints = db.pts(userId);
  if (userPoints < amount) {
    return {
      success: false,
      error: `Insufficient points. Balance: ${userPoints}`,
    };
  }

  // Calculate odds before placing bet
  const odds = db.calculateOdds(marketId, outcome.id, amount);

  // Place the bet
  db.placeBet(marketId, userId, outcome.id, amount);

  // Get updated outcomes
  const outcomes = db.getMarketOutcomes(marketId);
  const poolSummary = outcomes.map(o => `${o.name}: ${o.total_bet}`).join(" / ");
  const newBalance = db.pts(userId);

  return {
    success: true,
    message: 
      `✅ Bet placed: *${amount} points* on *${outcome.name}* in market *${marketId}*\n` +
      `Expected payout: *${odds?.potentialPayout || 0} points* (${odds?.profit || 0} profit)\n` +
      `Pool: ${poolSummary}\n` +
      `Your balance: *${newBalance} points*`,
  };
}

export function handleListMarkets(): {
  success: boolean;
  message?: string;
  blocks?: any[];
  markets?: Array<{ id: string; question: string; status: string }>;
  error?: string;
} {
  const markets = db.listOpen();

  if (markets.length === 0) {
    return {
      success: false,
      error: "No open markets.",
    };
  }

  const blocks: any[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "📈 Open Markets",
      },
    },
  ];

  let messageText = "📈 *Open Markets*\n\n";

  for (const market of markets) {
    const outcomes = db.getMarketOutcomes(market.id);
    const oddsDisplay = db.getMarketOddsDisplay(market.id, 100);
    const totalPool = outcomes.reduce((sum, o) => sum + o.total_bet, 0);

    const oddsLines = oddsDisplay
      .map((odds) => `  • ${odds.outcomeName}: 100→${odds.potentialPayout} (${odds.profit} profit)`)
      .join("\n");

    messageText += `*${market.question}*\n`;
    messageText += `Market: *${market.id}* | Pool: ${totalPool} points\n`;
    messageText += `${oddsLines}\n\n`;

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${market.question}*\n_Market ${market.id} • Total pool: ${totalPool} points_`,
      },
    });

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Current odds (100 pt bet):*\n${oddsLines}`,
      },
    });

    blocks.push({
      type: "divider",
    });
  }

  return {
    success: true,
    message: messageText,
    blocks,
    markets,
  };
}

export function handleResolveMarket(
  marketId: string,
  outcomeName: string
): ResolveMarketResult {
  // Validate inputs
  if (!marketId || !outcomeName) {
    return {
      success: false,
      error: "Usage: `/resolve <market_id> <outcome_name>`",
    };
  }

  // Check if market exists
  const market = db.market(marketId);
  if (!market) {
    return {
      success: false,
      error: "Market not found.",
    };
  }

  // Check if market is already resolved
  if (market.status !== "open") {
    return {
      success: false,
      error: `Market already ${market.status}.`,
    };
  }

  // Find the outcome
  const outcome = db.getOutcomeByName(marketId, outcomeName);
  if (!outcome) {
    const availableOutcomes = db.getMarketOutcomes(marketId);
    const outcomesList = availableOutcomes.map(o => o.name).join(", ");
    return {
      success: false,
      error: `Outcome "${outcomeName}" not found. Available outcomes: ${outcomesList}`,
    };
  }

  // Resolve the market
  const result = db.resolveMarket(marketId, outcome.id);
  if (!result) {
    return {
      success: false,
      error: "Error resolving market.",
    };
  }

  const outcomePoolSummary = result.outcomes
    .map(o => `${o.name}: ${o.total}`)
    .join(" / ");

  return {
    success: true,
    message: 
      `✅ *Market Resolved*\n\n` +
      `Market: *${marketId}*\n` +
      `Question: *${market.question}*\n` +
      `Winner: *${result.winner}*\n\n` +
      `Final Pool Distribution:\n${outcomePoolSummary}\n` +
      `Total Pool: *${result.total} points*`,
  };
}

export function handleGetUserBets(userId: string): {
  success: boolean;
  marketBets?: Map<
    string,
    {
      question: string;
      status: string;
      bets: Array<{ side?: string; outcome?: string; amount: number }>;
    }
  >;
  error?: string;
} {
  const bets = db.getUserBets(userId);

  if (bets.length === 0) {
    return {
      success: false,
      error: "You haven't placed any bets yet.",
    };
  }

  // Group bets by market
  const marketBets = new Map<
    string,
    {
      question: string;
      status: string;
      bets: Array<{ side?: string; outcome?: string; amount: number }>;
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
      outcome: bet.outcome_name,
      amount: bet.amount,
    });
  }

  return {
    success: true,
    marketBets,
  };
}

export function formatUserBetsMessage(
  marketBets: Map<
    string,
    {
      question: string;
      status: string;
      bets: Array<{ side?: string; outcome?: string; amount: number }>;
    }
  >
): string {
  let messageText = "📊 *Your Bets*\n\n";

  for (const [marketId, data] of marketBets) {
    const outcomes = db.getMarketOutcomes(marketId);
    const totalPool = outcomes.reduce((sum, o) => sum + o.total_bet, 0);
    const totalStaked = data.bets.reduce((sum, b) => sum + b.amount, 0);

    const statusEmoji =
      data.status === "open"
        ? "🟢"
        : data.status.startsWith("resolved")
          ? "🔒"
          : "⚫";
    
    let statusText = "Unknown";
    if (data.status === "open") {
      statusText = "Open";
    } else if (data.status.startsWith("resolved_")) {
      const resolvedOutcomeId = data.status.replace("resolved_", "");
      const resolvedOutcome = db.getOutcomeById(resolvedOutcomeId);
      statusText = `Resolved: ${resolvedOutcome?.name || "Unknown"}`;
    }

    const betsList = data.bets
      .map((b) => {
        const outcomeName = b.outcome || b.side?.toUpperCase() || "Unknown";
        return `• ${outcomeName}: ${b.amount} points`;
      })
      .join("\n");

    const poolSummary = outcomes.map(o => `${o.name}: ${o.total_bet}`).join(" / ");

    messageText += `*${data.question}*\n`;
    messageText += `${betsList}\n\n`;
    messageText += `*Pool:* ${poolSummary}\n`;
    messageText += `*Status:* ${statusEmoji} ${statusText}\n`;
    messageText += `_Market ID: ${marketId} • Your stake: ${totalStaked} points • Total pool: ${totalPool}_\n`;
    messageText += `\n---\n\n`;
  }

  return messageText;
}

export function handleGetOdds(
  marketId: string,
  betAmount: number = 100
): {
  success: boolean;
  message?: string;
  blocks?: any[];
  error?: string;
} {
  const market = db.market(marketId);
  if (!market) {
    return {
      success: false,
      error: "Market not found.",
    };
  }

  const outcomes = db.getMarketOutcomes(marketId);
  if (outcomes.length === 0) {
    return {
      success: false,
      error: "No outcomes found for this market.",
    };
  }

  const totalPool = outcomes.reduce((sum, o) => sum + o.total_bet, 0);
  const oddsDisplay = db.getMarketOddsDisplay(marketId, betAmount);

  const outcomeLines = oddsDisplay.map(odds => {
    const poolPct = totalPool > 0 ? Math.round((odds.outcomePool / totalPool) * 100) : 0;
    return `• *${odds.outcomeName}*: ${betAmount}→${odds.potentialPayout} (${odds.profit} profit) | Pool: ${odds.outcomePool} (${poolPct}%)`;
  }).join("\n");

  const message = 
    `📊 *Market Odds: ${market.question}*\n\n` +
    `Market ID: *${marketId}*\n` +
    `Status: *${market.status}*\n` +
    `Total Pool: *${totalPool} points*\n\n` +
    `*Odds for ${betAmount} point bet:*\n${outcomeLines}`;

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "📊 Market Odds",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${market.question}*`,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Market ID:*\n${marketId}`,
        },
        {
          type: "mrkdwn",
          text: `*Status:*\n${market.status}`,
        },
        {
          type: "mrkdwn",
          text: `*Total Pool:*\n${totalPool} points`,
        },
        {
          type: "mrkdwn",
          text: `*Bet Amount:*\n${betAmount} points`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Current Odds:*\n${outcomeLines}`,
      },
    },
  ];

  return {
    success: true,
    message,
    blocks,
  };
}

export function handleGetLeaderboard(): {
  success: boolean;
  leaderboard?: Array<{ user: string; name: string | null; points: number }>;
  error?: string;
} {
  const rows = db.getLeaderboard();

  if (rows.length === 0) {
    return {
      success: false,
      error: "No players yet.",
    };
  }

  return {
    success: true,
    leaderboard: rows,
  };
}

export function formatLeaderboardText(
  leaderboard: Array<{ user: string; name: string | null; points: number }>
): string {
  return leaderboard
    .map((r, i) => {
      const rank = i + 1;
      const medal =
        rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}.`;
      const name = r.name || `<@${r.user}>`;
      return `${medal} ${name} — *${r.points}* points`;
    })
    .join("\n");
}
