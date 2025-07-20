# FACEIT Discord Bot

A Discord bot that sends notifications about upcoming FACEIT matches for your team and provides interactive commands.

## Features

- **Automatic Notifications**: Finds and sends notifications about upcoming FACEIT matches for your team
- **Interactive Commands**: Query matches and get information on-demand using Discord commands
- **Multi-timezone Support**: Displays match times in both PDT and MDT time zones
- **Smart Match Detection**: Uses multiple methods to find upcoming matches
- **Persistent Storage**: Remembers already processed matches to avoid duplicate notifications
- **Docker Support**: Runs as a containerized service with health checks
- **Command Handling**: Interactive Discord bot commands for match queries

## Discord Bot Commands

- `!matches` - Display all upcoming FACEIT matches for your team
- `!notify` - Send a test match notification (Admin only)
- `!help` - Show available commands and usage

## Setup

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application and bot
3. Copy the bot token
4. Invite the bot to your server with appropriate permissions:
   - Send Messages
   - Embed Links
   - Read Message History
   - Use Slash Commands

### 2. Configuration

Create a `.env` file with the following variables:

```env
# FACEIT API Configuration
FACEIT_API_KEY=your_faceit_api_key_here
TEAM_ID=your_faceit_team_id_here

# Discord Bot Configuration
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here
DISCORD_CHANNEL_ID=your_discord_channel_id_here

# Application Configuration
CHECK_INTERVAL=*/30 * * * *  # Check every 30 minutes
LOG_LEVEL=debug
```

### 3. Build and Run

Build and run with Docker Compose:
```bash
docker compose up -d
```

## Migration from Webhook Version

The bot now uses Discord bot functionality instead of webhooks. If you were using the webhook version:

1. Create a Discord bot (see setup above)
2. Update your `.env` file with the new Discord bot configuration
3. The `DISCORD_WEBHOOK_URL` is no longer needed but kept for reference
4. Rebuild and restart the container

## Maintenance

- **Check logs**: `docker compose logs bot`
- **Restart**: `docker compose restart bot` 
- **Update**: Pull changes, then run `docker compose up -d --build`
- **Reset processed matches**: Use database commands or restart the bot to clear cache
- **Check health**: Visit `http://localhost:8080/health`

## How It Works

### Match Detection
The bot uses multiple methods to find upcoming matches:

1. **Championship Search**: First searches championship matches for your team
2. **Player History**: If no matches found, checks player match histories
3. **Team Filtering**: Filters for matches involving your team that haven't finished

### Notifications
- Automatically checks for new matches every 30 minutes
- Sends Discord notifications to the configured channel
- Tracks processed matches to avoid duplicates
- Supports on-demand match queries via commands

### Commands
- Interactive command handling for real-time match information
- Admin-only commands for testing and management
- Rich embed formatting for better readability

## Bot Permissions

The bot requires the following Discord permissions:
- `Send Messages` - To send notifications and command responses
- `Embed Links` - To send rich embed notifications
- `Read Message History` - To read commands
- `Use External Emojis` - For enhanced formatting (optional)

## Troubleshooting

### Bot Not Responding to Commands
1. Check if the bot has proper permissions in the channel
2. Verify `DISCORD_BOT_TOKEN` is correct
3. Check logs: `docker compose logs bot`

### No Match Notifications
1. Verify `FACEIT_API_KEY` is valid
2. Check `TEAM_ID` is correct
3. Ensure `DISCORD_CHANNEL_ID` points to the right channel

### Docker Issues
1. Rebuild the container: `docker compose up -d --build`
2. Check container status: `docker compose ps`
3. View detailed logs: `docker compose logs bot -f`

## Development

To modify the bot:

1. Edit `match-notifier.js`
2. Rebuild: `docker compose up -d --build`
3. Monitor logs: `docker compose logs bot -f`

## API Rate Limits

The bot respects FACEIT API rate limits by:
- Using appropriate request intervals
- Implementing error handling and retries
- Caching processed matches to reduce API calls

## License

MIT License - see LICENSE file for details.
