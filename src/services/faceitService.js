const { makeApiRequest } = require('../utils/helpers');
const config = require('../config/config');

class FaceitService {
  /**
   * Get upcoming matches for the team
   */
  async getUpcomingMatches() {
    const matches = [];
    const matchIds = new Set();
    
    // Method 1: Check championship matches
    try {
      console.log('Getting matches from championship...');
      const champData = await makeApiRequest(
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
    
    // Try player history approach if we didn't find any matches
    if (matches.length === 0) {
      console.log(`No matches found, trying player history approach`);
      try {
        // First get team details to find players
        const teamData = await makeApiRequest(
          `https://open.faceit.com/data/v4/teams/${config.faceit.teamId}`,
          {},
          {
            operation: 'get_team_data',
            teamId: config.faceit.teamId
          }
        );
        
        if (teamData && teamData.members && teamData.members.length > 0) {
          // Check match history for first player
          const playerId = teamData.members[0].user_id;
          console.log(`Checking match history for player: ${teamData.members[0].nickname}`);
          
          const playerHistory = await makeApiRequest(
            `https://open.faceit.com/data/v4/players/${playerId}/history`,
            {
              params: { game: 'cs2', limit: 20 }
            },
            {
              operation: 'get_player_history',
              playerId,
              playerNickname: teamData.members[0].nickname
            }
          );
          
          if (playerHistory && playerHistory.items) {
            // Find upcoming matches
            const upcomingMatches = playerHistory.items.filter(match => 
              !match.finished_at && 
              match.status !== 'FINISHED' && 
              match.status !== 'CANCELLED'
            );
            
            // Check each match to see if it involves the team
            for (const match of upcomingMatches) {
              if (!matchIds.has(match.match_id)) {
                const fullMatch = await makeApiRequest(
                  `https://open.faceit.com/data/v4/matches/${match.match_id}`,
                  {},
                  {
                    operation: 'get_full_match_data',
                    matchId: match.match_id
                  }
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
  }

  /**
   * Get team players
   */
  async listTeamPlayers() {
    try {
      console.log('Fetching team players...');
      const teamData = await makeApiRequest(
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
    } catch (error) {
      console.error(`Error fetching team players: ${error.message}`);
      return [];
    }
  }

  /**
   * Search for FACEIT accounts
   */
  async searchFaceitAccounts(query) {
    try {
      console.log(`Searching for FACEIT accounts with query: ${query}`);
      
      const response = await makeApiRequest(
        `https://open.faceit.com/data/v4/search/players`,
        {
          params: {
            nickname: query,
            limit: 10  // Limit to 10 results for better Discord display
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
  }

  /**
   * Get finished matches for the team
   */
  async getFinishedMatches(limit = 20) {
    const finishedMatches = [];
    const matchIds = new Set();
    
    try {
      // First try championship matches
      console.log('Getting finished matches from championship...');
      const champData = await makeApiRequest(
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
    
    // Try player history approach if we need more matches
    if (finishedMatches.length < limit) {
      console.log(`Getting finished matches from player history...`);
      try {
        // Get team details to find players
        const teamData = await makeApiRequest(
          `https://open.faceit.com/data/v4/teams/${config.faceit.teamId}`,
          {},
          {
            operation: 'get_team_data_for_finished',
            teamId: config.faceit.teamId
          }
        );
        
        if (teamData && teamData.members && teamData.members.length > 0) {
          // Check match history for first player
          const playerId = teamData.members[0].user_id;
          console.log(`Checking finished match history for player: ${teamData.members[0].nickname}`);
          
          const playerHistory = await makeApiRequest(
            `https://open.faceit.com/data/v4/players/${playerId}/history`,
            {
              params: { game: 'cs2', limit: 50 }
            },
            {
              operation: 'get_player_finished_history',
              playerId,
              playerNickname: teamData.members[0].nickname
            }
          );
          
          if (playerHistory && playerHistory.items) {
            // Find finished matches
            const playerFinishedMatches = playerHistory.items.filter(match => 
              (match.finished_at || match.status === 'FINISHED') &&
              match.status !== 'CANCELLED'
            );
            
            // Check each match to see if it involves the team
            for (const match of playerFinishedMatches) {
              if (!matchIds.has(match.match_id) && finishedMatches.length < limit) {
                try {
                  const fullMatch = await makeApiRequest(
                    `https://open.faceit.com/data/v4/matches/${match.match_id}`,
                    {},
                    {
                      operation: 'get_full_finished_match_data',
                      matchId: match.match_id
                    }
                  );
                  
                  if (fullMatch && fullMatch.teams) {
                    const faction1Id = fullMatch.teams.faction1?.faction_id;
                    const faction2Id = fullMatch.teams.faction2?.faction_id;
                    
                    if (faction1Id === config.faceit.teamId || faction2Id === config.faceit.teamId) {
                      matchIds.add(match.match_id);
                      finishedMatches.push(fullMatch);
                    }
                  }
                } catch (matchErr) {
                  console.error(`Error fetching finished match ${match.match_id}: ${matchErr.message}`);
                }
              }
            }
          }
        }
      } catch (err) {
        console.error(`Error with finished match player history approach: ${err.message}`);
      }
    }
    
    // Sort final list by finished_at descending
    finishedMatches.sort((a, b) => {
      const finishedA = a.finished_at || 0;
      const finishedB = b.finished_at || 0;
      return finishedB - finishedA;
    });
    
    console.log(`Total finished matches found: ${finishedMatches.length}`);
    return finishedMatches;
  }

  /**
   * Get player data by nickname
   */
  async getPlayerByNickname(nickname) {
    try {
      const playerData = await makeApiRequest(
        `https://open.faceit.com/data/v4/players`,
        {
          params: { nickname }
        },
        {
          operation: 'get_player_by_nickname',
          nickname
        }
      );
      return playerData;
    } catch (error) {
      console.error(`Error getting player by nickname: ${error.message}`);
      return null;
    }
  }
}

module.exports = new FaceitService();
