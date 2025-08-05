# FACEIT Enemy Team Analysis - Update Documentation

## Overview
Updated the FACEIT API service (`faceitService.js`) with comprehensive enemy team analysis capabilities to gather detailed statistics about opposing players before matches.

## New Features Added

### 1. Enemy Team Identification
- **Method**: `getEnemyTeamFromMatch(matchDetails)`
- **Purpose**: Determines which faction is the enemy team based on your configured team ID
- **Returns**: Enemy faction data, your faction data, and enemy player roster

### 2. Individual Player Analysis  
- **Method**: `getPlayerDetailedStats(playerId, nickname)`
- **Purpose**: Fetches comprehensive stats for individual players including:
  - FACEIT ELO and skill level
  - K/D ratio and match statistics
  - Recent match history (last 20 games)
  - Headshot percentage
  - Win rate and games played
- **Features**: Proper error handling and caching integration

### 3. Comprehensive Team Analysis
- **Method**: `getEnemyTeamAnalysis(matchId)`
- **Purpose**: Main method that provides complete enemy team analysis
- **Features**:
  - Rate-limited API calls (100ms delay between player requests)
  - Calculates team averages for all key metrics
  - Identifies top threats and star players
  - Generates threat level assessment
  - Provides tactical recommendations

### 4. Team Statistics Calculation
- **Method**: `calculateTeamAnalysis(players)`
- **Calculates**:
  - Average ELO, K/D ratio, headshot %, win rate
  - Team threat level (VERY LOW to VERY HIGH)
  - Identifies top fraggers and key threats
  - Generates tactical recommendations

### 5. Map-Specific Analysis (Optional)
- **Method**: `getEnemyMapAnalysis(matchId, mapName)`  
- **Purpose**: Attempts to extract map-specific performance from player history
- **Note**: Limited by available FACEIT API data

## Cache Enhancements

### New Cache TTL Settings
- `player_stats`: 60 minutes (player statistics)
- `player_history`: 30 minutes (match history)
- `map_stats`: 120 minutes (map-specific data)

### New Cache Methods
- `getPlayerStats(playerId, game, sourceFunction)`
- `getPlayerHistory(playerId, game, sourceFunction)`
- `getPlayerMapStats(playerId, map, sourceFunction)`
- `getPlayerSearch(query, sourceFunction)` - Fixed missing method

## Rate Limiting & API Efficiency

### Implemented Features:
1. **Caching Strategy**: All API calls are cached with appropriate TTL values
2. **Rate Limiting**: 100ms delay between individual player stat requests
3. **Request Deduplication**: Existing cache architecture prevents duplicate API calls
4. **Error Handling**: Graceful degradation when individual player stats fail

### API Endpoints Used:
- `/players/{player_id}` - Basic player data
- `/players/{player_id}/stats/cs2` - CS2 statistics
- `/players/{player_id}/history` - Match history

## Usage Examples

```javascript
// Get comprehensive enemy analysis for a match
const analysis = await faceitService.getEnemyTeamAnalysis(matchId);

// Result structure:
{
  matchId: "match-id",
  enemyTeam: {
    name: "Enemy Team Name",
    players: [/* detailed player stats */]
  },
  analysis: {
    teamAverages: { elo: 1450, kdRatio: "1.15", ... },
    threatLevel: { level: "HIGH", score: 75, color: "🟠" },
    recommendations: ["Focus on positioning", "Watch for star players"],
    topPlayer: { nickname: "PlayerName", elo: 1800, ... }
  }
}

// Get basic enemy team identification
const enemyData = faceitService.getEnemyTeamFromMatch(matchDetails);

// Get individual player stats
const playerStats = await faceitService.getPlayerDetailedStats(playerId, nickname);
```

## Performance Considerations

1. **Initial Analysis**: First-time analysis may take 1-2 seconds due to API calls
2. **Cached Analysis**: Subsequent requests are near-instantaneous
3. **Memory Usage**: Proper cache TTL prevents memory bloat
4. **API Limits**: Rate limiting respects FACEIT API constraints

## Error Handling

- Individual player failures don't break entire analysis
- Missing data is handled gracefully with defaults
- Comprehensive logging for debugging
- Cache failures fall back to direct API calls

## Future Enhancements

1. **Map Statistics**: Could be enhanced with dedicated map analysis endpoints
2. **Team Composition**: Analysis of team roles and playstyles
3. **Historical Performance**: Head-to-head records against your team
4. **Real-time Updates**: Integration with live match data

## Integration Points

This service integrates with:
- Existing cache architecture (`cache.js`)
- Configuration system (`config.js`) 
- Helper utilities (`utils/helpers.js`)
- Database layer for persistent caching

The implementation maintains backward compatibility with all existing FACEIT service methods.
