const databaseInstance = require('../../database');
const { databaseLockManager } = require('../utils/databaseLock');

class DatabaseService {
  constructor() {
    this.db = databaseInstance;
    this.isReady = false;
    
    // In-memory cache for performance
    this.processedMatches = [];
    this.userMappings = {};
    this.rsvpStatus = {};
    this.matchThreads = new Map();
    this.upcomingMatches = new Map();
    this.userSearchResults = new Map();
  }

  /**
   * Initialize database and load all data into memory
   */
  async initialize() {
    try {
      await this.db.initialize();
      console.log('Database initialized successfully');
      
      // Load existing data from database
      const processedMatchesData = await this.db.getAllProcessedMatches();
      this.processedMatches = processedMatchesData.map(row => row.match_id);
      console.log(`Loaded ${this.processedMatches.length} processed matches`);
      
      const userMappingsData = await this.db.getAllUserMappings();
      this.userMappings = {};
      for (const user of userMappingsData) {
        this.userMappings[user.discord_id] = {
          discord_username: user.discord_username,
          discord_id: user.discord_id,
          faceit_nickname: user.faceit_nickname,
          faceit_player_id: user.faceit_player_id,
          faceit_skill_level: user.faceit_skill_level || 'N/A',
          faceit_elo: user.faceit_elo || 'N/A',
          country: user.country || 'Unknown',
          registered_at: user.created_at,
          updated_at: user.updated_at
        };
      }
      console.log(`Loaded ${Object.keys(this.userMappings).length} user mappings`);
      
      // Load RSVP data - need to get all RSVP entries
      const rsvpData = await this.db.getAllRsvpData();
      this.rsvpStatus = {};
      for (const rsvp of rsvpData) {
        if (!this.rsvpStatus[rsvp.match_id]) {
          this.rsvpStatus[rsvp.match_id] = {};
        }
        this.rsvpStatus[rsvp.match_id][rsvp.discord_id] = {
          response: rsvp.response,
          faceit_nickname: rsvp.faceit_nickname,
          timestamp: rsvp.created_at
        };
      }
      console.log(`Loaded RSVP status for ${Object.keys(this.rsvpStatus).length} matches`);
      
      // Load match threads
      const threadsData = await this.db.getAllMatchThreads();
      for (const thread of threadsData) {
        this.matchThreads.set(thread.match_id, thread.thread_id);
      }
      console.log(`Loaded ${this.matchThreads.size} match thread mappings`);
      
      this.isReady = true;
      console.log('All data loaded from database successfully');
    } catch (err) {
      console.error(`Error initializing database: ${err.message}`);
      throw err;
    }
  }


  // User mapping methods
  getUserMappingByDiscordId(discordId) {
    return this.userMappings[discordId] || null;
  }

  /**
   * Get user mapping directly from database (bypasses memory cache)
   */
  async getUserMappingByDiscordIdFromDB(discordId) {
    try {
      return await this.db.getUserMappingByDiscordId(discordId);
    } catch (err) {
      console.error(`Error getting user mapping from DB: ${err.message}`);
      return null;
    }
  }

  /**
   * Get user mapping by FACEIT ID directly from database (bypasses memory cache)
   */
  async getUserMappingByFaceitIdFromDB(faceitPlayerId) {
    try {
      return await this.db.getUserMappingByFaceitId(faceitPlayerId);
    } catch (err) {
      console.error(`Error getting user mapping by FACEIT ID from DB: ${err.message}`);
      return null;
    }
  }

  isFaceitAccountMapped(faceitPlayerId) {
    return Object.values(this.userMappings).some(user => user.faceit_player_id === faceitPlayerId);
  }

