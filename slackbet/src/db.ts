import Database from "better-sqlite3";

const dbPath = process.env.DATABASE_PATH || "bets.db";
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// Helper functions (defined early for use in migrations)
const START = parseInt(process.env.STARTING_POINTS || "1000", 10);
const uid = (p = "m") => p + Math.random().toString(16).slice(2, 8);
const now = () => Date.now();

// Create core tables
db.exec(`
CREATE TABLE IF NOT EXISTS users(user TEXT PRIMARY KEY, name TEXT, points INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS markets(id TEXT PRIMARY KEY, question TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS outcomes(
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  FOREIGN KEY (market_id) REFERENCES markets(id)
);
CREATE INDEX IF NOT EXISTS idx_outcomes_market ON outcomes(market_id);
`);

// Create or migrate bets table
try {
  // Try to check if bets table has 'side' column (old schema)
  const hasOldSchema = db.prepare("SELECT side FROM bets LIMIT 1");
  hasOldSchema.get();

  // Old schema exists, need to migrate
  console.log("Migrating bets table from old schema to new schema...");

  // Create new bets table with outcome_id
  db.exec(`
    CREATE TABLE IF NOT EXISTS bets_new(
      id TEXT PRIMARY KEY,
      market_id TEXT NOT NULL,
      user TEXT NOT NULL,
      outcome_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (market_id) REFERENCES markets(id),
      FOREIGN KEY (outcome_id) REFERENCES outcomes(id)
    );
    CREATE INDEX IF NOT EXISTS idx_bets_new_market ON bets_new(market_id);
    CREATE INDEX IF NOT EXISTS idx_bets_new_outcome ON bets_new(outcome_id);
  `);

  // Migrate existing markets to have Yes/No outcomes
  const existingMarkets = db.prepare("SELECT id FROM markets").all() as Array<{
    id: string;
  }>;
  const outcomeInsert = db.prepare(
    "INSERT OR IGNORE INTO outcomes VALUES (?,?,?,?)"
  );

  for (const m of existingMarkets) {
    const yesId = uid("o");
    const noId = uid("o");
    outcomeInsert.run(yesId, m.id, "Yes", 1);
    outcomeInsert.run(noId, m.id, "No", 2);

    // Map old bets to new outcomes
    db.exec(`
      INSERT INTO bets_new (id, market_id, user, outcome_id, amount, created_at)
      SELECT 
        b.id,
        b.market_id,
        b.user,
        CASE 
          WHEN b.side = 'yes' THEN '${yesId}'
          WHEN b.side = 'no' THEN '${noId}'
        END as outcome_id,
        b.amount,
        b.created_at
      FROM bets b
      WHERE b.market_id = '${m.id}'
    `);
  }

  // Replace old table with new
  db.exec(`
    DROP TABLE bets;
    ALTER TABLE bets_new RENAME TO bets;
  `);

  console.log("Migration completed successfully!");
} catch (error) {
  // New schema or no bets table exists yet
  db.exec(`
    CREATE TABLE IF NOT EXISTS bets(
      id TEXT PRIMARY KEY,
      market_id TEXT NOT NULL,
      user TEXT NOT NULL,
      outcome_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (market_id) REFERENCES markets(id),
      FOREIGN KEY (outcome_id) REFERENCES outcomes(id)
    );
    CREATE INDEX IF NOT EXISTS idx_bets_market ON bets(market_id);
    CREATE INDEX IF NOT EXISTS idx_bets_outcome ON bets(outcome_id);
  `);
}

// Migration: Add name column to users if it doesn't exist
try {
  db.prepare("SELECT name FROM users LIMIT 1").get();
} catch (error) {
  db.exec("ALTER TABLE users ADD COLUMN name TEXT;");
}

export function ensureUser(u: string, name?: string): void {
  if (!db.prepare("SELECT 1 FROM users WHERE user=?").get(u)) {
    db.prepare("INSERT INTO users VALUES(?,?,?)").run(u, name || null, START);
  } else if (name) {
    // Update name if provided and user exists
    db.prepare("UPDATE users SET name=? WHERE user=?").run(name, u);
  }
}

export const pts = (u: string): number =>
  (
    db.prepare("SELECT points FROM users WHERE user=?").get(u) as
      | { points: number }
      | undefined
  )?.points ?? START;

const setPts = (u: string, d: number): void => {
  db.prepare("UPDATE users SET points=points+? WHERE user=?").run(d, u);
};

export const market = (id: string) =>
  db.prepare("SELECT * FROM markets WHERE id=?").get(id) as
    | {
        id: string;
        question: string;
        status: string;
        created_by: string;
        created_at: number;
      }
    | undefined;

