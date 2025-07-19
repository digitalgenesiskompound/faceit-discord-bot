# FACEIT Discord Bot

A Discord bot that sends notifications about upcoming FACEIT matches for your team.

## Features

- Automatically finds all upcoming matches for your team using the FACEIT API
- Displays match times in both PDT and MDT time zones
- Sends individual notifications for new matches
- Sends summary notifications with all upcoming matches
- Runs as a Docker container with health checks
- Persistent storage for processed matches

## Setup

1. Create a `.env` file with the following variables:
   ```
   FACEIT_API_KEY=your_api_key
   DISCORD_WEBHOOK_URL=your_discord_webhook_url
   TEAM_ID=your_team_id
   ```

2. Build and run with Docker Compose:
   ```
   docker compose up -d
   ```

## Maintenance

- Check logs: `docker compose logs bot`
- Restart: `docker compose restart bot`
- Update: Pull changes, then run `docker compose up -d --build`
- Reset processed matches: `echo "[]" > ./data/processed_matches.json && docker compose restart bot`

## How It Works

The bot uses multiple methods to find upcoming matches:
1. First, it searches championship matches for your team
2. If no matches are found, it checks player match histories
3. It filters for matches involving your team that haven't finished

The bot checks for new matches every 30 minutes and sends Discord notifications about them.

## Customization

Edit `match-notifier.js` to adjust notification settings or check frequency.
