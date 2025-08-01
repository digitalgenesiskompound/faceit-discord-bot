const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const errorHandler = require('./src/utils/errorHandler');

class Database {
  constructor() {
    this.dbPath = path.join(__dirname, 'data', 'bot.db');
    this.db = null;
    this.isInitialized = false;
  }

  // Initialize database connection and create tables
  async initialize() {
    if (this.isInitialized) return;

    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('Error opening database:', err.message);
          reject(err);
          return;
        }
        console.log('Connected to SQLite database');
        this.createTables()
          .then(() => {
            this.isInitialized = true;
            resolve();
          })
          .catch(reject);
      });
    });
  }

  // Create all necessary tables
  async createTables() {
    const tables = [
      // User mappings table
      `CREATE TABLE IF NOT EXISTS user_mappings (
        discord_id TEXT PRIMARY KEY,
        discord_username TEXT NOT NULL,
        faceit_nickname TEXT NOT NULL UNIQUE,
        faceit_player_id TEXT NOT NULL UNIQUE,
        faceit_skill_level TEXT,
        faceit_elo TEXT,
        country TEXT,
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Matches table
      `CREATE TABLE IF NOT EXISTS matches (
        match_id TEXT PRIMARY KEY,
        faction1_name TEXT NOT NULL,
        faction2_name TEXT NOT NULL,
        scheduled_at INTEGER,
        competition_name TEXT,
        status TEXT DEFAULT 'SCHEDULED',
        result TEXT,
        winner TEXT,
        finished_at INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // RSVP status table
      `CREATE TABLE IF NOT EXISTS rsvp_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        faceit_nickname TEXT NOT NULL,
        response TEXT NOT NULL CHECK (response IN ('yes', 'no')),
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE,
        FOREIGN KEY (discord_id) REFERENCES user_mappings(discord_id) ON DELETE CASCADE,
        UNIQUE(match_id, discord_id)
      )`,

      // Match threads table
      `CREATE TABLE IF NOT EXISTS match_threads (
        match_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL UNIQUE,
        thread_type TEXT DEFAULT 'upcoming' CHECK (thread_type IN ('upcoming', 'finished')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE
      )`,

      // Processed matches table (to track which matches we've already notified about)
      `CREATE TABLE IF NOT EXISTS processed_matches (
        match_id TEXT PRIMARY KEY,
        processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE
      )`,

      // Match cache table for optimized API data storage
      `CREATE TABLE IF NOT EXISTS matches_cache (
        match_id TEXT PRIMARY KEY,
        match_data TEXT NOT NULL,
        match_type TEXT NOT NULL CHECK (match_type IN ('upcoming', 'finished', 'championship')),
        scheduled_at INTEGER,
        finished_at INTEGER,
        cache_key TEXT NOT NULL,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL
      )`,

      // Generic API cache table for all API responses
      `CREATE TABLE IF NOT EXISTS api_cache (
        cache_key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // Team data cache table for team/player information
      `CREATE TABLE IF NOT EXISTS team_data_cache (
        data_type TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const query of tables) {
      await this.run(query);
    }

    // Create indexes for better performance
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_rsvp_match_id ON rsvp_status(match_id)',
      'CREATE INDEX IF NOT EXISTS idx_rsvp_discord_id ON rsvp_status(discord_id)',
      'CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status)',
      'CREATE INDEX IF NOT EXISTS idx_matches_scheduled_at ON matches(scheduled_at)',
      'CREATE INDEX IF NOT EXISTS idx_matches_cache_expires ON matches_cache(expires_at)',
      'CREATE INDEX IF NOT EXISTS idx_matches_cache_type ON matches_cache(match_type)',
      'CREATE INDEX IF NOT EXISTS idx_matches_cache_key ON matches_cache(cache_key)',
      'CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_cache(expires_at)',
      'CREATE INDEX IF NOT EXISTS idx_team_data_cache_expires ON team_data_cache(expires_at)'
    ];

    for (const query of indexes) {
      await this.run(query);
    }

    console.log('Database tables created successfully');
    
    // Run any necessary migrations
    await this.runMigrations();
  }

  // Enhanced run method with retry logic for INSERT, UPDATE, DELETE
  async run(sql, params = []) {
    const operationName = this.extractOperationName(sql);
    
    return await errorHandler.databaseOperationWithRetry(
      () => {
        return new Promise((resolve, reject) => {
          this.db.run(sql, params, function(err) {
            if (err) {
              errorHandler.logger.error('Database run operation failed', {
                operation: operationName,
                sql: sql.substring(0, 100) + '...',
                error: err.message,
                code: err.code
              });
              reject(err);
            } else {
              errorHandler.logger.debug('Database run operation succeeded', {
                operation: operationName,
                changes: this.changes,
                lastID: this.lastID
              });
              resolve({ id: this.lastID, changes: this.changes });
            }
          });
        });
      },
      {
        operationName,
        context: {
          sql: sql.substring(0, 100) + '...',
          paramCount: params.length
        }
      }
    );
  }

  // TRANSACTION SUPPORT
  /**
   * Execute multiple operations within a single transaction
   * @param {Function} callback - Async function containing database operations
   * @returns {Promise} - Result of the callback function
   */
  async transaction(callback) {
    if (!callback || typeof callback !== 'function') {
      throw new Error('Transaction callback must be a function');
    }

    errorHandler.logger.debug('Starting database transaction');
    
    await this.run('BEGIN TRANSACTION');
    
    try {
      const result = await callback();
      await this.run('COMMIT');
      
      errorHandler.logger.debug('Database transaction committed successfully');
      return result;
    } catch (error) {
      errorHandler.logger.error('Database transaction failed, rolling back', {
        error: error.message,
        stack: error.stack
      });
      
      try {
        await this.run('ROLLBACK');
        errorHandler.logger.debug('Database transaction rolled back successfully');
      } catch (rollbackError) {
        errorHandler.logger.error('Failed to rollback transaction', {
          error: rollbackError.message
        });
        // Don't throw rollback error, throw original error
      }
      
      throw error;
    }
  }

  /**
   * Execute operations in a transaction with automatic retry on conflict
   * @param {Function} callback - Async function containing database operations
   * @param {Object} options - Transaction options
   * @returns {Promise} - Result of the callback function
   */
  async transactionWithRetry(callback, options = {}) {
    const { maxRetries = 3, retryDelay = 100 } = options;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.transaction(callback);
      } catch (error) {
        // Retry on database busy/locked errors
        const isRetryableError = error.code === 'SQLITE_BUSY' || 
                                error.code === 'SQLITE_LOCKED' ||
                                error.message.includes('database is locked');
        
        if (isRetryableError && attempt < maxRetries) {
          errorHandler.logger.warn(`Transaction attempt ${attempt} failed, retrying...`, {
            error: error.message,
            attempt,
            maxRetries
          });
          
          // Wait before retry with exponential backoff
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
          continue;
        }
        
        throw error;
      }
    }
  }

  // Enhanced get method with retry logic for SELECT (single row)
  async get(sql, params = []) {
    const operationName = this.extractOperationName(sql) + '_get';
    
    return await errorHandler.databaseOperationWithRetry(
      () => {
        return new Promise((resolve, reject) => {
          this.db.get(sql, params, (err, row) => {
            if (err) {
              errorHandler.logger.error('Database get operation failed', {
                operation: operationName,
                sql: sql.substring(0, 100) + '...',
                error: err.message,
                code: err.code
              });
              reject(err);
            } else {
              errorHandler.logger.debug('Database get operation succeeded', {
                operation: operationName,
                hasResult: !!row
              });
              resolve(row);
            }
          });
        });
      },
      {
        operationName,
        context: {
          sql: sql.substring(0, 100) + '...',
          paramCount: params.length
        }
      }
    );
  }

  // Enhanced all method with retry logic for SELECT (multiple rows)
  async all(sql, params = []) {
    const operationName = this.extractOperationName(sql) + '_all';
    
    return await errorHandler.databaseOperationWithRetry(
      () => {
        return new Promise((resolve, reject) => {
          this.db.all(sql, params, (err, rows) => {
            if (err) {
              errorHandler.logger.error('Database all operation failed', {
                operation: operationName,
                sql: sql.substring(0, 100) + '...',
                error: err.message,
                code: err.code
              });
              reject(err);
            } else {
              errorHandler.logger.debug('Database all operation succeeded', {
                operation: operationName,
                rowCount: rows?.length || 0
              });
              resolve(rows);
            }
          });
        });
      },
      {
        operationName,
        context: {
          sql: sql.substring(0, 100) + '...',
          paramCount: params.length
        }
      }
    );
  }

  // USER MAPPING METHODS
  async addUserMapping(discordId, discordUsername, faceitData) {
    const query = `
      INSERT OR REPLACE INTO user_mappings 
      (discord_id, discord_username, faceit_nickname, faceit_player_id, faceit_skill_level, faceit_elo, country, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;
    return this.run(query, [
      discordId,
      discordUsername,
      faceitData.nickname,
      faceitData.player_id,
      faceitData.skill_level || 'N/A',
      faceitData.faceit_elo || 'N/A',
      faceitData.country || 'Unknown'
    ]);
  }

  async getUserMappingByDiscordId(discordId) {
    const query = 'SELECT * FROM user_mappings WHERE discord_id = ?';
    return this.get(query, [discordId]);
  }

  async getUserMappingByFaceitId(faceitPlayerId) {
    const query = 'SELECT * FROM user_mappings WHERE faceit_player_id = ?';
    return this.get(query, [faceitPlayerId]);
  }

  async getUserMappingByFaceitNickname(nickname) {
    const query = 'SELECT * FROM user_mappings WHERE faceit_nickname = ?';
    return this.get(query, [nickname]);
  }

  async removeUserMapping(discordId) {
    const query = 'DELETE FROM user_mappings WHERE discord_id = ?';
    return this.run(query, [discordId]);
  }

  async getAllUserMappings() {
    const query = 'SELECT * FROM user_mappings ORDER BY registered_at';
    return this.all(query);
  }
  
  async updateUserMappingStats(discordId, stats) {
    const query = `
      UPDATE user_mappings 
      SET faceit_skill_level = COALESCE(?, faceit_skill_level),
          faceit_elo = COALESCE(?, faceit_elo),
          country = COALESCE(?, country),
          updated_at = CURRENT_TIMESTAMP
      WHERE discord_id = ?
    `;
    return this.run(query, [
      stats.faceit_skill_level,
      stats.faceit_elo, 
      stats.country,
      discordId
    ]);
  }

  // MATCH METHODS
  async addOrUpdateMatch(matchData) {
    const query = `
      INSERT OR REPLACE INTO matches 
      (match_id, faction1_name, faction2_name, scheduled_at, competition_name, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;
    return this.run(query, [
      matchData.match_id,
      matchData.teams.faction1.name,
      matchData.teams.faction2.name,
      matchData.scheduled_at,
      matchData.competition_name || 'ESEA Season',
      matchData.status || 'SCHEDULED'
    ]);
  }

  async getMatch(matchId) {
    const query = 'SELECT * FROM matches WHERE match_id = ?';
    return this.get(query, [matchId]);
  }

  async getUpcomingMatches() {
    const query = `
      SELECT * FROM matches 
      WHERE status NOT IN ('FINISHED', 'CANCELLED') 
      ORDER BY scheduled_at ASC
    `;
    return this.all(query);
  }

  async getFinishedMatches(limit = 20) {
    const query = `
      SELECT * FROM matches 
      WHERE status = 'FINISHED'
      ORDER BY finished_at DESC
      LIMIT ?
    `;
    return this.all(query, [limit]);
  }

  async updateMatchResult(matchId, result, winner, finishedAt) {
    const query = `
      UPDATE matches 
      SET status = 'FINISHED', result = ?, winner = ?, finished_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE match_id = ?
    `;
    return this.run(query, [result, winner, finishedAt, matchId]);
  }

  // RSVP METHODS
  async addRsvp(matchId, discordId, response, faceitNickname) {
    const query = `
      INSERT OR REPLACE INTO rsvp_status 
      (match_id, discord_id, faceit_nickname, response, timestamp)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;
    return this.run(query, [matchId, discordId, faceitNickname, response]);
  }

  async getUserRsvp(matchId, discordId) {
    const query = 'SELECT * FROM rsvp_status WHERE match_id = ? AND discord_id = ?';
    return this.get(query, [matchId, discordId]);
  }

  async getRsvpForMatch(matchId) {
    const query = 'SELECT * FROM rsvp_status WHERE match_id = ?';
    return this.all(query, [matchId]);
  }

  async removeUserRsvp(matchId, discordId) {
    const query = 'DELETE FROM rsvp_status WHERE match_id = ? AND discord_id = ?';
    return this.run(query, [matchId, discordId]);
  }

  async getAllRsvpData() {
    const query = 'SELECT * FROM rsvp_status ORDER BY timestamp';
    return this.all(query);
  }

  // MATCH THREAD METHODS
  async addMatchThread(matchId, threadId, threadType = 'upcoming') {
    // For finished matches, ensure we don't create duplicates by checking first
    if (threadType === 'finished') {
      const existingThread = await this.hasFinishedMatchThread(matchId);
      if (existingThread) {
        console.log(`⚠️ Preventing duplicate finished thread creation for match ${matchId}`);
        return { changes: 0, duplicate: true };
      }
    }
    
    const query = 'INSERT OR REPLACE INTO match_threads (match_id, thread_id, thread_type) VALUES (?, ?, ?)';
    return this.run(query, [matchId, threadId, threadType]);
  }

  async getMatchThread(matchId) {
    const query = 'SELECT thread_id FROM match_threads WHERE match_id = ?';
    const result = await this.get(query, [matchId]);
    return result ? result.thread_id : null;
  }

  async getAllMatchThreads() {
    const query = 'SELECT * FROM match_threads';
    return this.all(query);
  }

  async getThreadsByType(threadType) {
    const query = 'SELECT * FROM match_threads WHERE thread_type = ?';
    return this.all(query, [threadType]);
  }

  async hasFinishedMatchThread(matchId) {
    const query = 'SELECT 1 FROM match_threads WHERE match_id = ? AND thread_type = "finished"';
    const result = await this.get(query, [matchId]);
    return !!result;
  }

  async hasUpcomingMatchThread(matchId) {
    const query = 'SELECT 1 FROM match_threads WHERE match_id = ? AND thread_type = "upcoming"';
    const result = await this.get(query, [matchId]);
    return !!result;
  }

  async hasAnyMatchThread(matchId) {
    const query = 'SELECT 1 FROM match_threads WHERE match_id = ?';
    const result = await this.get(query, [matchId]);
    return !!result;
  }

  async removeMatchThread(matchId) {
    const query = 'DELETE FROM match_threads WHERE match_id = ?';
    return this.run(query, [matchId]);
  }

  // PROCESSED MATCHES METHODS
  async markMatchAsProcessed(matchId) {
    const query = 'INSERT OR IGNORE INTO processed_matches (match_id) VALUES (?)';
    return this.run(query, [matchId]);
  }

  async isMatchProcessed(matchId) {
    const query = 'SELECT 1 FROM processed_matches WHERE match_id = ?';
    const result = await this.get(query, [matchId]);
    return !!result;
  }

  async getAllProcessedMatches() {
    const query = 'SELECT match_id FROM processed_matches';
    const results = await this.all(query);
    return results.map(row => row.match_id);
  }

  // CLEANUP METHODS
  async cleanupOldData() {
    // Remove old RSVP data for finished matches older than 7 days
    const cleanupQuery = `
      DELETE FROM rsvp_status 
      WHERE match_id IN (
        SELECT match_id FROM matches 
        WHERE status = 'FINISHED' 
        AND finished_at < ?
      )
    `;
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    await this.run(cleanupQuery, [sevenDaysAgo]);

    // Remove old processed match entries for matches older than 30 days
    const oldProcessedQuery = `
      DELETE FROM processed_matches 
      WHERE match_id IN (
        SELECT match_id FROM matches 
        WHERE (status = 'FINISHED' OR status = 'CANCELLED')
        AND (finished_at < ? OR updated_at < datetime('now', '-30 days'))
      )
    `;
    await this.run(oldProcessedQuery, [sevenDaysAgo]);

    // Clean up expired cache entries
    const expiredMatchesCacheQuery = 'DELETE FROM matches_cache WHERE expires_at < datetime("now")';
    await this.run(expiredMatchesCacheQuery);
    
    const expiredApiCacheQuery = 'DELETE FROM api_cache WHERE expires_at < datetime("now")';
    await this.run(expiredApiCacheQuery);
    
    const expiredTeamDataCacheQuery = 'DELETE FROM team_data_cache WHERE expires_at < datetime("now")';
    await this.run(expiredTeamDataCacheQuery);
    
    console.log('Database cleanup completed');
  }

  // MATCHES CACHE METHODS
  /**
   * Store match data in cache
   */
  async setCacheEntry(matchId, matchData, matchType, cacheKey, ttlMinutes = 30) {
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    const query = `
      INSERT OR REPLACE INTO matches_cache 
      (match_id, match_data, match_type, scheduled_at, finished_at, cache_key, last_updated, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    `;
    
    const scheduledAt = matchData.scheduled_at || null;
    const finishedAt = matchData.finished_at || null;
    
    return this.run(query, [
      matchId,
      JSON.stringify(matchData),
      matchType,
      scheduledAt,
      finishedAt,
      cacheKey,
      expiresAt
    ]);
  }

  /**
   * Retrieve cached match data
   */
  async getCacheEntry(matchId) {
    const query = `
      SELECT * FROM matches_cache 
      WHERE match_id = ? AND expires_at > datetime("now")
    `;
    const result = await this.get(query, [matchId]);
    
    if (result) {
      try {
        return {
          ...result,
          match_data: JSON.parse(result.match_data)
        };
      } catch (error) {
        console.error('Error parsing cached match data:', error);
        // Remove corrupted cache entry
        await this.removeCacheEntry(matchId);
        return null;
      }
    }
    
    return null;
  }

  /**
   * Get cached entries by cache key
   */
  async getCacheEntriesByKey(cacheKey) {
    const query = `
      SELECT * FROM matches_cache 
      WHERE cache_key = ? AND expires_at > datetime("now")
      ORDER BY last_updated DESC
    `;
    const results = await this.all(query, [cacheKey]);
    
    return results.map(result => {
      try {
        return {
          ...result,
          match_data: JSON.parse(result.match_data)
        };
      } catch (error) {
        console.error('Error parsing cached match data:', error);
        return null;
      }
    }).filter(Boolean);
  }

  /**
   * Get cached entries by type
   */
  async getCacheEntriesByType(matchType) {
    const query = `
      SELECT * FROM matches_cache 
      WHERE match_type = ? AND expires_at > datetime("now")
      ORDER BY last_updated DESC
    `;
    const results = await this.all(query, [matchType]);
    
    return results.map(result => {
      try {
        return {
          ...result,
          match_data: JSON.parse(result.match_data)
        };
      } catch (error) {
        console.error('Error parsing cached match data:', error);
        return null;
      }
    }).filter(Boolean);
  }

  /**
   * Remove specific cache entry
   */
  async removeCacheEntry(matchId) {
    const query = 'DELETE FROM matches_cache WHERE match_id = ?';
    return this.run(query, [matchId]);
  }

  /**
   * Remove all cache entries for a specific key
   */
  async removeCacheEntriesByKey(cacheKey) {
    const query = 'DELETE FROM matches_cache WHERE cache_key = ?';
    return this.run(query, [cacheKey]);
  }

  /**
   * Clean up expired cache entries
   */
  async cleanupExpiredCache() {
    const query = 'DELETE FROM matches_cache WHERE expires_at < datetime("now")';
    const result = await this.run(query);
    console.log(`Cleaned up ${result.changes} expired cache entries`);
    return result;
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    const queries = {
      total: 'SELECT COUNT(*) as count FROM matches_cache',
      active: 'SELECT COUNT(*) as count FROM matches_cache WHERE expires_at > datetime("now")',
      expired: 'SELECT COUNT(*) as count FROM matches_cache WHERE expires_at <= datetime("now")',
      byType: 'SELECT match_type, COUNT(*) as count FROM matches_cache WHERE expires_at > datetime("now") GROUP BY match_type'
    };
    
    const stats = {
      total: (await this.get(queries.total)).count,
      active: (await this.get(queries.active)).count,
      expired: (await this.get(queries.expired)).count,
      byType: await this.all(queries.byType)
    };
    
    return stats;
  }

  // API CACHE METHODS
  /**
   * Store generic API response in cache
   */
  async setApiCache(cacheKey, data, ttlMinutes = 30) {
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    const query = `
      INSERT OR REPLACE INTO api_cache 
      (cache_key, data, expires_at, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `;
    
    return this.run(query, [
      cacheKey,
      JSON.stringify(data),
      expiresAt
    ]);
  }

  /**
   * Retrieve cached API response
   */
  async getApiCache(cacheKey) {
    const query = `
      SELECT * FROM api_cache 
      WHERE cache_key = ? AND expires_at > datetime("now")
    `;
    const result = await this.get(query, [cacheKey]);
    
    if (result) {
      try {
        return {
          ...result,
          data: JSON.parse(result.data)
        };
      } catch (error) {
        console.error('Error parsing cached API data:', error);
        // Remove corrupted cache entry
        await this.removeApiCache(cacheKey);
        return null;
      }
    }
    
    return null;
  }

  /**
   * Remove specific API cache entry
   */
  async removeApiCache(cacheKey) {
    const query = 'DELETE FROM api_cache WHERE cache_key = ?';
    return this.run(query, [cacheKey]);
  }

  /**
   * Clean up expired API cache entries
   */
  async cleanupExpiredApiCache() {
    const query = 'DELETE FROM api_cache WHERE expires_at < datetime("now")';
    const result = await this.run(query);
    console.log(`Cleaned up ${result.changes} expired API cache entries`);
    return result;
  }

  // TEAM DATA CACHE METHODS
  /**
   * Store team data in cache
   */
  async setTeamDataCache(dataType, data, ttlMinutes = 240) { // Default 4 hours
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    const query = `
      INSERT OR REPLACE INTO team_data_cache 
      (data_type, data, expires_at, last_updated)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `;
    
    return this.run(query, [
      dataType,
      JSON.stringify(data),
      expiresAt
    ]);
  }

  /**
   * Retrieve cached team data
   */
  async getTeamDataCache(dataType) {
    const query = `
      SELECT * FROM team_data_cache 
      WHERE data_type = ? AND expires_at > datetime("now")
    `;
    const result = await this.get(query, [dataType]);
    
    if (result) {
      try {
        return {
          ...result,
          data: JSON.parse(result.data)
        };
      } catch (error) {
        console.error('Error parsing cached team data:', error);
        // Remove corrupted cache entry
        await this.removeTeamDataCache(dataType);
        return null;
      }
    }
    
    return null;
  }

  /**
   * Remove specific team data cache entry
   */
  async removeTeamDataCache(dataType) {
    const query = 'DELETE FROM team_data_cache WHERE data_type = ?';
    return this.run(query, [dataType]);
  }

  /**
   * Clean up expired team data cache entries
   */
  async cleanupExpiredTeamDataCache() {
    const query = 'DELETE FROM team_data_cache WHERE expires_at < datetime("now")';
    const result = await this.run(query);
    console.log(`Cleaned up ${result.changes} expired team data cache entries`);
    return result;
  }

  // SEARCH METHODS
  async searchUserMappings(query) {
    const searchQuery = `
      SELECT * FROM user_mappings 
      WHERE discord_username LIKE ? 
      OR discord_id = ? 
      OR faceit_nickname LIKE ?
    `;
    const searchPattern = `%${query}%`;
    return this.all(searchQuery, [searchPattern, query, searchPattern]);
  }

  // ADMIN CLEAN METHODS
  async clearAllUserMappings() {
    console.log('Clearing all user mappings from database...');
    const query = 'DELETE FROM user_mappings';
    return this.run(query);
  }

  async clearAllRsvpData() {
    console.log('Clearing all RSVP data from database...');
    const query = 'DELETE FROM rsvp_status';
    return this.run(query);
  }

  // Close database connection
  async close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            console.error('Error closing database:', err.message);
          } else {
            console.log('Database connection closed');
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // Migration method for existing JSON data
  async migrateFromJson(jsonData) {
    console.log('Starting migration from JSON data...');
    
    try {
      // Migrate user mappings
      if (jsonData.userMappings) {
        for (const [discordId, mapping] of Object.entries(jsonData.userMappings)) {
          await this.addUserMapping(discordId, mapping.discord_username, {
            nickname: mapping.faceit_nickname,
            player_id: mapping.faceit_player_id,
            skill_level: mapping.faceit_skill_level,
            faceit_elo: mapping.faceit_elo,
            country: mapping.country
          });
        }
        console.log(`Migrated ${Object.keys(jsonData.userMappings).length} user mappings`);
      }

      // Migrate RSVP status
      if (jsonData.rsvpStatus) {
        for (const [matchId, rsvps] of Object.entries(jsonData.rsvpStatus)) {
          for (const [discordId, rsvpData] of Object.entries(rsvps)) {
            await this.addRsvp(matchId, discordId, rsvpData.response, rsvpData.faceit_nickname);
          }
        }
        console.log(`Migrated RSVP data for ${Object.keys(jsonData.rsvpStatus).length} matches`);
      }

      // Migrate processed matches
      if (jsonData.processedMatches && Array.isArray(jsonData.processedMatches)) {
        for (const matchId of jsonData.processedMatches) {
          await this.markMatchAsProcessed(matchId);
        }
        console.log(`Migrated ${jsonData.processedMatches.length} processed matches`);
      }

      // Migrate match threads
      if (jsonData.matchThreads) {
        for (const [matchId, threadId] of Object.entries(jsonData.matchThreads)) {
          await this.addMatchThread(matchId, threadId);
        }
        console.log(`Migrated ${Object.keys(jsonData.matchThreads).length} match threads`);
      }

      console.log('Migration completed successfully');
    } catch (error) {
      console.error('Migration error:', error);
      throw error;
    }
  }

  /**
   * Run database migrations for schema updates
   */
  async runMigrations() {
    try {
      // Check if thread_type column exists in match_threads table
      const tableInfo = await this.all("PRAGMA table_info(match_threads)");
      const hasThreadTypeColumn = tableInfo.some(column => column.name === 'thread_type');
      
      if (!hasThreadTypeColumn) {
        console.log('Adding thread_type column to match_threads table...');
        await this.run(`ALTER TABLE match_threads ADD COLUMN thread_type TEXT DEFAULT 'upcoming' CHECK (thread_type IN ('upcoming', 'finished'))`);
        console.log('Migration completed: Added thread_type column');
      }
    } catch (error) {
      console.error('Migration error:', error.message);
      // Don't throw here - let the app continue with existing schema
    }
  }

  /**
   * Extract operation name from SQL query for logging
   */
  extractOperationName(sql) {
    const trimmedSql = sql.trim().toUpperCase();
    if (trimmedSql.startsWith('SELECT')) return 'SELECT';
    if (trimmedSql.startsWith('INSERT')) return 'INSERT';
    if (trimmedSql.startsWith('UPDATE')) return 'UPDATE';
    if (trimmedSql.startsWith('DELETE')) return 'DELETE';
    if (trimmedSql.startsWith('CREATE')) return 'CREATE';
    if (trimmedSql.startsWith('DROP')) return 'DROP';
    if (trimmedSql.startsWith('ALTER')) return 'ALTER';
    if (trimmedSql.startsWith('BEGIN')) return 'BEGIN';
    if (trimmedSql.startsWith('COMMIT')) return 'COMMIT';
    if (trimmedSql.startsWith('ROLLBACK')) return 'ROLLBACK';
    return 'UNKNOWN';
  }
}

module.exports = new Database();
