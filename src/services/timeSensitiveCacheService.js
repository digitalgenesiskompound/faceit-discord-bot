const databaseInstance = require('../../database');
const cacheService = require('./cacheService');

class TimeSensitiveCacheService {
  constructor() {
    this.db = databaseInstance;
    this.baseCache = cacheService;
    
    // Match timing configuration
    this.MATCH_TIME_CONFIG = {
      PRE_MATCH_HOURS: 1,           // Start faster refresh 1 hour before match
      ACTIVE_MATCH_DURATION: 2,    // Consider match "active" for 2 hours after start
      COOLDOWN_DURATION: 3,        // Faster refresh for 3 hours after active period
      PROACTIVE_CHECK_INTERVAL: 10, // Check every 10 minutes during active periods (less aggressive)
      RESULT_NOTIFICATION_WINDOW: 10 // Notify if match finished in last 10 minutes
    };
    
    // Cache TTL strategies based on match timing
    this.MATCH_LIFECYCLE_CACHE = {
      PRE_MATCH: {
        finishedMatches: { memoryTTL: 30, dbTTL: 360 },    // 6 hours cache during normal periods
        upcomingMatches: { memoryTTL: 8, dbTTL: 20 },      // Standard cache
        teamData: { memoryTTL: 0, dbTTL: 480 },            // 8 hours - team data rarely changes
        playerData: { memoryTTL: 5, dbTTL: 30 },           // 30 minutes for player data
        playerSearch: { memoryTTL: 2, dbTTL: 10 }          // 10 minutes for search results
      },
      APPROACHING_MATCH: {
        finishedMatches: { memoryTTL: 15, dbTTL: 60 },     // 1 hour cache approaching match
        upcomingMatches: { memoryTTL: 5, dbTTL: 20 },      // 20 minutes cache
        teamData: { memoryTTL: 0, dbTTL: 480 },            // Team data unchanged
        playerData: { memoryTTL: 5, dbTTL: 30 },           // Player data unchanged
        playerSearch: { memoryTTL: 2, dbTTL: 10 }          // Search results unchanged
      },
      ACTIVE_MATCH: {
        finishedMatches: { memoryTTL: 1, dbTTL: 3 },       // Very short cache during active match
        upcomingMatches: { memoryTTL: 2, dbTTL: 5 },       // Quick updates
        teamData: { memoryTTL: 0, dbTTL: 480 },            // Team data still long cache
        playerData: { memoryTTL: 5, dbTTL: 30 },           // Player data unchanged
        playerSearch: { memoryTTL: 2, dbTTL: 10 }          // Search results unchanged
      },
      POST_MATCH_COOLDOWN: {
        finishedMatches: { memoryTTL: 5, dbTTL: 15 },      // Medium cache post-match
        upcomingMatches: { memoryTTL: 5, dbTTL: 15 },      // Back to normal
        teamData: { memoryTTL: 0, dbTTL: 480 },            // Team data long cache
        playerData: { memoryTTL: 5, dbTTL: 30 },           // Player data unchanged
        playerSearch: { memoryTTL: 2, dbTTL: 10 }          // Search results unchanged
      },
      NORMAL_PERIOD: {
        finishedMatches: { memoryTTL: 30, dbTTL: 360 },    // 6 hours cache during normal periods
        upcomingMatches: { memoryTTL: 8, dbTTL: 20 },      // Standard cache
        teamData: { memoryTTL: 0, dbTTL: 480 },            // 8 hours - team data rarely changes
        playerData: { memoryTTL: 5, dbTTL: 30 },           // 30 minutes for player data
        playerSearch: { memoryTTL: 2, dbTTL: 10 }          // 10 minutes for search results
      }
    };
    
    // Track last cache times for force refresh logic
    this.lastCacheTimes = new Map();
    
    // Initialize proactive checking
    this.proactiveInterval = null;
    this.startProactiveChecking();
  }
  