  async addUserMapping(discordId, discordUsername, faceitData) {
    return await databaseLockManager.withLock('user_mappings', async () => {
      // Add to database
      await this.db.addUserMapping(discordId, discordUsername, faceitData);
      
      // Update memory cache
      this.userMappings[discordId] = {
        discord_username: discordUsername,
        discord_id: discordId,
        faceit_nickname: faceitData.nickname,
        faceit_player_id: faceitData.player_id,
        faceit_skill_level: faceitData.skill_level || 'N/A',
        faceit_elo: faceitData.faceit_elo || 'N/A',
        country: faceitData.country || 'Unknown',
        registered_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    });
  }

  async removeUserMapping(discordId) {
    return await databaseLockManager.withLock('user_mappings', async () => {
      // Remove from database
      await this.db.removeUserMapping(discordId);
      
      // Update memory cache
      delete this.userMappings[discordId];
    });
  }

  findUserByQuery(query) {
    return Object.values(this.userMappings).find(mapping => {
      return mapping.discord_username.toLowerCase() === query ||
             mapping.discord_id === query ||
             mapping.faceit_nickname.toLowerCase() === query;
    });
  }
  
  /**
   * Update user mapping stats with fresh FACEIT data
   */
  async updateUserMappingStats(discordId, stats) {
    return await databaseLockManager.withLock('user_mappings', async () => {
      try {
        // Update database
        await this.db.updateUserMappingStats(discordId, stats);
        
        // Update memory cache
        if (this.userMappings[discordId]) {
          this.userMappings[discordId].faceit_skill_level = stats.faceit_skill_level || this.userMappings[discordId].faceit_skill_level;
          this.userMappings[discordId].faceit_elo = stats.faceit_elo || this.userMappings[discordId].faceit_elo;
          this.userMappings[discordId].country = stats.country || this.userMappings[discordId].country;
          this.userMappings[discordId].updated_at = new Date().toISOString();
        }
      } catch (err) {
        console.error(`Error updating user mapping stats: ${err.message}`);
        throw err;
      }
    });
  }

  // RSVP methods
  getUserRsvp(matchId, discordId) {
    return this.rsvpStatus[matchId]?.[discordId] || null;
  }

  getRsvpForMatch(matchId) {
    return this.rsvpStatus[matchId] || {};
  }

  async addRsvp(matchId, discordId, response, faceitNickname) {
    return await databaseLockManager.withLock(`rsvp_${matchId}`, async () => {
      // Add to database
      await this.db.addRsvp(matchId, discordId, response, faceitNickname);
      
      // Update memory cache
      if (!this.rsvpStatus[matchId]) {
        this.rsvpStatus[matchId] = {};
      }
      this.rsvpStatus[matchId][discordId] = {
        response,
        faceit_nickname: faceitNickname,
        timestamp: new Date().toISOString()
      };
      
      // Trigger cache invalidation for RSVP update
      try {
        const timeSensitiveCache = require('./timeSensitiveCacheService');
        await timeSensitiveCache.invalidateCacheForEvent('rsvp_update', matchId);
      } catch (cacheErr) {
        console.warn(`Failed to invalidate cache for RSVP update: ${cacheErr.message}`);
      }
    });
  }

  // Processed matches methods
  markMatchAsProcessed(matchId) {
    if (!this.processedMatches.includes(matchId)) {
      this.processedMatches.push(matchId);
      this.db.markMatchAsProcessed(matchId).catch(err => {
        console.error(`Error saving processed match: ${err.message}`);
      });
    }
  }

  isMatchProcessed(matchId) {
    return this.processedMatches.includes(matchId);
  }

  // Match threads methods
  async saveMatchThreads() {
    try {
      // Convert Map to array for database storage
      const threadsArray = Array.from(this.matchThreads.entries()).map(([matchId, threadId]) => ({
        match_id: matchId,
        thread_id: threadId
      }));
      
      // Save each thread mapping
      for (const thread of threadsArray) {
        await this.db.addMatchThread(thread.match_id, thread.thread_id);
      }
    } catch (err) {
      console.error(`Error saving match threads: ${err.message}`);
    }
  }

  async addMatchThread(matchId, threadId, threadType = 'upcoming') {
    try {
      // Add to database
      await this.db.addMatchThread(matchId, threadId, threadType);
      
      // Update memory cache
      this.matchThreads.set(matchId, threadId);
    } catch (err) {
      console.error(`Error adding match thread: ${err.message}`);
    }
  }

  async hasFinishedMatchThread(matchId) {
    try {
      return await this.db.hasFinishedMatchThread(matchId);
    } catch (err) {
      console.error(`Error checking finished match thread: ${err.message}`);
      return false;
    }
  }

  async hasUpcomingMatchThread(matchId) {
    try {
      return await this.db.hasUpcomingMatchThread(matchId);
    } catch (err) {
      console.error(`Error checking upcoming match thread: ${err.message}`);
      return false;
    }
  }

  async hasAnyMatchThread(matchId) {
    try {
      return await this.db.hasAnyMatchThread(matchId);
    } catch (err) {
      console.error(`Error checking for any match thread: ${err.message}`);
      return false;
    }
  }

  /**
   * Remove a specific match thread reference
   */
  async removeMatchThread(matchId) {
    try {
      // Remove from database
      await this.db.removeMatchThread(matchId);
      
      // Remove from memory cache
      this.matchThreads.delete(matchId);
      
      console.log(`Removed thread reference for match ${matchId}`);
    } catch (err) {
      console.error(`Error removing match thread ${matchId}: ${err.message}`);
    }
  }

  /**
   * Reload match threads from database into memory cache
   */
  async reloadMatchThreads() {
    try {
      // Clear the current in-memory cache
      this.matchThreads = new Map();
      
      // Reload from database
      const threadsData = await this.db.getAllMatchThreads();
      for (const thread of threadsData) {
        this.matchThreads.set(thread.match_id, thread.thread_id);
      }
      
      console.log(`🔄 Reloaded ${this.matchThreads.size} match thread mappings from database`);
    } catch (err) {
      console.error(`Error reloading match threads: ${err.message}`);
    }
  }

  // Admin methods for data management
  async getAllUserMappings() {
    try {
      return await this.db.getAllUserMappings();
    } catch (err) {
      console.error(`Error getting all user mappings: ${err.message}`);
      return [];
    }
  }

  async getAllRsvpData() {
    try {
      return await this.db.getAllRsvpData();
    } catch (err) {
      console.error(`Error getting all RSVP data: ${err.message}`);
      return [];
    }
  }

  async clearAllUserMappings() {
    try {
      await this.db.clearAllUserMappings();
      // Clear memory cache too
      this.userMappings = {};
      console.log('Cleared all user mappings from database and memory');
    } catch (err) {
      console.error(`Error clearing all user mappings: ${err.message}`);
      throw err;
    }
  }

  async clearAllRsvpData() {
    try {
      await this.db.clearAllRsvpData();
      // Clear memory cache too
      this.rsvpStatus = {};
      console.log('Cleared all RSVP data from database and memory');
    } catch (err) {
      console.error(`Error clearing all RSVP data: ${err.message}`);
      throw err;
    }
  }

  async getUserMappingByFaceitId(faceitPlayerId) {
    try {
      // Check memory cache first
      const mapping = Object.values(this.userMappings).find(
        user => user.faceit_player_id === faceitPlayerId
      );
      if (mapping) {
        return mapping;
      }
      
      // Fall back to database
      return await this.db.getUserMappingByFaceitId(faceitPlayerId);
    } catch (err) {
      console.error(`Error getting user mapping by FACEIT ID: ${err.message}`);
      return null;
    }
  }

  async getMatchThread(matchId) {
    try {
      // Check memory cache first
      const threadId = this.matchThreads.get(matchId);
      if (threadId) {
        return threadId;
      }
      
      // Fall back to database
      const thread = await this.db.getMatchThread(matchId);
      if (thread) {
        // Update cache
        this.matchThreads.set(matchId, thread.thread_id);
        return thread.thread_id;
      }
      return null;
    } catch (err) {
      console.error(`Error getting match thread: ${err.message}`);
      return null;
    }
  }

  // Cleanup methods
  async cleanupOldRsvpData() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30); // 30 days ago
      
      console.log('Running RSVP data cleanup...');
      
      // Remove old RSVPs from memory cache
      let removedCount = 0;
      for (const matchId in this.rsvpStatus) {
        const matchRsvps = this.rsvpStatus[matchId];
        for (const discordId in matchRsvps) {
          const rsvpDate = new Date(matchRsvps[discordId].timestamp);
          if (rsvpDate < cutoffDate) {
            delete matchRsvps[discordId];
            removedCount++;
          }
        }
        // Remove empty match entries
        if (Object.keys(matchRsvps).length === 0) {
          delete this.rsvpStatus[matchId];
        }
      }
      
      console.log(`Cleaned up ${removedCount} old RSVP entries`);
    } catch (err) {
      console.error(`Error during cleanup: ${err.message}`);
    }
  }

  // Database wrapper methods for direct access
  async run(sql, params = []) {
    return await this.db.run(sql, params);
  }

  async cleanupExpiredApiCache() {
    return await this.db.cleanupExpiredApiCache();
  }

  async cleanupExpiredCache() {
    return await this.db.cleanupExpiredCache();
  }

  async cleanupExpiredTeamDataCache() {
    return await this.db.cleanupExpiredTeamDataCache();
  }
}

module.exports = DatabaseService;
