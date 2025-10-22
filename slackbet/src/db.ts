import Database from "better-sqlite3";

const dbPath = process.env.DATABASE_PATH || "bets.db";
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(user TEXT PRIMARY KEY, points INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS markets(id TEXT PRIMARY KEY, question TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bets(id TEXT PRIMARY KEY, market_id TEXT NOT NULL, user TEXT NOT NULL, side TEXT CHECK(side IN ('yes','no')) NOT NULL, amount INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_bets_market ON bets(market_id);
`);

const START = parseInt(process.env.STARTING_POINTS || "1000", 10);
const uid = (p = "m") => p + Math.random().toString(16).slice(2, 8);
const now = () => Date.now();

export function ensureUser(u: string): void {
  if (!db.prepare("SELECT 1 FROM users WHERE user=?").get(u)) {
    db.prepare("INSERT INTO users VALUES(?,?)").run(u, START);
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

export const sumSide = (id: string, s: string): number =>
  (
    db
      .prepare(
        "SELECT COALESCE(SUM(amount),0) t FROM bets WHERE market_id=? AND side=?"
      )
      .get(id, s) as { t: number }
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

export function createMarket(question: string, userId: string) {
  const id = uid("m");
  db.prepare("INSERT INTO markets VALUES (?,?,?,?,?)").run(
    id,
    question,
    "open",
    userId,
    now()
  );
  return id;
}

export function placeBet(
  marketId: string,
  userId: string,
  side: "yes" | "no",
  amount: number
) {
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO bets VALUES (?,?,?,?,?,?)").run(
      uid("b"),
      marketId,
      userId,
      side,
      amount,
      now()
    );
    setPts(userId, -amount);
  });
  tx();
}

export function resolveMarket(id: string, out: "yes" | "no") {
  const m = market(id);
  if (!m || m.status !== "open") return false;

  const yes = sumSide(id, "yes");
  const no = sumSide(id, "no");
  const total = yes + no;
  const winSide = out;
  const winPool = winSide === "yes" ? yes : no;
  const winners = db
    .prepare("SELECT user, amount FROM bets WHERE market_id=? AND side=?")
    .all(id, winSide) as Array<{
    user: string;
    amount: number;
  }>;
  const tx = db.transaction(() => {
    db.prepare("UPDATE markets SET status=? WHERE id=?").run(
      `resolved_${out}`,
      id
    );
    if (winPool > 0 && total > 0)
      for (const w of winners) {
        const payout = Math.floor(total * (w.amount / winPool));
        setPts(w.user, payout);
      }
  });
  tx();
  return { yes, no, total };
}

export function getLeaderboard() {
  return db
    .prepare("SELECT user, points FROM users ORDER BY points DESC LIMIT 10")
    .all() as Array<{
    user: string;
    points: number;
  }>;
}