  /**
   * Determine current cache period based on upcoming matches
   */
  async getCurrentCachePeriod() {
    try {
      const now = Date.now() / 1000; // Unix timestamp
      
      // Get upcoming matches from cache (don't trigger a full refresh here)
      const upcomingMatches = await this.getUpcomingMatchesFromCache();
      
      if (!upcomingMatches || upcomingMatches.length === 0) {
        return 'NORMAL_PERIOD';
      }
      
      for (const match of upcomingMatches) {
        const matchTime = match.scheduled_at;
        const timeDiff = matchTime - now;
        const timeAfterMatch = now - matchTime;
        
        // During match period (match time to +3 hours)
        if (timeDiff <= 0 && timeAfterMatch <= (this.MATCH_TIME_CONFIG.ACTIVE_MATCH_DURATION * 3600)) {
          return 'ACTIVE_MATCH';
        }
        
        // Approaching match (2 hours before)
        if (timeDiff <= (this.MATCH_TIME_CONFIG.PRE_MATCH_HOURS * 3600) && timeDiff > 0) {
          return 'APPROACHING_MATCH';
        }
        
        // Post-match cooldown (3-6 hours after)
        const cooldownStart = this.MATCH_TIME_CONFIG.ACTIVE_MATCH_DURATION * 3600;
        const cooldownEnd = cooldownStart + (this.MATCH_TIME_CONFIG.COOLDOWN_DURATION * 3600);
        if (timeAfterMatch > cooldownStart && timeAfterMatch <= cooldownEnd) {
          return 'POST_MATCH_COOLDOWN';
        }
      }
      
      return 'NORMAL_PERIOD';
    } catch (error) {
      console.error('Error determining cache period:', error);
      return 'NORMAL_PERIOD';
    }
  }
  
  /**
   * Get upcoming matches from cache without triggering refresh
   */
  async getUpcomingMatchesFromCache() {
    try {
      // Try memory cache first
      const memoryData = this.baseCache.getFromMemoryCache('matches:upcoming');
      if (memoryData) {
        return memoryData;
      }
      
      // Try database cache
      const dbData = await this.baseCache.getFromDatabaseCache('matches:upcoming');
      if (dbData) {
        return dbData;
      }
      
      return [];
    } catch (error) {
      console.error('Error getting upcoming matches from cache:', error);
      return [];
    }
  }
  
  /**
   * Get dynamic TTL based on current match timing
   */
  async getDynamicTTL(dataType) {
    const period = await this.getCurrentCachePeriod();
    const config = this.MATCH_LIFECYCLE_CACHE[period];
    return config[dataType] || this.MATCH_LIFECYCLE_CACHE.NORMAL_PERIOD[dataType];
  }
  
  /**
   * Check if we should force refresh based on match timing
   * Removed aggressive force refresh - rely on TTL-based cache expiration
   */
  async shouldForceRefresh(cacheKey) {
    // Removed force refresh during active match periods
    // The shorter TTLs during ACTIVE_MATCH period will handle freshness
    return false;
  }
  
  /**
   * Enhanced finished matches method with time awareness
   */
  async getFinishedMatchesTimeAware(fetchFunction, limit = 20) {
    const cacheKey = `matches:finished:${limit}`;
    const dynamicTTL = await this.getDynamicTTL('finishedMatches');
    const shouldForceRefresh = await this.shouldForceRefresh(cacheKey);
    
    // Log the current cache strategy
    const period = await this.getCurrentCachePeriod();
    console.log(`📊 Cache period: ${period}, TTL: ${dynamicTTL.dbTTL}min, Force refresh: ${shouldForceRefresh}`);
    
    const result = await this.baseCache.getCachedData(
      cacheKey,
      fetchFunction,
      {
        ttlMinutes: dynamicTTL.dbTTL,
        useMemory: true,
        useDatabase: true,
        forceRefresh: shouldForceRefresh
      }
    );
    
    // Update last cache time
    this.lastCacheTimes.set(cacheKey, Date.now());
    
    return result;
  }
  
  /**
   * Enhanced upcoming matches method with time awareness
   */
  async getUpcomingMatchesTimeAware(fetchFunction) {
    const cacheKey = 'matches:upcoming';
    const dynamicTTL = await this.getDynamicTTL('upcomingMatches');
    const shouldForceRefresh = await this.shouldForceRefresh(cacheKey);
    
    // Log the current cache strategy
    const period = await this.getCurrentCachePeriod();
    console.log(`📊 Cache period: ${period}, TTL: ${dynamicTTL.dbTTL}min, Force refresh: ${shouldForceRefresh}`);
    
    const result = await this.baseCache.getCachedData(
      cacheKey,
      fetchFunction,
      {
        ttlMinutes: dynamicTTL.dbTTL,
        useMemory: true,
        useDatabase: true,
        forceRefresh: shouldForceRefresh
      }
    );
    
    // Update last cache time
    this.lastCacheTimes.set(cacheKey, Date.now());
    
    return result;
  }
  
