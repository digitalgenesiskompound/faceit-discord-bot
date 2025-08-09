const { makeApiRequest } = require('../utils/helpers');
const config = require('../config/config');
const cache = require('./cache');
const databaseInstance = require('../database/database');

class FaceitService {
  constructor() {
    this.cache = cache;
    this.db = databaseInstance;
    
    // Track ongoing requests to prevent duplicates
    this.pendingRequests = new Map();
    
  }

  /**
   * Make API request with simple error handling
   */
  async makeProtectedApiRequest(url, options, context) {
    const operationType = context?.operation || 'faceit_api_call';
    console.log(`🌐 Making API request: ${operationType}`);
    
    try {
      return await makeApiRequest(url, options, context);
    } catch (error) {
      console.error(`❌ API request failed for ${operationType}:`, error.message);
      throw error;
    }
  }
  /**
   * Get upcoming matches for the team
   */
  async getUpcomingMatches() {
    return await this.cache.getUpcomingMatches(async () => {
      const matches = [];
      const matchIds = new Set();
      
      // Method 1: Check championship matches
      try {
        console.log('🔍 Getting upcoming matches from championship...');
        const champData = await this.makeProtectedApiRequest(
          `https://open.faceit.com/data/v4/championships/${config.faceit.competitionId}/matches`,
          {
            params: { limit: 100 }
          },
          {
            operation: 'get_championship_matches',
            competitionId: config.faceit.competitionId
          }
        );
        
        if (champData && champData.items) {
          console.log(`Found ${champData.items.length} championship matches total`);
          
          // Filter for team matches
          const teamMatches = champData.items.filter(match => {
            if (!match.teams || !match.teams.faction1 || !match.teams.faction2) return false;
            
            const faction1Id = match.teams.faction1.faction_id;
            const faction2Id = match.teams.faction2.faction_id;
            
            return (faction1Id === config.faceit.teamId || faction2Id === config.faceit.teamId) && 
                   !match.finished_at && 
                   match.status !== 'FINISHED';
          });
          
          console.log(`Found ${teamMatches.length} upcoming team matches in championship`);
          
          // Add to matches list
          for (const match of teamMatches) {
            if (!matchIds.has(match.match_id)) {
              matchIds.add(match.match_id);
              matches.push(match);
            }
          }
        }
      } catch (err) {
        console.error(`Error getting championship matches: ${err.message}`);
      }
      
      // Reduced fallback approach - only if no matches found
      if (matches.length === 0) {
        console.log(`No matches found in championship, trying single player fallback...`);
        try {
          const teamData = await this.cache.getTeamData('team_data', async () => {
            return await this.makeProtectedApiRequest(
              `https://open.faceit.com/data/v4/teams/${config.faceit.teamId}`,
              {},
              {
                operation: 'get_team_data',
                teamId: config.faceit.teamId
              }
            );
          });
          
          if (teamData && teamData.members && teamData.members.length > 0) {
            // Only check first player to reduce API calls
            const firstPlayer = teamData.members[0];
            console.log(`Checking match history for player: ${firstPlayer.nickname}`);
            
            const playerHistory = await this.makeProtectedApiRequest(
              `https://open.faceit.com/data/v4/players/${firstPlayer.user_id}/history`,
              {
                params: { game: 'cs2', limit: 10 } // Reduced limit
              },
              {
                operation: 'get_player_history',
                playerId: firstPlayer.user_id,
                playerNickname: firstPlayer.nickname
              }
            );
            
            if (playerHistory && playerHistory.items) {
              // Find upcoming matches
              const upcomingMatches = playerHistory.items.filter(match => 
                !match.finished_at && 
                match.status !== 'FINISHED' && 
                match.status !== 'CANCELLED'
              ).slice(0, 3); // Limit to 3 matches max
              
              // Check each match (with caching)
              for (const match of upcomingMatches) {
                if (!matchIds.has(match.match_id)) {
                  const fullMatch = await this.cache.getMatchDetails(match.match_id, async () => {
                    return await this.makeProtectedApiRequest(
                      `https://open.faceit.com/data/v4/matches/${match.match_id}`,
                      {},
                      {
                        operation: 'get_full_match_data',
                        matchId: match.match_id
                      }
                    );
                  });
                  
                  if (fullMatch && fullMatch.teams) {
                    const faction1Id = fullMatch.teams.faction1?.faction_id;
                    const faction2Id = fullMatch.teams.faction2?.faction_id;
                    
                    if (faction1Id === config.faceit.teamId || faction2Id === config.faceit.teamId) {
                      matchIds.add(match.match_id);
                      matches.push(fullMatch);
                    }
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error(`Error with player history approach: ${err.message}`);
        }
      }
      
      console.log(`Total upcoming matches found: ${matches.length}`);
      return matches;
    });
  }

  /**
   * Get team players
   */
  async listTeamPlayers() {
    return await this.cache.getTeamData('team_players', async () => {
      console.log('📊 Fetching team players from API...');
      const teamData = await this.makeProtectedApiRequest(
        `https://open.faceit.com/data/v4/teams/${config.faceit.teamId}`,
        {},
        {
          operation: 'list_team_players',
          teamId: config.faceit.teamId
        }
      );
      
      if (teamData && teamData.members) {
        console.log(`Found ${teamData.members.length} players`);
        return teamData.members;
      }
      console.log('No players found');
      return [];
    });
  }

  /**
   * Get finished matches for the team - optimized with caching
   */
  async getFinishedMatches(limit = 20) {
    return await this.cache.getFinishedMatches(async () => {
      const finishedMatches = [];
      const matchIds = new Set();
      
      try {
        console.log('🏆 Getting finished matches from championship...');
        
        const champData = await this.makeProtectedApiRequest(
          `https://open.faceit.com/data/v4/championships/${config.faceit.competitionId}/matches`,
          {
            params: { 
              limit: 100,
              offset: 0
            }
          },
          {
            operation: 'get_championship_finished_matches',
            competitionId: config.faceit.competitionId
          }
        );
      
        if (champData && champData.items) {
          // Filter for finished team matches
          const teamFinishedMatches = champData.items.filter(match => {
            if (!match.teams || !match.teams.faction1 || !match.teams.faction2) return false;
            
            const faction1Id = match.teams.faction1.faction_id;
            const faction2Id = match.teams.faction2.faction_id;
            
            return (faction1Id === config.faceit.teamId || faction2Id === config.faceit.teamId) && 
                   (match.finished_at || match.status === 'FINISHED');
          });
          
          console.log(`Found ${teamFinishedMatches.length} finished team matches in championship`);
          
          // Sort by finished_at descending (most recent first)
          teamFinishedMatches.sort((a, b) => {
            const finishedA = a.finished_at || 0;
            const finishedB = b.finished_at || 0;
            return finishedB - finishedA;
          });
          
          // Add to matches list
          for (const match of teamFinishedMatches.slice(0, limit)) {
            if (!matchIds.has(match.match_id)) {
              matchIds.add(match.match_id);
              finishedMatches.push(match);
            }
          }
        }
      } catch (err) {
        console.error(`Error getting finished championship matches: ${err.message}`);
      }
      
      // Additional fallback: check player history for more finished matches
      if (finishedMatches.length < limit) {
        console.log(`🔍 Checking player history for additional finished matches (found ${finishedMatches.length}/${limit} so far)...`);
        try {
          const teamData = await this.cache.getTeamData('team_data_finished', async () => {
            return await this.makeProtectedApiRequest(
              `https://open.faceit.com/data/v4/teams/${config.faceit.teamId}`,
              {},
              {
                operation: 'get_team_data_for_finished_matches',
                teamId: config.faceit.teamId
              }
            );
          });
          
          if (teamData && teamData.members && teamData.members.length > 0) {
            // Check first player's history for additional finished matches
            const firstPlayer = teamData.members[0];
            console.log(`📈 Checking finished match history for player: ${firstPlayer.nickname}`);
            
            const playerHistory = await this.makeProtectedApiRequest(
              `https://open.faceit.com/data/v4/players/${firstPlayer.user_id}/history`,
              {
                params: { game: 'cs2', limit: 30 } 
              },
              {
                operation: 'get_player_finished_history',
                playerId: firstPlayer.user_id,
                playerNickname: firstPlayer.nickname
              }
            );
            
            if (playerHistory && playerHistory.items) {
              // Find finished matches
              const playerFinishedMatches = playerHistory.items.filter(match => 
                (match.finished_at || match.status === 'FINISHED') &&
                match.status !== 'CANCELLED'
              );
              
              console.log(`🎯 Found ${playerFinishedMatches.length} finished matches in player history`);
              
              // Check each match to see if it's a team match we haven't found yet
              for (const match of playerFinishedMatches.slice(0, 10)) {
                if (!matchIds.has(match.match_id) && finishedMatches.length < limit) {
                  const fullMatch = await this.cache.getMatchDetails(match.match_id, async () => {
                    return await this.makeProtectedApiRequest(
                      `https://open.faceit.com/data/v4/matches/${match.match_id}`,
                      {},
                      {
                        operation: 'get_full_finished_match_data',
                        matchId: match.match_id
                      }
                    );
                  });
                  
                  if (fullMatch && fullMatch.teams) {
                    const faction1Id = fullMatch.teams.faction1?.faction_id;
                    const faction2Id = fullMatch.teams.faction2?.faction_id;
                    
                    if (faction1Id === config.faceit.teamId || faction2Id === config.faceit.teamId) {
                      matchIds.add(match.match_id);
                      finishedMatches.push(fullMatch);
                      console.log(`➕ Added additional finished match from player history: ${fullMatch.teams.faction1?.name} vs ${fullMatch.teams.faction2?.name}`);
                    }
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error(`Error with player history approach for finished matches: ${err.message}`);
        }
      }
      
      // Final sort by finished_at descending
      finishedMatches.sort((a, b) => {
        const finishedA = a.finished_at || 0;
        const finishedB = b.finished_at || 0;
        return finishedB - finishedA;
      });
      
      console.log(`Total finished matches found: ${finishedMatches.length}`);
      return finishedMatches;
    }, limit);
  }

  /**
   * Get match details by match ID - optimized with caching
   */
  async getMatchDetails(matchId) {
    return await this.cache.getMatchDetails(matchId, async () => {
      console.log(`🔍 Fetching match details for: ${matchId}`);
      return await this.makeProtectedApiRequest(
        `https://open.faceit.com/data/v4/matches/${matchId}`,
        {},
        {
          operation: 'get_match_details',
          matchId: matchId
        }
      );
    });
  }

  /**
   * Fetch match details bypassing cache (for time-sensitive validation like conversion)
   */
  async getMatchDetailsFresh(matchId) {
    console.log(`🔍 Fetching FRESH match details for: ${matchId}`);
    return await this.makeProtectedApiRequest(
      `https://open.faceit.com/data/v4/matches/${matchId}`,
      {},
      {
        operation: 'get_match_details_fresh',
        matchId: matchId
      }
    );
  }

  /**
   * Get player data by nickname - optimized with caching
   */
  async getPlayerByNickname(nickname) {
    return await this.cache.getPlayerData(nickname, async () => {
      console.log(`👤 Fetching player data for: ${nickname}`);
      return await this.makeProtectedApiRequest(
        `https://open.faceit.com/data/v4/players`,
        {
          params: { nickname }
        },
        {
          operation: 'get_player_by_nickname',
          nickname
        }
      );
    });
  }

  /**
   * Search for FACEIT accounts - now with optimized caching
   */
  async searchFaceitAccounts(query) {
    return await this.cache.getPlayerSearch(query, async () => {
      try {
        console.log(`🔍 Searching for FACEIT accounts with query: ${query}`);
        
        const response = await this.makeProtectedApiRequest(
          `https://open.faceit.com/data/v4/search/players`,
          {
            params: {
              nickname: query,
              limit: 10
            }
          },
          {
            operation: 'search_faceit_accounts',
            searchQuery: query
          }
        );
        
        if (response && response.items && response.items.length > 0) {
          console.log(`Found ${response.items.length} FACEIT accounts`);
          return response.items;
        } else {
          console.log('No FACEIT accounts found');
          return [];
        }
      } catch (error) {
        console.error(`Error searching FACEIT accounts: ${error.message}`);
        return [];
      }
    });
  }

  /**
   * Determine enemy team from match data
   */
  getEnemyTeamFromMatch(matchDetails) {
    if (!matchDetails || !matchDetails.teams) {
      console.error('Match details not found or incomplete');
      return null;
    }

    const faction1 = matchDetails.teams.faction1;
    const faction2 = matchDetails.teams.faction2;

    if (!faction1 || !faction2) {
      console.error('Match factions incomplete');
      return null;
    }

    // Determine which faction is the enemy team
    const enemyFaction = faction1.faction_id !== config.faceit.teamId ? faction1 : faction2;
    const yourFaction = faction1.faction_id === config.faceit.teamId ? faction1 : faction2;

    if (enemyFaction.faction_id === config.faceit.teamId) {
      console.error('Could not determine enemy team - both factions match your team ID');
      return null;
    }

    console.log(`🎯 Enemy team identified: ${enemyFaction.name} (${enemyFaction.roster?.length || 0} players)`);
    
    return {
      enemyFaction,
      yourFaction,
      enemyPlayers: enemyFaction.roster || []
    };
  }

  /**
   * Get individual player stats (ELO, K/D, games played, etc.)
   */
  async getPlayerDetailedStats(playerId, nickname = 'Unknown') {
    console.log(`📊 Getting detailed stats for player: ${nickname} (${playerId})`);

    try {
      // Get player's general data
      const playerData = await this.cache.getPlayerData(playerId, async () => {
        return await this.makeProtectedApiRequest(
          `https://open.faceit.com/data/v4/players/${playerId}`,
          {},
          {
            operation: 'get_player_data',
            playerId: playerId,
            playerNickname: nickname
          }
        );
      });

      // Get player's CS2 stats (includes map-specific data)
      const playerStats = await this.cache.getPlayerStats(playerId, 'cs2', async () => {
        return await this.makeProtectedApiRequest(
          `https://open.faceit.com/data/v4/players/${playerId}/stats/cs2`,
          {},
          {
            operation: 'get_player_stats',
            playerId: playerId,
            playerNickname: nickname
          }
        );
      });

      // Get recent match history for trend analysis
      const playerHistory = await this.cache.getPlayerHistory(playerId, 'cs2', async () => {
        return await this.makeProtectedApiRequest(
          `https://open.faceit.com/data/v4/players/${playerId}/history`,
          {
            params: { game: 'cs2', limit: 20 }
          },
          {
            operation: 'get_player_history',
            playerId: playerId,
            playerNickname: nickname
          }
        );
      });

      // Process map-specific stats
      const mapStats = this.processMapStats(playerStats?.segments || []);

      // Combine all data
      return {
        playerId,
        nickname: playerData?.nickname || nickname,
        country: playerData?.country,
        skill_level: playerData?.games?.cs2?.skill_level,
        faceit_elo: playerData?.games?.cs2?.faceit_elo,
        region: playerData?.games?.cs2?.region,
        game_player_id: playerData?.games?.cs2?.game_player_id,
        stats: playerStats?.lifetime || {},
        history: playerHistory?.items || [],
        mapStats: mapStats,
        profileData: playerData
      };
    } catch (error) {
      console.error(`❌ Error getting stats for player ${nickname}: ${error.message}`);
      return {
        playerId,
        nickname,
        error: error.message,
        stats: {},
        history: [],
        mapStats: {}
      };
    }
  }

  /**
   * Get comprehensive enemy team analysis for a match
   */
  async getEnemyTeamAnalysis(matchId) {
    console.log(`🔍 Starting comprehensive enemy team analysis for match: ${matchId}`);

    const matchDetails = await this.getMatchDetails(matchId);
    const enemyTeamData = this.getEnemyTeamFromMatch(matchDetails);
    
    if (!enemyTeamData) {
      return null;
    }

    const { enemyFaction, yourFaction, enemyPlayers } = enemyTeamData;
    
    // Get detailed stats for each enemy player with rate limiting
    const enemyPlayersWithStats = [];
    for (let i = 0; i < enemyPlayers.length; i++) {
      const player = enemyPlayers[i];
      console.log(`📈 Analyzing enemy player ${i + 1}/${enemyPlayers.length}: ${player.nickname}`);
      
      const detailedStats = await this.getPlayerDetailedStats(player.player_id, player.nickname);
      enemyPlayersWithStats.push({
        ...player,
        ...detailedStats
      });
      
      // Rate limiting: small delay between requests
      if (i < enemyPlayers.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Calculate team averages and insights
    const teamAnalysis = this.calculateTeamAnalysis(enemyPlayersWithStats);

    return {
      matchId,
      enemyTeam: {
        name: enemyFaction.name,
        faction_id: enemyFaction.faction_id,
        type: enemyFaction.type,
        players: enemyPlayersWithStats
      },
      yourTeam: {
        name: yourFaction.name,
        faction_id: yourFaction.faction_id
      },
      analysis: teamAnalysis,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Calculate team-wide statistics and insights
   */
  calculateTeamAnalysis(players) {
    const validPlayers = players.filter(p => p.stats && !p.error);
    
    if (validPlayers.length === 0) {
      return {
        error: 'No valid player stats found',
        playersAnalyzed: 0
      };
    }

    // Extract key stats
    const eloValues = validPlayers.map(p => parseInt(p.faceit_elo) || 0).filter(elo => elo > 0);
    const avgKdValues = validPlayers.map(p => parseFloat(p.stats['Average K/D Ratio']) || 0).filter(kd => kd > 0);
    const hsPercentages = validPlayers.map(p => parseFloat(p.stats['Average Headshots %']) || 0).filter(hs => hs > 0);
    const matchesPlayed = validPlayers.map(p => p.history.slice(0, 20).length).filter(m => m > 0);
    const winRates = validPlayers.map(p => parseFloat(p.stats['Win Rate %']) || 0).filter(wr => wr > 0);

    // Calculate averages
    const avgElo = eloValues.length > 0 ? Math.round(eloValues.reduce((a, b) => a + b, 0) / eloValues.length) : 0;
    const avgKd = avgKdValues.length > 0 ? (avgKdValues.reduce((a, b) => a + b, 0) / avgKdValues.length).toFixed(2) : '0.00';
    const avgHs = hsPercentages.length > 0 ? Math.round(hsPercentages.reduce((a, b) => a + b, 0) / hsPercentages.length) : 0;
    const avgMatches = matchesPlayed.length > 0 ? Math.round(matchesPlayed.reduce((a, b) => a + b, 0) / matchesPlayed.length) : 0;
    const avgWinRate = winRates.length > 0 ? Math.round(winRates.reduce((a, b) => a + b, 0) / winRates.length) : 0;

    // Find highest skilled player
    const topPlayer = validPlayers.reduce((max, player) => {
      const playerElo = parseInt(player.faceit_elo) || 0;
      const maxElo = parseInt(max.faceit_elo) || 0;
      return playerElo > maxElo ? player : max;
    }, validPlayers[0]);

    // Recent form analysis
    const recentFormAnalysis = this.analyzeRecentForm(validPlayers);
    
    // Team map analysis
    const mapAnalysis = this.calculateTeamMapAnalysis(validPlayers);

    return {
      playersAnalyzed: validPlayers.length,
      totalPlayers: players.length,
      teamAverages: {
        elo: avgElo,
        kdRatio: avgKd,
        headshotPercentage: avgHs,
        matchesPlayed: avgMatches,
        winRate: avgWinRate
      },
      topPlayer: {
        nickname: topPlayer.nickname,
        elo: topPlayer.faceit_elo,
        skill_level: topPlayer.skill_level,
        kdRatio: topPlayer.stats['K/D Ratio'] || 'N/A'
      },
      threatLevel: this.calculateThreatLevel(avgElo, parseFloat(avgKd), avgWinRate),
      recentForm: recentFormAnalysis,
      mapAnalysis: mapAnalysis
    };
  }

  /**
   * Analyze recent form of enemy players
   */
  analyzeRecentForm(players) {
    const recentMatches = [];
    
    players.forEach(player => {
      if (player.history && player.history.length > 0) {
        // Get last 5 matches
        const recent = player.history.slice(0, 5);
        
        // Count wins by checking if player was on winning team
        let wins = 0;
        recent.forEach(match => {
          if (match.results && match.results.winner) {
            // Check if player was on the winning team by comparing faction IDs
            const winningFactionId = match.results.winner;
            if (match.teams) {
              // Check if player was in faction1 or faction2 and if that faction won
              const playerInFaction1 = match.teams.faction1 && 
                match.teams.faction1.roster && 
                match.teams.faction1.roster.some(p => p.player_id === player.player_id);
              const playerInFaction2 = match.teams.faction2 && 
                match.teams.faction2.roster && 
                match.teams.faction2.roster.some(p => p.player_id === player.player_id);
              
              if ((playerInFaction1 && winningFactionId === match.teams.faction1.faction_id) ||
                  (playerInFaction2 && winningFactionId === match.teams.faction2.faction_id)) {
                wins++;
              }
            }
          }
        });
        
        recentMatches.push({
          player: player.nickname,
          recentMatches: recent.length,
          wins: wins,
          winRate: recent.length > 0 ? Math.round((wins / recent.length) * 100) : 0
        });
      }
    });

    return {
      analyzed: recentMatches.length,
      data: recentMatches,
      avgRecentWinRate: recentMatches.length > 0 ? 
        Math.round(recentMatches.reduce((sum, p) => sum + p.winRate, 0) / recentMatches.length) : 0
    };
  }

  /**
   * Calculate threat level based on team stats
   */
  calculateThreatLevel(avgElo, avgKd, avgWinRate) {
    let score = 0;
    
    // ELO contribution (0-40 points)
    if (avgElo >= 2000) score += 40;
    else if (avgElo >= 1500) score += 30;
    else if (avgElo >= 1200) score += 20;
    else if (avgElo >= 1000) score += 15;
    else score += 10;
    
    // K/D contribution (0-30 points)
    if (avgKd >= 1.3) score += 30;
    else if (avgKd >= 1.1) score += 25;
    else if (avgKd >= 1.0) score += 20;
    else if (avgKd >= 0.9) score += 15;
    else score += 10;
    
    // Win rate contribution (0-30 points)
    if (avgWinRate >= 70) score += 30;
    else if (avgWinRate >= 60) score += 25;
    else if (avgWinRate >= 50) score += 20;
    else if (avgWinRate >= 40) score += 15;
    else score += 10;
    
    // Determine threat level
    if (score >= 85) return { level: 'VERY HIGH', score, color: '🔴' };
    if (score >= 70) return { level: 'HIGH', score, color: '🟠' };
    if (score >= 55) return { level: 'MEDIUM', score, color: '🟡' };
    if (score >= 40) return { level: 'LOW', score, color: '🟢' };
    return { level: 'VERY LOW', score, color: '🟢' };
  }

  /**
   * Generate tactical recommendations
   */
  generateRecommendations(avgElo, avgKd, avgHs, players) {
    const recommendations = [];
    
    if (avgElo > 1800) {
      recommendations.push('⚠️ High-skill opponents - focus on tactical play and coordination');
    }
    
    if (avgKd > 1.2) {
      recommendations.push('🎯 Enemy team has strong fraggers - prioritize positioning and trades');
    }
    
    if (avgHs > 60) {
      recommendations.push('🎯 High headshot accuracy - avoid long-range duels, use utility');
    }
    
    // Find players with very high individual stats
    const topFraggers = players.filter(p => parseFloat(p.stats['K/D Ratio']) > 1.4);
    if (topFraggers.length > 0) {
      recommendations.push(`🔥 Key threats: ${topFraggers.map(p => p.nickname).join(', ')} - focus these players`);
    }
    
    if (recommendations.length === 0) {
      recommendations.push('✅ Balanced matchup - play your standard game');
    }
    
    return recommendations;
  }

  /**
   * Calculate team-wide best and worst maps from players' map stats
   */
  calculateTeamMapAnalysis(players) {
    const mapStatsTeam = {};
    
    // Aggregate map stats from all players
    players.forEach(player => {
      if (player.mapStats && Object.keys(player.mapStats).length > 0) {
        for (const [map, stats] of Object.entries(player.mapStats)) {
          if (stats.matchesPlayed >= 3) { // Only consider maps with reasonable sample size
            if (!mapStatsTeam[map]) {
              mapStatsTeam[map] = {
                winRates: [],
                totalMatches: 0,
                kdRatios: []
              };
            }
            mapStatsTeam[map].winRates.push(stats.winRate);
            mapStatsTeam[map].totalMatches += stats.matchesPlayed;
            mapStatsTeam[map].kdRatios.push(stats.kdRatio);
          }
        }
      }
    });
    
    if (Object.keys(mapStatsTeam).length === 0) {
      return {
        bestMap: { map: 'N/A', avgWinRate: 0 },
        worstMap: { map: 'N/A', avgWinRate: 0 }
      };
    }
    
    // Calculate average win rates for each map
    const mapAverages = {};
    for (const [map, data] of Object.entries(mapStatsTeam)) {
      mapAverages[map] = {
        avgWinRate: Math.round(data.winRates.reduce((a, b) => a + b, 0) / data.winRates.length),
        avgKD: (data.kdRatios.reduce((a, b) => a + b, 0) / data.kdRatios.length).toFixed(2),
        totalMatches: data.totalMatches
      };
    }
    
    // Find best and worst maps
    const mapEntries = Object.entries(mapAverages);
    const bestMap = mapEntries.reduce((best, [map, stats]) => 
      stats.avgWinRate > best.avgWinRate ? { map, ...stats } : best, 
      { map: 'N/A', avgWinRate: -1 }
    );
    
    const worstMap = mapEntries.reduce((worst, [map, stats]) => 
      stats.avgWinRate < worst.avgWinRate || worst.avgWinRate === 101 ? { map, ...stats } : worst,
      { map: 'N/A', avgWinRate: 101 }
    );
    
    return { bestMap, worstMap, allMaps: mapAverages };
  }

  /**
   * Process map-specific stats from player segments
   */
  processMapStats(segments) {
    const mapStats = {};
    
    segments.forEach(segment => {
      const mapName = segment.label || 'Unknown';
      const stats = segment.stats || {};
      const winRate = parseFloat(stats['Win Rate %']) || 0;
      const kdRatio = parseFloat(stats['K/D Ratio']) || 0;
      const adr = parseFloat(stats['ADR']) || 0;
      const hsPercent = parseFloat(stats['Average Headshots %']) || 0;
      
      mapStats[mapName] = {
        winRate,
        kdRatio,
        adr,
        hsPercent,
        matchesPlayed: parseInt(stats['Total Matches']) || 0
      };
    });

    return mapStats;
  }

  /**
   * Clear all cache and cleanup resources
   */
  cleanup() {
    this.cache.cleanup();
    this.pendingRequests.clear();
  }
}

module.exports = new FaceitService();
