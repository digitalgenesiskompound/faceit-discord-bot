### This was *vibe* coded.

# FACEIT Discord Bot

A comprehensive Discord bot that monitors your FACEIT team's matches and provides interactive commands for match tracking, player management, and RSVP functionality. Built with Docker for easy deployment and includes persistent SQLite storage.

## Features

- **🔄 Automatic Match Monitoring**: Continuously checks for upcoming FACEIT matches every 30 minutes
- **📅 Match Notifications**: Rich Discord embeds with match details, teams, and scheduling
- **🎮 RSVP System**: Interactive buttons for players to confirm attendance
- **👥 Player Management**: Link Discord accounts to FACEIT profiles
- **📊 Match History**: View recent finished matches and statistics
- **⚙️ Admin Commands**: Advanced management tools for administrators
- **🐳 Docker Ready**: Containerized deployment with health checks
- **💾 Persistent Storage**: SQLite database for reliable data retention
- **🔍 Smart Detection**: Multiple fallback methods to find team matches

## Bot Commands

### User Commands
- `/matches` - View all upcoming FACEIT matches
- `/profile` - View your linked FACEIT profile
- `/link <nickname>` - Link your Discord account to FACEIT
- `/unlink` - Remove your FACEIT account link
- `/lookup <query>` - Search for FACEIT players
- `/status [match_id]` - View RSVP status for matches
- `/finishedmatches [limit]` - View recent completed matches
- `/listplayers` - Show all team members
- `/register` - View available players to link with
- `/help` - Display command information

### Admin Commands (Require Admin Discord ID)
- `/notify` - Send test match notification
- `/clear-cache` - Clear and reload bot caches
- `/restart-bot` - Restart the bot process
- `/clean-user-mappings` - Reset all user account links
- `/clean-rsvp-status` - Clear all RSVP data
- `/cleanup-threads` - Remove old match discussion threads

## Prerequisites

- **Docker & Docker Compose** installed on your system
- **FACEIT API Key** (free tier available)
- **Discord Bot Application** with proper permissions
- **FACEIT Team ID** for your team

## Setup Guide

### 1. Obtain FACEIT API Key