  /**
   * Enhanced team data method with time awareness (optimized TTL)
   */
  async getTeamDataTimeAware(fetchFunction) {
    const cacheKey = 'team:data';
    const dynamicTTL = await this.getDynamicTTL('teamData');
    
    return await this.baseCache.getCachedData(
      cacheKey,
      fetchFunction,
      {
        ttlMinutes: dynamicTTL.dbTTL,
        useMemory: dynamicTTL.memoryTTL > 0,
        useDatabase: true
      }
    );
  }
  
  /**
   * Enhanced team players method with time awareness (optimized TTL)
   */
  async getTeamPlayersTimeAware(fetchFunction) {
    const cacheKey = 'team:players';
    const dynamicTTL = await this.getDynamicTTL('teamData');
    
    return await this.baseCache.getCachedData(
      cacheKey,
      fetchFunction,
      {
        ttlMinutes: dynamicTTL.dbTTL,
        useMemory: dynamicTTL.memoryTTL > 0,
        useDatabase: true
      }
    );
  }
  
  /**
   * Enhanced player data method with time awareness (optimized TTL)
   */
  async getPlayerDataTimeAware(playerId, fetchFunction) {
    const cacheKey = `player:${playerId}`;
    const dynamicTTL = await this.getDynamicTTL('playerData');
    
    return await this.baseCache.getCachedData(
      cacheKey,
      fetchFunction,
      {
        ttlMinutes: dynamicTTL.dbTTL,
        useMemory: true,
        useDatabase: true
      }
    );
  }
  
  /**
   * Enhanced player search method with time awareness (optimized TTL)
   */
  async getPlayerSearchTimeAware(query, fetchFunction) {
    const cacheKey = `search:${query.toLowerCase()}`;
    const dynamicTTL = await this.getDynamicTTL('playerSearch');
    
    return await this.baseCache.getCachedData(
      cacheKey,
      fetchFunction,
      {
        ttlMinutes: dynamicTTL.dbTTL,
        useMemory: true,
        useDatabase: true
      }
    );
  }
  
  /**
   * Start proactive checking during active match periods
   */
  startProactiveChecking() {
    if (this.proactiveInterval) return; // Already running
    
    console.log('🚀 Starting proactive match result checking...');
    
    this.proactiveInterval = setInterval(async () => {
      try {
        const period = await this.getCurrentCachePeriod();
        
        if (period === 'ACTIVE_MATCH' || period === 'POST_MATCH_COOLDOWN') {
          console.log(`🔄 Background maintenance during ${period} period...`);
          
          // Just log the active period - let TTL handle cache expiration naturally
          // The shorter TTLs (3 minutes for finished matches) will ensure fresh data
          
        } else if (period === 'NORMAL_PERIOD') {
          // Log normal period status
          console.log('📊 Normal cache period - using longer TTLs for efficiency');
        }
      } catch (error) {
        console.error('Error in proactive checking:', error);
      }
    }, this.MATCH_TIME_CONFIG.PROACTIVE_CHECK_INTERVAL * 60 * 1000); // Convert minutes to ms
  }
  
  /**
   * Stop proactive checking
   */
  stopProactiveChecking() {
    if (this.proactiveInterval) {
      clearInterval(this.proactiveInterval);
      this.proactiveInterval = null;
      console.log('⏹️ Stopped proactive match checking');
    }
  }
  
  /**
   * Get cache period status for debugging/display
   */
  async getCacheStatus() {
    const period = await this.getCurrentCachePeriod();
    const dynamicTTLFinished = await this.getDynamicTTL('finishedMatches');
    const dynamicTTLUpcoming = await this.getDynamicTTL('upcomingMatches');
    
    return {
      period,
      ttl: {
        finishedMatches: dynamicTTLFinished,
        upcomingMatches: dynamicTTLUpcoming
      },
      isProactiveCheckingEnabled: this.proactiveInterval !== null
    };
  }
  
  /**
   * Manual cache invalidation for immediate fresh data
   */
  async forceRefreshMatchData() {
    console.log('🔄 Forcing immediate refresh of all match data...');
    
    // Clear cache times to force refresh
    this.lastCacheTimes.clear();
    
    // Invalidate all match-related caches
    await this.baseCache.invalidateCache('matches:upcoming');
    await this.baseCache.invalidateCache('matches:finished:10');
    await this.baseCache.invalidateCache('matches:finished:20');
    
    console.log('✅ Match data caches cleared - fresh data will be fetched on next request');
  }
  
  /**
   * Cleanup resources
   */
  cleanup() {
    this.stopProactiveChecking();
    this.lastCacheTimes.clear();
  }
}

module.exports = new TimeSensitiveCacheService();