// Legacy function for backward compatibility
export const sumSide = (id: string, s: string): number => {
  // Map yes/no to outcome names
  const outcomeName = s === "yes" ? "Yes" : s === "no" ? "No" : s;
  const outcome = db
    .prepare("SELECT id FROM outcomes WHERE market_id=? AND name=?")
    .get(id, outcomeName) as { id: string } | undefined;

  if (!outcome) return 0;
  return sumOutcome(id, outcome.id);
};

export const sumOutcome = (marketId: string, outcomeId: string): number =>
  (
    db
      .prepare(
        "SELECT COALESCE(SUM(amount),0) t FROM bets WHERE market_id=? AND outcome_id=?"
      )
      .get(marketId, outcomeId) as { t: number }
  ).t;

export const listOpen = () =>
  db
    .prepare(
      "SELECT * FROM markets WHERE status='open' ORDER BY created_at DESC LIMIT 20"
    )
    .all() as Array<{
    id: string;
    question: string;
    status: string;
    created_by: string;
    created_at: number;
  }>;

export function getLeaderboardWithNames() {
  return db
    .prepare(
      "SELECT user, name, points FROM users ORDER BY points DESC LIMIT 10"
    )
    .all() as Array<{
    user: string;
    name: string | null;
    points: number;
  }>;
}

export function updateUserName(user: string, name: string): void {
  db.prepare("UPDATE users SET name=? WHERE user=?").run(name, user);
}

export async function ensureUserWithSlackInfo(
  userId: string,
  slackClient: any
): Promise<void> {
  // First ensure user exists
  if (!db.prepare("SELECT 1 FROM users WHERE user=?").get(userId)) {
    db.prepare("INSERT INTO users VALUES(?,?,?)").run(userId, null, START);
  }

  // Try to fetch and update name from Slack if not already set
  const existing = db
    .prepare("SELECT name FROM users WHERE user=?")
    .get(userId) as { name: string | null } | undefined;
  if (!existing?.name) {
    try {
      const slackUser = await slackClient.users.info({ user: userId });
      const name = slackUser.user.real_name || slackUser.user.name || null;
      if (name) {
        db.prepare("UPDATE users SET name=? WHERE user=?").run(name, userId);
      }
    } catch (error) {
      // Silently fail - name will remain null
      console.error(`Failed to fetch Slack info for user ${userId}:`, error);
    }
  }
}

export function createMarket(
  question: string,
  userId: string,
  outcomes?: string[]
) {
  const id = uid("m");

  const tx = db.transaction(() => {
    // Create market
    db.prepare("INSERT INTO markets VALUES (?,?,?,?,?)").run(
      id,
      question,
      "open",
      userId,
      now()
    );

    // Create outcomes (default to Yes/No if not specified)
    const outcomeNames =
      outcomes && outcomes.length >= 2 ? outcomes : ["Yes", "No"];
    outcomeNames.forEach((name, index) => {
      const outcomeId = uid("o");
      db.prepare("INSERT INTO outcomes VALUES (?,?,?,?)").run(
        outcomeId,
        id,
        name,
        index + 1
      );
    });
  });

  tx();
  return id;
}

export function placeBet(
  marketId: string,
  userId: string,
  outcomeId: string,
  amount: number
) {
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO bets VALUES (?,?,?,?,?,?)").run(
      uid("b"),
      marketId,
      userId,
      outcomeId,
      amount,
      now()
    );
    setPts(userId, -amount);
  });
  tx();
}

// Legacy function for backward compatibility
export function placeBetByName(
  marketId: string,
  userId: string,
  outcomeName: string,
  amount: number
) {
  const outcome = getOutcomeByName(marketId, outcomeName);
  if (!outcome) {
    throw new Error(
      `Outcome "${outcomeName}" not found for market ${marketId}`
    );
  }
  placeBet(marketId, userId, outcome.id, amount);
}

export function resolveMarket(marketId: string, outcomeId: string) {
  const m = market(marketId);
  if (!m || m.status !== "open") return false;

  const outcomes = getMarketOutcomes(marketId);
  const totalPool = outcomes.reduce((sum, o) => sum + o.total_bet, 0);
  const winningOutcome = outcomes.find((o) => o.id === outcomeId);

  if (!winningOutcome) return false;

  const winners = db
    .prepare("SELECT user, amount FROM bets WHERE market_id=? AND outcome_id=?")
    .all(marketId, outcomeId) as Array<{
    user: string;
    amount: number;
  }>;

  const tx = db.transaction(() => {
    db.prepare("UPDATE markets SET status=? WHERE id=?").run(
      `resolved_${outcomeId}`,
      marketId
    );

    if (winningOutcome.total_bet > 0 && totalPool > 0) {
      for (const w of winners) {
        const payout = Math.floor(
          totalPool * (w.amount / winningOutcome.total_bet)
        );
        setPts(w.user, payout);
      }
    }
  });

  tx();
  return {
    outcomes: outcomes.map((o) => ({ name: o.name, total: o.total_bet })),
    winner: winningOutcome.name,
    total: totalPool,
  };
}

