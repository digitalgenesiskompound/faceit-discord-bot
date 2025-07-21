const databaseInstance = require('../../database');

class CacheService {
  constructor() {
    this.db = databaseInstance;
    this.memoryCache = new Map();
    this.cacheLogs = new Map(); // For monitoring cache hit/miss rates
    
    // Default TTL values (in minutes) - optimized for efficiency
    this.defaultTTL = {
      matches: 20,
      finishedMatches: 360, // 6 hours - finished matches rarely change
      teamData: 480, // 8 hours - team data very rarely changes
      playerData: 30, // 30 minutes for player data
      playerSearch: 10, // 10 minutes for search results
      apiGeneric: 10 // Increased from 5 to 10 minutes
    };
    
    // Cleanup expired memory cache every 10 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupMemoryCache();
    }, 10 * 60 * 1000);
  }

  /**
   * Generate cache key with prefix
   */
  generateCacheKey(type, identifier) {
    return `${type}:${identifier}`;
  }

  /**
   * Log cache operation for monitoring
   */
  logCacheOperation(key, operation, hit = true) {
    if (!this.cacheLogs.has(key)) {
      this.cacheLogs.set(key, { hits: 0, misses: 0 });
    }
    
    const stats = this.cacheLogs.get(key);
    if (hit && operation === 'get') {
      stats.hits++;
    } else if (!hit && operation === 'get') {
      stats.misses++;
    }
  }

  /**
   * Get data with multi-level caching (memory -> database -> source)
   */
  async getCachedData(key, sourceFunction, options = {}) {
    const {
      ttlMinutes = this.defaultTTL.apiGeneric,
      useMemory = true,
      useDatabase = true,
      forceRefresh = false
    } = options;

    // Skip cache if force refresh
    if (forceRefresh) {
      const data = await sourceFunction();
      await this.setCachedData(key, data, { ttlMinutes, useMemory, useDatabase });
      return data;
    }

    // Check memory cache first
    if (useMemory) {
      const memoryData = this.getFromMemoryCache(key);
      if (memoryData) {
        this.logCacheOperation(key, 'get', true);
        console.log(`📋 Cache HIT (memory): ${key}`);
        return memoryData;
      }
    }

    // Check database cache
    if (useDatabase) {
      const dbData = await this.getFromDatabaseCache(key);
      if (dbData) {
        // Store in memory cache for faster future access
        if (useMemory) {
          this.setInMemoryCache(key, dbData, ttlMinutes);
        }
        this.logCacheOperation(key, 'get', true);
        console.log(`🗃️ Cache HIT (database): ${key}`);
        return dbData;
      }
    }

    // Cache miss - fetch from source
    this.logCacheOperation(key, 'get', false);
    console.log(`❌ Cache MISS: ${key} - fetching from source`);
    
    try {
      const data = await sourceFunction();
      await this.setCachedData(key, data, { ttlMinutes, useMemory, useDatabase });
      return data;
    } catch (error) {
      console.error(`Error fetching data for cache key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Set data in cache (memory and/or database)
   */
  async setCachedData(key, data, options = {}) {
    const {
      ttlMinutes = this.defaultTTL.apiGeneric,
      useMemory = true,
      useDatabase = true
    } = options;

    const promises = [];

    if (useMemory) {
      this.setInMemoryCache(key, data, ttlMinutes);
    }

    if (useDatabase) {
      promises.push(this.setInDatabaseCache(key, data, ttlMinutes));
    }

    await Promise.all(promises);
    console.log(`💾 Data cached: ${key} (TTL: ${ttlMinutes}min)`);
  }

  /**
   * Memory cache operations
   */
  setInMemoryCache(key, data, ttlMinutes) {
    const expiresAt = Date.now() + (ttlMinutes * 60 * 1000);
    this.memoryCache.set(key, {
      data,
      expiresAt
    });
  }

  getFromMemoryCache(key) {
    const cached = this.memoryCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    
    if (cached) {
      this.memoryCache.delete(key); // Remove expired entry
    }
    
    return null;
  }

  /**
   * Database cache operations
   */
  async setInDatabaseCache(key, data, ttlMinutes) {
    try {
      await this.db.setApiCache(key, data, ttlMinutes);
    } catch (error) {
      console.error(`Error setting database cache for ${key}:`, error);
    }
  }

  async getFromDatabaseCache(key) {
    try {
      const cached = await this.db.getApiCache(key);
      return cached ? cached.data : null;
    } catch (error) {
      console.error(`Error getting database cache for ${key}:`, error);
      return null;
    }
  }

  /**
   * Specialized cache methods for different data types
   */

  // Match cache methods
  async getUpcomingMatches(fetchFunction) {
    return this.getCachedData(
      'matches:upcoming',
      fetchFunction,
      { 
        ttlMinutes: this.defaultTTL.matches,
        useMemory: true,
        useDatabase: true
      }
    );
  }

  async getFinishedMatches(fetchFunction, limit = 20) {
    return this.getCachedData(
      `matches:finished:${limit}`,
      fetchFunction,
      { 
        ttlMinutes: this.defaultTTL.finishedMatches,
        useMemory: true,
        useDatabase: true
      }
    );
  }

  // Team data cache methods
  async getTeamPlayers(fetchFunction) {
    return this.getCachedData(
      'team:players',
      fetchFunction,
      { 
        ttlMinutes: this.defaultTTL.teamData,
        useMemory: true,
        useDatabase: true
      }
    );
  }

  async getTeamData(fetchFunction) {
    return this.getCachedData(
      'team:data',
      fetchFunction,
      { 
        ttlMinutes: this.defaultTTL.teamData,
        useMemory: true,
        useDatabase: true
      }
    );
  }

  // Player data cache methods
  async getPlayerData(playerId, fetchFunction) {
    return this.getCachedData(
      `player:${playerId}`,
      fetchFunction,
      { 
        ttlMinutes: this.defaultTTL.playerData,
        useMemory: true,
        useDatabase: true
      }
    );
  }

  /**
   * Cache invalidation methods
   */
  async invalidateCache(key) {
    // Remove from memory
    this.memoryCache.delete(key);
    
    // Remove from database
    try {
      await this.db.removeApiCache(key);
      console.log(`🗑️ Cache invalidated: ${key}`);
    } catch (error) {
      console.error(`Error invalidating cache for ${key}:`, error);
    }
  }

  async invalidateCachePattern(pattern) {
    // Remove from memory cache
    for (const key of this.memoryCache.keys()) {
      if (key.includes(pattern)) {
        this.memoryCache.delete(key);
      }
    }

    // Note: Database pattern matching would require additional implementation
    console.log(`🗑️ Cache pattern invalidated: ${pattern}`);
  }

  /**
   * Cache maintenance and monitoring
   */
  cleanupMemoryCache() {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, value] of this.memoryCache.entries()) {
      if (value.expiresAt <= now) {
        this.memoryCache.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      console.log(`🧹 Cleaned up ${removed} expired memory cache entries`);
    }
  }

  async cleanupDatabaseCache() {
    try {
      await this.db.cleanupExpiredApiCache();
      await this.db.cleanupExpiredTeamDataCache();
      await this.db.cleanupExpiredCache();
    } catch (error) {
      console.error('Error cleaning up database cache:', error);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const memoryStats = {
      size: this.memoryCache.size,
      hitMissRatio: this.getHitMissRatio()
    };

    return {
      memory: memoryStats,
      logs: Object.fromEntries(this.cacheLogs)
    };
  }

  getHitMissRatio() {
    let totalHits = 0;
    let totalMisses = 0;
    
    for (const stats of this.cacheLogs.values()) {
      totalHits += stats.hits;
      totalMisses += stats.misses;
    }
    
    const total = totalHits + totalMisses;
    return total > 0 ? (totalHits / total * 100).toFixed(2) + '%' : '0%';
  }

  async getDatabaseCacheStats() {
    try {
      return await this.db.getCacheStats();
    } catch (error) {
      console.error('Error getting database cache stats:', error);
      return null;
    }
  }

  /**
   * Preload cache with commonly accessed data
   */
  async preloadCache() {
    console.log('🚀 Preloading cache with commonly accessed data...');
    
    // This could be called on startup to warm up the cache
    // Implementation would depend on your specific use case
    
    console.log('✅ Cache preload completed');
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.memoryCache.clear();
    this.cacheLogs.clear();
  }
}

module.exports = new CacheService();
