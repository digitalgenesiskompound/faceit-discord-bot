const databaseInstance = require('../../database');

/**
 * Unified Cache Service - Replaces all existing cache services
 * Simple, efficient caching with memory and database layers
 */
class Cache {
  constructor() {
    this.db = databaseInstance;
    this.memory = new Map();
    
    // Simple TTL configuration (in minutes)
    this.ttl = {
      matches: 15,        // Upcoming matches
      finished: 60,       // Finished matches
      players: 30,        // Player data
      threads: 5,         // Thread references
      search: 10,         // Search results
      team: 120          // Team data (rarely changes)
    };
    
    // Statistics
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0
    };
    
    // Cleanup expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }
  
  /**
   * Get data with fallback chain: memory -> database -> source function
   */
  async get(key, sourceFunction, options = {}) {
    const ttlMinutes = options.ttl || this.ttl.matches;
    const useDatabase = options.database !== false;
    
    // Try memory cache first
    const memoryData = this.getFromMemory(key);
    if (memoryData !== null) {
      this.stats.hits++;
      console.log(`📋 Cache HIT (memory): ${key}`);
      return memoryData;
    }
    
    // Try database cache if enabled
    if (useDatabase) {
      const dbData = await this.getFromDatabase(key);
      if (dbData !== null) {
        // Store in memory for faster access
        this.setInMemory(key, dbData, ttlMinutes);
        this.stats.hits++;
        console.log(`🗃️ Cache HIT (database): ${key}`);
        return dbData;
      }
    }
    
    // Cache miss - fetch from source
    this.stats.misses++;
    console.log(`❌ Cache MISS: ${key}`);
    
    if (!sourceFunction) {
      return null;
    }
    
    try {
      const data = await sourceFunction();
      if (data !== null && data !== undefined) {
        await this.set(key, data, ttlMinutes, useDatabase);
      }
      return data;
    } catch (error) {
      console.error(`Error fetching data for ${key}:`, error.message);
      throw error;
    }
  }
  
  /**
   * Set data in cache layers
   */
  async set(key, data, ttlMinutes = this.ttl.matches, useDatabase = true) {
    this.stats.sets++;
    
    // Always set in memory
    this.setInMemory(key, data, ttlMinutes);
    
    // Set in database if requested
    if (useDatabase) {
      await this.setInDatabase(key, data, ttlMinutes);
    }
    
    console.log(`💾 Cached: ${key} (TTL: ${ttlMinutes}min)`);
  }
  
  /**
   * Memory cache operations
   */
  setInMemory(key, data, ttlMinutes) {
    const expiresAt = Date.now() + (ttlMinutes * 60 * 1000);
    this.memory.set(key, {
      data,
      expiresAt,
      createdAt: Date.now()
    });
  }
  
  getFromMemory(key) {
    const cached = this.memory.get(key);
    if (!cached) return null;
    
    if (cached.expiresAt > Date.now()) {
      return cached.data;
    }
    
    // Expired - remove it
    this.memory.delete(key);
    return null;
  }
  
  /**
   * Database cache operations
   */
  async setInDatabase(key, data, ttlMinutes) {
    try {
      if (this.db.isInitialized) {
        await this.db.setApiCache(key, data, ttlMinutes);
      }
    } catch (error) {
      console.error(`Database cache set failed for ${key}:`, error.message);
    }
  }
  
  async getFromDatabase(key) {
    try {
      if (!this.db.isInitialized) return null;
      
      const cached = await this.db.getApiCache(key);
      return cached ? cached.data : null;
    } catch (error) {
      console.error(`Database cache get failed for ${key}:`, error.message);
      return null;
    }
  }
  
  /**
   * Invalidate cache entries
   */
  invalidate(key) {
    this.memory.delete(key);
    console.log(`🗑️ Invalidated: ${key}`);
  }
  
  invalidatePattern(pattern) {
    let removed = 0;
    for (const key of this.memory.keys()) {
      if (key.includes(pattern)) {
        this.memory.delete(key);
        removed++;
      }
    }
    console.log(`🗑️ Invalidated ${removed} entries matching: ${pattern}`);
  }
  
  /**
   * Clear all cache
   */
  clear() {
    this.memory.clear();
    console.log('🗑️ Cleared all memory cache');
  }
  
  /**
   * Cleanup expired entries
   */
  cleanup() {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, value] of this.memory.entries()) {
      if (value.expiresAt <= now) {
        this.memory.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      console.log(`🧹 Cleaned up ${removed} expired cache entries`);
    }
  }
  
  /**
   * Specialized methods for different data types
   */
  async getUpcomingMatches(sourceFunction) {
    return this.get('matches:upcoming', sourceFunction, { ttl: this.ttl.matches });
  }

  async getFinishedMatches(sourceFunction, limit = 20) {
    return this.get(`matches:finished:${limit}`, sourceFunction, { ttl: this.ttl.finished });
  }

  async getTeamData(key, sourceFunction) {
    return this.get(`team:${key}`, sourceFunction, { ttl: this.ttl.team });
  }

  async getMatchDetails(matchId, sourceFunction) {
    return this.get(`match:${matchId}`, sourceFunction, { ttl: this.ttl.matches });
  }

  async getPlayerData(playerId, sourceFunction) {
    return this.get(`player:${playerId}`, sourceFunction, { ttl: this.ttl.players });
  }

  async getUserSearch(query, sourceFunction) {
    return this.get(`search:${query.toLowerCase()}`, sourceFunction, { ttl: this.ttl.search });
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) : '0.0';
    
    return {
      ...this.stats,
      memorySize: this.memory.size,
      hitRate: `${hitRate}%`
    };
  }
  
  /**
   * Specialized methods for common use cases
   */
  async getMatches(type, sourceFunction) {
    const key = `matches:${type}`;
    const ttl = type === 'finished' ? this.ttl.finished : this.ttl.matches;
    return this.get(key, sourceFunction, { ttl });
  }
  
  async getPlayer(playerId, sourceFunction) {
    const key = `player:${playerId}`;
    return this.get(key, sourceFunction, { ttl: this.ttl.players });
  }
  
  async getTeam(sourceFunction) {
    const key = 'team:data';
    return this.get(key, sourceFunction, { ttl: this.ttl.team });
  }
  
  /**
   * Cleanup resources
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.memory.clear();
  }
}

module.exports = new Cache();
