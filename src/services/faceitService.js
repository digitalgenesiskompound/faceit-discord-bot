const { makeApiRequest } = require('../utils/helpers');
const config = require('../config/config');
const cacheService = require('./cacheService');
const timeSensitiveCache = require('./timeSensitiveCacheService');
const databaseInstance = require('../../database');
const { circuitBreakerManager } = require('../utils/circuitBreaker');
const { performanceMonitor, withTimeout } = require('../utils/performanceMonitor');

class FaceitService {
  constructor() {
    this.cache = cacheService;
    this.db = databaseInstance;
    
    // Track ongoing requests to prevent duplicates
    this.pendingRequests = new Map();
    
    // Use enhanced circuit breaker system
    this.circuitBreakerService = 'faceit_api';
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus() {
    return circuitBreakerManager.getBreaker(this.circuitBreakerService).getStatus();
  }

  /**
   * Make API request with circuit breaker protection and timeout
   */
  async makeProtectedApiRequest(url, options, context) {
    const operationType = context?.operation || 'faceit_api_call';
    
    // Create fallback function for circuit breaker
    const fallback = () => {
      console.warn(`Circuit breaker fallback for ${operationType}`);
      throw new Error(`FACEIT API temporarily unavailable (circuit breaker open)`);
    };
    
    return await performanceMonitor.timeOperation(operationType, async () => {
      return await circuitBreakerManager.execute(
        this.circuitBreakerService,
        withTimeout(async () => {
          return await makeApiRequest(url, options, context);
        }, 15000, `FACEIT API request timeout for ${operationType}`),
        fallback
      );
    });
  }
  /**
   * Get upcoming matches for the team
   */
  async getUpcomingMatches() {
    return await timeSensitiveCache.getUpcomingMatchesTimeAware(async () => {
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
          const teamData = await timeSensitiveCache.getTeamDataTimeAware(async () => {
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
                  const fullMatch = await this.cache.getCachedData(
                    `match_${match.match_id}`,
                    async () => {
                      return await this.makeProtectedApiRequest(
                        `https://open.faceit.com/data/v4/matches/${match.match_id}`,
                        {},
                        {
                          operation: 'get_full_match_data',
                          matchId: match.match_id
                        }
                      );
                    },
                    { ttlMinutes: 10 }
                  );
                  
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
    return await timeSensitiveCache.getTeamPlayersTimeAware(async () => {
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
    return await timeSensitiveCache.getFinishedMatchesTimeAware(async () => {
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
          const teamData = await timeSensitiveCache.getTeamDataTimeAware(async () => {
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
                  const fullMatch = await this.cache.getCachedData(
                    `match_${match.match_id}`,
                    async () => {
                      return await this.makeProtectedApiRequest(
                        `https://open.faceit.com/data/v4/matches/${match.match_id}`,
                        {},
                        {
                          operation: 'get_full_finished_match_data',
                          matchId: match.match_id
                        }
                      );
                    },
                    { ttlMinutes: 10 }
                  );
                  
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
   * Get player data by nickname - optimized with caching
   */
  async getPlayerByNickname(nickname) {
    return await timeSensitiveCache.getPlayerDataTimeAware(nickname, async () => {
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
    return await timeSensitiveCache.getPlayerSearchTimeAware(query, async () => {
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
   * Clear all cache and cleanup resources
   */
  cleanup() {
    this.cache.cleanup();
    timeSensitiveCache.cleanup();
    this.pendingRequests.clear();
  }
}

module.exports = new FaceitService();
