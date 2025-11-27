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
  side: string,
  amount: number,
  userId: string
): PlaceBetResult {
  // Validate inputs
  if (
    !marketId ||
    !["yes", "no"].includes(side.toLowerCase()) ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return {
      success: false,
      error: "Usage: `/bet <market_id> <yes|no> <points>`",
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

  // Check user has enough points
  const userPoints = db.pts(userId);
  if (userPoints < amount) {
    return {
      success: false,
      error: `Insufficient points. Balance: ${userPoints}`,
    };
  }

  // Place the bet
  db.placeBet(marketId, userId, side.toLowerCase() as "yes" | "no", amount);

  const yesTotal = db.sumSide(marketId, "yes");
  const noTotal = db.sumSide(marketId, "no");
  const newBalance = db.pts(userId);

  return {
    success: true,
    message: `Bet placed: *${amount}* on *${side.toUpperCase()}* in *${marketId}* • YES ${yesTotal} / NO ${noTotal} • Your balance ${newBalance}`,
  };
}

export function handleListMarkets(): {
  success: boolean;
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

  return {
    success: true,
    markets,
  };
}

export function handleResolveMarket(
  marketId: string,
  outcome: string
): ResolveMarketResult {
  const outcomeLower = outcome.toLowerCase();

  // Validate inputs
  if (!marketId || !["yes", "no"].includes(outcomeLower)) {
    return {
      success: false,
      error: "Usage: `/resolve <market_id> <yes|no>`",
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

  // Resolve the market
  const result = db.resolveMarket(marketId, outcomeLower as "yes" | "no");
  if (!result) {
    return {
      success: false,
      error: "Error resolving market.",
    };
  }

  return {
    success: true,
    message: `Resolved *${marketId}* → *${outcomeLower.toUpperCase()}* • YES ${result.yes} / NO ${result.no} • Total ${result.total}`,
  };
}

export function handleGetUserBets(userId: string): {
  success: boolean;
  marketBets?: Map<
    string,
    {
      question: string;
      status: string;
      bets: Array<{ side: string; amount: number }>;
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
      bets: Array<{ side: string; amount: number }>;
    }
  >
): string {
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

  return messageText;
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
