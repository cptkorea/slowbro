# SlackBet

A simple Slack betting application built with TypeScript, Node.js, and Slack Bolt.

## Features

- Create prediction markets with `/mk`
- Place bets with `/bet` or quick-bet buttons
- View open markets with `/markets`
- Resolve markets with `/resolve`
- Check leaderboard with `/leaderboard`
- Persistent SQLite database with better-sqlite3

## Setup

### Prerequisites

- Node.js 18+ and npm
- A Slack workspace where you can install apps

### Installation

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file based on `.env.example`:

   ```bash
   cp .env.example .env
   ```

3. Configure your Slack app:
   - Go to https://api.slack.com/apps
   - Create a new app or select an existing one
   - Add the following Bot Token Scopes under "OAuth & Permissions":
     - `chat:write`
     - `commands`
   - Add the following Slash Commands under "Slash Commands":
     - `/mk` - Create a new market
     - `/bet` - Place a bet
     - `/markets` - List open markets
     - `/resolve` - Resolve a market
     - `/leaderboard` - View leaderboard
   - Enable Interactivity under "Interactivity & Shortcuts"
   - Set Request URL to: `https://your-domain.com/slack/events`
   - Install the app to your workspace
   - Copy the "Bot User OAuth Token" to `SLACK_BOT_TOKEN` in `.env`
   - Copy the "Signing Secret" to `SLACK_SIGNING_SECRET` in `.env`

4. Build the TypeScript code:
   ```bash
   npm run build
   ```

### Development

Run in development mode with hot reload:

```bash
npm run dev
```

### Production

Build and run in production:

```bash
npm run build
npm start
```

## Usage

### Create a Market

```
/mk "Will we ship the feature by Nov 15?"
```

### Place a Bet

```
/bet m123abc yes 50
```

Or use the quick-bet buttons (10 points per click).

### View Open Markets

```
/markets
```

### Resolve a Market

```
/resolve m123abc yes
```

### View Leaderboard

```
/leaderboard
```

## Commands

- `/mk "question"` - Create a new prediction market
- `/bet <market_id> <yes|no> <points>` - Place a bet on a market
- `/markets` - List all open markets
- `/resolve <market_id> <yes|no>` - Resolve a market (distributes winnings)
- `/leaderboard` - Show top 10 users by points

## Database Schema

The app uses SQLite with three tables:

- **users** - Track user points
- **markets** - Store prediction markets
- **bets** - Record all bets placed

## License

MIT
