## This was *vibe* coded.

<img width="720" height="720" alt="faceit-discord" src="https://github.com/user-attachments/assets/28f118bf-b64a-4f18-9656-88caba522a5b" />
<img width="720" height="560" alt="Untitled design" src="https://github.com/user-attachments/assets/50082855-6198-49ec-8abc-96b8895d6fd4" />

# FACEIT Discord Bot

A Discord bot that automatically monitors your FACEIT team's CS2 matches and provides interactive RSVP functionality. Players can link their Discord accounts to FACEIT profiles and get notifications about upcoming matches with one-click attendance confirmation.

## Key Features

- **🎯 Automatic Match Detection** - Monitors your team's matches every 30 minutes
- **💬 Match Threads** - Creates dedicated Discord threads for each match with RSVP buttons
- **🔗 Account Linking** - One-click registration system to link Discord ↔ FACEIT accounts
- **📊 Match Tracking** - View upcoming/finished matches and player statistics
- **🔧 Admin Tools** - Backup system, cache management, and user administration
- **🐳 Docker Ready** - Easy deployment with automatic restarts and health monitoring

## Commands

**For Everyone:**
- `/help` - Show all available commands
- `/matches` - View upcoming matches
- `/register` - Link your Discord to FACEIT (one-click)
- `/profile` - View your linked FACEIT profile
- `/lookup <player>` - Search FACEIT players
- `/finishedmatches` - View recent match results

**Admin Only:**
- `/backup-create` - Manual database backup
- `/clear-cache` - Clear bot caches
- `/clean-rsvp-status` - Reset RSVP data

## Quick Setup

### 1. Get Required IDs and Tokens

**FACEIT API:**
- Get API key from [FACEIT Developer Portal](https://developers.faceit.com/)
- Find your team ID from your FACEIT team page URL: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

**Discord Bot:**
- Create bot at [Discord Developer Portal](https://discord.com/developers/applications)
- Copy bot token and bot client ID
- Invite bot to server with "All Chat" permissions
- Copy channel ID where you want notifications (enable Developer Mode in Discord)
- Copy your Discord user ID (for admin commands)

### 2. Configure Environment

Create a `.env` file:

```env
# FACEIT
FACEIT_API_KEY=your_faceit_api_key_here
TEAM_ID=your_faceit_team_id_here

# Discord
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here
DISCORD_CHANNEL_ID=your_discord_channel_id_here
ADMIN_DISCORD_ID=your_discord_user_id_here

# Optional (for faster command deployment)
DISCORD_GUILD_ID=your_discord_server_id_here
```

### 3. Deploy

```bash
git clone https://github.com/your-repo/faceit-discord-bot.git
cd faceit-discord-bot
docker compose up -d
```

### 4. Verify

- Bot should be online in Discord
- Test with `/help` command
- Check health: `http://localhost:8080/health`

## Management

```bash
# View logs
docker compose logs -f bot

# Restart bot
docker compose restart bot

# Update and rebuild
git pull && docker compose up -d --build

# Manual backup
cp ./data/bot.db ./data/bot.db.backup
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

## How It Works

- **Match Detection**: Checks FACEIT API every 30 minutes for new team matches
- **Thread Creation**: Creates Discord threads with RSVP buttons for each match
- **Account Linking**: Players use `/register` to link Discord ↔ FACEIT accounts
- **Data Storage**: SQLite database persists user links and RSVP data
- **Backup System**: Automatic backups every 6 hours + manual backup commands

---

**Built for competitive CS2 teams** • **Docker containerized** • **MIT License**
