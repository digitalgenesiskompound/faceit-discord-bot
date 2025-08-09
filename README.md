## This was *vibe* coded.


<img width="720" height="720" alt="faceit-discord" src="https://github.com/user-attachments/assets/28f118bf-b64a-4f18-9656-88caba522a5b" />
<img width="720" height="560" alt="Untitled design" src="https://github.com/user-attachments/assets/50082855-6198-49ec-8abc-96b8895d6fd4" />

# FACEIT Discord Bot

A Discord bot that monitors your FACEIT team's CS2 matches and posts interactive RSVP threads in Discord. Players can link their Discord accounts to FACEIT and respond with one click.
## Features

- Automatic match detection (every 30 minutes)
- Per-match Discord threads with RSVP buttons
- One-click account linking (Discord ↔ FACEIT)
- Team roster view and player profiles
- Optional enemy analysis in match threads
- Admin tools (backups, cache management)
- Docker-ready deployment

## Commands

Everyone:
- /help — list commands
- /register — one-click link Discord ↔ FACEIT
- /matches — upcoming matches
- /finishedmatches — recent results
- /team — team roster
- /profile — your linked FACEIT profile
- /lookup <player> — search FACEIT

Admins:
- /edit-rsvp — interactive, staged editor for any user’s RSVP (with search/pagination)
- /backup-create — manual DB backup
- /clear-cache — clear caches
- /clean-rsvp-status — reset RSVP data

## Quick Setup

1) Create a Discord bot
- Create an app at https://discord.com/developers/applications
- Add a Bot user, copy Bot Token and Client ID
- Invite it to your server (Bot + applications.commands scope)

2) Get FACEIT details
- Create an API key at https://developers.faceit.com/
- Find your Team ID (UUID from your FACEIT team URL)

3) Configure environment (.env)

```env
# FACEIT
FACEIT_API_KEY=your_faceit_api_key
TEAM_ID=your_faceit_team_id

# Discord
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CHANNEL_ID=the_channel_for_notifications
ADMIN_DISCORD_ID=your_discord_user_id
# Optional: restrict command registration to one server (faster updates)
DISCORD_GUILD_ID=your_guild_id
# Optional: grant mod rights without a role
MODERATOR_DISCORD_IDS=111111111111111111,222222222222222222

# Startup tuning (optional)
STARTUP_RECOVERY=true
STARTUP_VALIDATION_DELAY_MS=30000
```

4) Run with Docker

```bash
git clone https://github.com/digitalgenesiskompound/faceit-discord-bot.git
cd faceit-discord-bot
docker compose up -d
```

5) Verify
- Bot online in Discord
- Try /help
- Health: http://localhost:8080/health

## Management

```bash
# Logs
docker compose logs -f bot

# Restart
docker compose restart bot

# Update + rebuild
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
- **Thread Creation**: Creates Discord threads with RSVP buttons and enemy analysis for each match
- **Account Linking**: Players use `/register` to link Discord ↔ FACEIT accounts
- **Data Storage**: SQLite database persists user links and RSVP data
- **Backup System**: Automatic backups every 6 hours + manual backup commands

## Notes
- Global slash commands can take up to 1 hour to propagate. Use DISCORD_GUILD_ID for faster, per-server updates.
- The bot stores data in ./data/bot.db (SQLite). Back up this file to preserve state.
- If startup feels slow, set STARTUP_RECOVERY=false and/or increase STARTUP_VALIDATION_DELAY_MS.

---
Built for competitive CS2 teams • Docker containerized • MIT License
