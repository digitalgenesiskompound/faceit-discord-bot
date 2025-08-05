# FACEIT Discord Bot - Feature Documentation

This document provides detailed information about the key features of the FACEIT Discord Bot, specifically the `/team` command and the "Analyze" button functionality.

## Table of Contents
- [The `/team` Command](#the-team-command)
- [The "Analyze" Button Feature](#the-analyze-button-feature)
- [Developer Notes](#developer-notes)
- [Troubleshooting](#troubleshooting)

---

## The `/team` Command

### Purpose
The `/team` command displays a comprehensive list of all team players who have linked their Discord accounts to their FACEIT profiles. This provides an easy way to see which team members are registered in the bot system and available for match notifications.

### Usage
```
/team
```

### Output
The command returns a private (ephemeral) embed message containing:

- **Total count** of registered players
- **Player list** with:
  - FACEIT profile links (clickable)
  - Discord mentions (shows Discord username)
  - Skill level (e.g., "Level 7" or "Unranked")
  - ELO rating (if available)
  - Country flag and code (if available)

### Example Output
```
👥 Registered Team Players
Found 5 player(s) with linked Discord accounts:

[PlayerOne](https://www.faceit.com/en/players/PlayerOne) - @discord_user1
🏆 Level 8 (2,100 ELO) 🌍 US

[PlayerTwo](https://www.faceit.com/en/players/PlayerTwo) - @discord_user2
🏆 Level 6 (1,750 ELO) 🌍 CA

[PlayerThree](https://www.faceit.com/en/players/PlayerThree) - @discord_user3
🏆 Unranked

... and more players
```

### Features
- **Private Response**: Only the command user can see the results
- **Clickable Links**: FACEIT profile links open directly in browser
- **Discord mentions**: Shows actual Discord usernames for easy identification
- **Skill Information**: Displays current FACEIT level and ELO if available
- **Geographic Info**: Shows country if available in FACEIT profile
- **Dynamic Sizing**: Handles long lists by truncating if necessary

### Use Cases
- **Team Management**: See who's registered and available for matches
- **Roster Verification**: Ensure all team members have linked accounts
- **Quick Reference**: Get FACEIT profiles and Discord users in one view
- **Registration Status**: Identify who still needs to use `/register`

### Limitations
- Only shows players who have linked their accounts using `/register` or `/link`
- Limited to 4,000 characters (very long lists get truncated)
- Does not show FACEIT players who haven't linked Discord accounts
- Information updates when players use `/register` or stats are refreshed

---

## The "Analyze" Button Feature

### Purpose
The "Analyze" button appears in match threads and provides detailed enemy team analysis. It fetches comprehensive data about opposing players to help your team prepare strategically for the match.

### Location
- Appears as an orange button in **INCOMING match threads**
- Located alongside RSVP buttons (Yes/No/Status)
- Added automatically when match threads are created
- Can be added to existing threads using the update script

### Button Appearance
```
📊 Analyze Enemy Team
```

### Output
When clicked, the button provides a comprehensive enemy team analysis including:

#### Individual Player Data
For each enemy player:
- **FACEIT Nickname**: Player's display name
- **ELO Rating**: Current skill rating (if available)
- **K/D Ratio**: Average kill/death ratio
- **Match Statistics**: 
  - Total maps won
  - Total maps lost
  - Win percentage (calculated)

#### Analysis Format
```
🔍 Enemy Team Analysis
Analysis of the enemy team for match [match_id]

PlayerName1
ELO: 2,100, K/D: 1.45, Major Maps Won: 250, Major Maps Lost: 180

PlayerName2
ELO: 1,890, K/D: 1.23, Major Maps Won: 180, Major Maps Lost: 195

PlayerName3
ELO: 2,350, K/D: 1.67, Major Maps Won: 420, Major Maps Lost: 280

[... continues for all enemy players]
```

### Data Sources
- **FACEIT API**: Real-time player statistics
- **Match Details**: Current match lineup information
- **Player Profiles**: Individual skill and performance data
- **Cached Data**: Some information may be cached for performance

### Use Cases
- **Strategic Planning**: Understand enemy skill levels before the match
- **Player Analysis**: Identify key threats and weaker opponents
- **Team Preparation**: Discuss tactics based on enemy statistics
- **Performance Comparison**: Compare enemy ratings to your team's levels

### Features
- **Private Response**: Analysis is only visible to the user who clicked
- **Real-time Data**: Fetches current statistics from FACEIT API
- **Comprehensive Stats**: Multiple data points per player
- **Error Handling**: Graceful fallback if player data unavailable
- **Match Context**: Specifically analyzes the current match's enemy team

### Limitations
- **Private Only**: Each user must click the button individually to see analysis
- **API Dependent**: Requires FACEIT API to be accessible
- **Data Availability**: Some players may have limited public statistics
- **Rate Limiting**: Multiple rapid clicks may hit API rate limits
- **Match Specific**: Only analyzes the current match's opponent roster

### Technical Notes
- Button uses custom ID format: `analyze_enemy_[matchId]`
- Determines enemy team by comparing with configured team ID
- Fetches detailed player data for each roster member
- Handles missing or incomplete player statistics gracefully

---

## Developer Notes

### Code Structure

#### `/team` Command Implementation
- **File**: `src/handlers/slashCommandHandler.js` (lines 1428-1493)
- **Method**: `handleTeamCommand(interaction)`
- **Database Query**: Uses `getAllUserMappings()` method
- **Response Type**: Ephemeral embed with player list

#### "Analyze" Button Implementation
- **File**: `src/handlers/buttonHandler.js` (lines 316-375)
- **Method**: `handleAnalyzeEnemyButton(interaction)`
- **Button Detection**: Custom ID pattern `analyze_enemy_*`
- **API Calls**: Multiple FACEIT API requests per analysis

### Database Dependencies

#### User Mappings Table
The `/team` command relies on the user mappings table structure:
```sql
CREATE TABLE user_mappings (
    discord_id TEXT PRIMARY KEY,
    discord_username TEXT,
    faceit_nickname TEXT,
    faceit_player_id TEXT,
    faceit_skill_level TEXT,
    faceit_elo TEXT,
    country TEXT,
    created_at TEXT,
    updated_at TEXT
);
```

#### Match Threads Table
Both features interact with match thread tracking:
```sql
CREATE TABLE match_threads (
    match_id TEXT PRIMARY KEY,
    thread_id TEXT,
    thread_type TEXT,
    created_at TEXT
);
```

### Service Dependencies

#### Required Services
- **DatabaseService**: User mapping and match thread data
- **FaceitService**: API calls for match and player data
- **EmbedService**: Message formatting (for analyze feature)
- **DiscordService**: Thread management and message handling

#### API Rate Limiting
- **FACEIT API**: Limited requests per minute
- **Caching**: Implemented to reduce API calls
- **Error Handling**: Graceful degradation on API failures

### Button Integration

#### Thread Creation
Analyze buttons are added during thread creation in:
- `src/services/discordService.js` - `createMatchThread()` method
- `src/services/threadService.js` - Button component creation

#### Existing Thread Updates
For adding buttons to existing threads:
- `src/scripts/update-existing-threads.js` - Batch update script
- Identifies INCOMING type threads without analyze buttons
- Adds buttons while preserving existing content

### Maintenance Considerations

#### Regular Updates
- **User Statistics**: Automatically updated when users interact
- **Match Data**: Refreshed during scheduled match checks
- **Cache Invalidation**: Handled by cache service TTL

#### Monitoring Points
- **API Response Times**: Monitor FACEIT API performance
- **Database Query Performance**: Watch for slow user mapping queries
- **Button Click Rates**: Track analyze button usage for optimization
- **Error Rates**: Monitor failed API calls or database errors

#### Scalability Notes
- **User Mapping Growth**: Linear growth with team size
- **Analysis Requests**: Can spike during match times
- **Database Size**: User mappings table grows with registrations
- **Cache Memory**: Player data caching increases with usage

---

## Troubleshooting

### `/team` Command Issues

#### "No registered team players found"
**Cause**: No users have linked their FACEIT accounts
**Solution**: 
- Team members need to use `/register` command
- Check if database user mappings table has data
- Verify database connection is healthy

#### Empty or incomplete player information
**Cause**: Missing data in user mappings
**Solution**:
- Players should re-register using `/register`
- Check FACEIT API connectivity
- Verify user mapping database schema

#### Command not responding
**Cause**: Database or Discord API issues
**Solution**:
- Check bot logs for database errors
- Verify Discord bot permissions
- Restart bot if necessary using `/restart-bot`

### "Analyze" Button Issues

#### Button not appearing in match threads
**Cause**: Thread created before analyze feature was implemented
**Solution**:
- Run the update script: `docker compose exec bot node src/scripts/update-existing-threads.js`
- Or wait for new match threads to be created
- Check if thread type is "INCOMING" (finished matches don't get analyze buttons)

#### "Error analyzing enemy team"
**Cause**: FACEIT API issues or missing match data
**Solution**:
- Check FACEIT API status and rate limits
- Verify match ID is valid and recent
- Check bot logs for specific API error messages
- Try again after a few minutes (rate limiting)

#### Incomplete player analysis
**Cause**: Some enemy players have private profiles or missing stats
**Solution**:
- This is expected behavior for private FACEIT profiles
- Analysis will show available data only
- "N/A" appears for unavailable statistics

#### Multiple button clicks causing errors
**Cause**: FACEIT API rate limiting
**Solution**:
- Wait a few minutes between button clicks
- Consider implementing user-level cooldowns
- Check rate limit headers in API responses

### General Issues

#### Database connectivity problems
**Cause**: SQLite file permissions or corruption
**Solution**:
- Check `/app/data/bot.db` file permissions in container
- Use `/backup-create` command to create backup before repairs
- Restart container if database locks persist

#### Performance degradation
**Cause**: Large user mapping tables or cache issues
**Solution**:
- Use `/clear-cache` command to refresh caches
- Monitor database query performance
- Consider pagination for very large teams (50+ players)

#### Discord permission issues
**Cause**: Bot missing required permissions
**Solution**:
- Verify bot has "Manage Threads" permission
- Check "Use Slash Commands" permission
- Ensure bot can read message history in threads

### Logging and Debugging

#### Enable Debug Logging
Check bot logs with:
```bash
docker compose logs -f bot
```

#### Key Log Messages
- `User [username] requested team player list` - `/team` command usage
- `User [username] clicked analyze enemy button` - Analyze button usage
- `Error handling /team command:` - Team command failures
- `Error handling analyze enemy button:` - Analyze button failures

#### Performance Monitoring
- Database query times in debug logs
- FACEIT API response times
- Memory usage via `docker stats`
- Button click frequency and error rates

---

## Future Enhancements

### Potential Improvements

#### `/team` Command
- **Sorting Options**: Sort by skill level, ELO, or registration date
- **Filtering**: Show only online players or specific skill ranges
- **Statistics**: Add team average ELO and skill distribution
- **Export**: Option to export team roster to CSV or JSON

#### "Analyze" Button
- **Team Comparison**: Compare enemy team average to your team
- **Historical Data**: Show enemy team's recent match performance
- **Map Statistics**: Enemy performance on specific maps
- **Tactical Insights**: AI-generated strategy suggestions based on analysis

#### General Features
- **Public Analysis**: Option to share analysis with entire thread
- **Scheduled Analysis**: Automatic enemy analysis when matches are created
- **Analysis History**: Store and retrieve previous enemy team analyses
- **Integration**: Connect with other esports platforms for additional data

### Implementation Considerations
- **API Rate Limits**: More features require careful rate limit management
- **Database Growth**: Historical data storage needs planning
- **User Experience**: Balance between features and simplicity
- **Performance**: Ensure new features don't slow down existing functionality

---

*This documentation is maintained alongside the bot codebase. Last updated: January 2025*