// Legacy function for backward compatibility
export function resolveMarketByName(marketId: string, outcomeName: string) {
  const outcome = getOutcomeByName(marketId, outcomeName);
  if (!outcome) {
    throw new Error(
      `Outcome "${outcomeName}" not found for market ${marketId}`
    );
  }
  return resolveMarket(marketId, outcome.id);
}

export function getLeaderboard() {
  return db
    .prepare("SELECT user, name, points FROM users ORDER BY points DESC")
    .all() as Array<{
    user: string;
    name: string | null;
    points: number;
  }>;
}

export function getUserBets(userId: string) {
  return db
    .prepare(
      `SELECT
        b.market_id,
        b.outcome_id,
        o.name as outcome_name,
        b.amount,
        b.created_at,
        m.question,
        m.status
      FROM bets b
      JOIN markets m ON b.market_id = m.id
      JOIN outcomes o ON b.outcome_id = o.id
      WHERE b.user = ?
      ORDER BY b.created_at DESC`
    )
    .all(userId) as Array<{
    market_id: string;
    outcome_id: string;
    outcome_name: string;
    amount: number;
    created_at: number;
    question: string;
    status: string;
  }>;
}

// Outcome management functions
export interface Outcome {
  id: string;
  market_id: string;
  name: string;
  display_order: number;
  total_bet: number;
}

export function getMarketOutcomes(marketId: string): Outcome[] {
  const outcomes = db
    .prepare(
      `SELECT 
        o.id,
        o.market_id,
        o.name,
        o.display_order,
        COALESCE(SUM(b.amount), 0) as total_bet
      FROM outcomes o
      LEFT JOIN bets b ON o.id = b.outcome_id
      WHERE o.market_id = ?
      GROUP BY o.id
      ORDER BY o.display_order`
    )
    .all(marketId) as Outcome[];

  return outcomes;
}

export function getOutcomeByName(
  marketId: string,
  name: string
): Outcome | undefined {
  const outcome = db
    .prepare(
      `SELECT 
        o.id,
        o.market_id,
        o.name,
        o.display_order,
        COALESCE(SUM(b.amount), 0) as total_bet
      FROM outcomes o
      LEFT JOIN bets b ON o.id = b.outcome_id
      WHERE o.market_id = ? AND LOWER(o.name) = LOWER(?)
      GROUP BY o.id`
    )
    .get(marketId, name) as Outcome | undefined;

  return outcome;
}

export function getOutcomeById(outcomeId: string): Outcome | undefined {
  const outcome = db
    .prepare(
      `SELECT 
        o.id,
        o.market_id,
        o.name,
        o.display_order,
        COALESCE(SUM(b.amount), 0) as total_bet
      FROM outcomes o
      LEFT JOIN bets b ON o.id = b.outcome_id
      WHERE o.id = ?
      GROUP BY o.id`
    )
    .get(outcomeId) as Outcome | undefined;

  return outcome;
}

// Odds calculation functions
export interface OddsCalculation {
  outcomeId: string;
  outcomeName: string;
  currentPool: number;
  outcomePool: number;
  potentialPayout: number;
  profit: number;
  oddsRatio: string;
}

export function calculateOdds(
  marketId: string,
  outcomeId: string,
  betAmount: number
): OddsCalculation | null {
  const outcomes = getMarketOutcomes(marketId);
  const outcome = outcomes.find((o) => o.id === outcomeId);

  if (!outcome) return null;

  const totalPool = outcomes.reduce((sum, o) => sum + o.total_bet, 0);
  const outcomePool = outcome.total_bet;

  // Parimutuel formula:
  // New total pool = totalPool + betAmount
  // New outcome pool = outcomePool + betAmount
  // Payout = betAmount * (totalPool + betAmount) / (outcomePool + betAmount)
  // Profit = Payout - betAmount

  const newTotalPool = totalPool + betAmount;
  const newOutcomePool = outcomePool + betAmount;

  let potentialPayout: number;
  let profit: number;

  if (newOutcomePool === 0) {
    // If no one has bet on this outcome yet, payout is entire pool
    potentialPayout = newTotalPool;
    profit = newTotalPool - betAmount;
  } else {
    potentialPayout = Math.floor((betAmount * newTotalPool) / newOutcomePool);
    profit = potentialPayout - betAmount;
  }

  const oddsRatio = `${betAmount}/${profit}`;

  return {
    outcomeId,
    outcomeName: outcome.name,
    currentPool: totalPool,
    outcomePool,
    potentialPayout,
    profit,
    oddsRatio,
  };
}

export function getMarketOddsDisplay(
  marketId: string,
  betAmount: number = 100
): OddsCalculation[] {
  const outcomes = getMarketOutcomes(marketId);

  return outcomes
    .map((outcome) => {
      const odds = calculateOdds(marketId, outcome.id, betAmount);
      return odds!;
    })
    .filter(Boolean);
}