1. Visit the [FACEIT Developer Portal](https://developers.faceit.com/)
2. Log in with your FACEIT account
3. Create a new application or use an existing one
4. Copy your **API Key** from the application dashboard
5. Find your **Team ID**:
   - Go to your team's FACEIT page: `https://www.faceit.com/en/teams/YOUR-TEAM-NAME`
   - Copy the ID from the URL (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

### 2. Create Discord Bot Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Navigate to the "Bot" section in the sidebar
4. Click "Add Bot" (or "Create Bot")
5. Copy the **Bot Token** (keep this secure!)
6. Under "Privileged Gateway Intents", enable:
   - Message Content Intent (if using message commands)
7. Copy your **Application ID** from the "General Information" section

### 3. Invite Bot to Your Server

1. In the Discord Developer Portal, go to "OAuth2" → "URL Generator"
2. Select scopes:
   - `bot`
   - `applications.commands`
3. Select bot permissions:
   - Send Messages
   - Send Messages in Threads
   - Create Public Threads
   - Embed Links
   - Attach Files
   - Read Message History
   - Use Slash Commands
   - Add Reactions
   - Use External Emojis
4. Copy the generated URL and open it in your browser
5. Select your Discord server and authorize the bot

### 4. Get Discord Channel ID

1. In Discord, right-click on the channel where you want notifications
2. Click "Copy Channel ID" (you may need to enable Developer Mode first)
3. To enable Developer Mode: User Settings → Advanced → Developer Mode

### 5. Get Your Discord User ID (for admin commands)

1. In Discord, right-click on your username
2. Click "Copy User ID"

### 6. Configure Environment Variables

Create a `.env` file in the project directory:

```env
# FACEIT API Configuration
FACEIT_API_KEY=your_faceit_api_key_here
TEAM_ID=your_faceit_team_id_here

# Discord Bot Configuration
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here
DISCORD_CHANNEL_ID=your_discord_channel_id_here
ADMIN_DISCORD_ID=your_discord_user_id_here

# Optional: Guild-specific command registration (faster deployment)
# DISCORD_GUILD_ID=your_server_id_here

# Application Configuration
CHECK_INTERVAL=*/30 * * * *  # Check every 30 minutes
LOG_LEVEL=info
```

### 7. Deploy with Docker

1. Clone or download this repository
2. Navigate to the project directory
3. Ensure your `.env` file is configured
4. Build and start the bot:

```bash
# Build and start in detached mode
docker compose up -d

# Check if it's running
docker compose ps

# View logs
docker compose logs -f bot
```

### 8. Verify Setup

1. Check the bot is online in your Discord server
2. Visit `http://localhost:8080/health` to verify the health endpoint
3. Run `/help` in Discord to test slash commands
4. Run `/matches` to test FACEIT API connectivity

## File Structure

```
faceit-discord-bot/
├── src/
│   ├── bot.js                 # Main bot entry point
│   ├── config/
│   │   └── config.js          # Configuration management
│   ├── handlers/
│   │   ├── buttonHandler.js   # RSVP button interactions
│   │   ├── messageHandler.js  # Message command handling
│   │   └── slashCommandHandler.js # Slash command processing
│   ├── services/
│   │   ├── databaseService.js # SQLite database operations
│   │   ├── discordService.js  # Discord API interactions
│   │   ├── faceitService.js   # FACEIT API calls
│   │   └── notificationService.js # Match notifications
│   └── utils/
│       ├── errorHandler.js    # Error handling and logging
│       └── helpers.js         # Utility functions
├── data/
│   ├── bot.db                 # SQLite database (auto-created)
│   └── json_backups/          # Backup files
├── Dockerfile                 # Container configuration
├── compose.yaml              # Docker Compose setup
├── package.json              # Node.js dependencies
├── .env.example              # Environment template
└── README.md                 # This file
```

## Container Details

- **Base Image**: `node:lts-alpine`
- **Exposed Port**: 8080 (health check endpoint)
- **Volume Mount**: `./data:/app/data` (persistent database storage)
- **Health Check**: HTTP endpoint at `/health`
- **Restart Policy**: `unless-stopped`
- **Log Rotation**: 10MB max size, 3 files retained

## Monitoring and Maintenance

### Container Management
```bash
# View container status
docker compose ps

# View real-time logs
docker compose logs -f bot

# Restart the bot
docker compose restart bot

# Stop the bot
docker compose down

# Update and rebuild
git pull
docker compose up -d --build
```

### Health Monitoring
```bash
# Check health endpoint
curl http://localhost:8080/health

# View container health status
docker compose ps
```

### Database Backup
```bash
# The SQLite database is automatically persisted in ./data/
# To backup:
cp ./data/bot.db ./data/bot.db.backup

# To restore:
cp ./data/bot.db.backup ./data/bot.db
docker compose restart bot
```

## Troubleshooting

### Bot Not Starting
1. Check Docker logs: `docker compose logs bot`
2. Verify all required environment variables are set
3. Ensure Discord bot token is valid
4. Check FACEIT API key permissions

### Commands Not Working
1. Verify bot has necessary Discord permissions
2. Check if slash commands are registered: look for registration messages in logs
3. For guild-specific commands, ensure `DISCORD_GUILD_ID` is correct
4. Global commands can take up to 1 hour to propagate

### No Match Notifications
1. Verify `TEAM_ID` is correct (UUID format)
2. Check `FACEIT_API_KEY` has access to team data
3. Ensure `DISCORD_CHANNEL_ID` is valid
4. Check scheduled task logs (every 30 minutes)

### Database Issues
1. Check `./data` directory permissions
2. Verify SQLite database file exists: `./data/bot.db`
3. Container runs as `node` user - ensure proper file ownership

### Performance Issues
1. Monitor API rate limits in logs
2. Check memory usage: `docker stats faceit-discord-bot`
3. Review cache performance in application logs

## Configuration Options

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `FACEIT_API_KEY` | Yes | Your FACEIT API key | `abc123...` |
| `TEAM_ID` | Yes | FACEIT team UUID | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token | `MTIzNDU2Nzg5...` |
| `DISCORD_CLIENT_ID` | Yes | Discord application ID | `123456789012345678` |
| `DISCORD_CHANNEL_ID` | Yes | Channel for notifications | `987654321098765432` |
| `ADMIN_DISCORD_ID` | Yes | Admin user Discord ID | `111222333444555666` |
| `DISCORD_GUILD_ID` | No | Server ID for faster command deployment | `777888999000111222` |
| `CHECK_INTERVAL` | No | Match check frequency (cron) | `*/30 * * * *` |
| `LOG_LEVEL` | No | Logging verbosity | `info` |

### Scheduled Tasks

- **Match Check**: Every 30 minutes (configurable)
- **Database Cleanup**: Every 6 hours
- **Cache Cleanup**: Every 10 minutes

## API Integration

### FACEIT API Usage
- Championship match queries
- Team member lookup
- Player match history
- Match details and statistics
- Respects rate limits with caching

### Discord API Features
- Slash command registration
- Rich embed messages
- Interactive button components
- Thread creation for match discussions
- User and server management

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with Docker
5. Submit a pull request

## Support

For issues and questions:
1. Check the troubleshooting section above
2. Review container logs
3. Create an issue with logs and configuration details
