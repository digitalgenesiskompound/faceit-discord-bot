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
   * Determine current cache period based on upcoming matches with enhanced timing analysis
   */
  async getCurrentCachePeriod() {
    try {
      const now = Date.now() / 1000; // Unix timestamp
      
      console.log(`⏰ Analyzing match timing at ${new Date(now * 1000).toISOString()}`);
      
      // Get upcoming matches from cache AND database for comprehensive analysis
      const upcomingMatches = await this.getUpcomingMatchesFromCache();
      const finishedMatches = await this.getRecentFinishedMatchesFromCache();
      
      let mostCriticalPeriod = 'NORMAL_PERIOD';
      let activePeriodDetails = [];
      
      // Analyze upcoming matches
      if (upcomingMatches && upcomingMatches.length > 0) {
        for (const match of upcomingMatches) {
          if (!match.scheduled_at) continue;
          
          const matchTime = match.scheduled_at;
          const timeDiff = matchTime - now;
          const hoursUntilMatch = timeDiff / 3600;
          
          console.log(`📅 Match ${match.match_id}: ${match.teams?.faction1?.name} vs ${match.teams?.faction2?.name}`);
          console.log(`   Scheduled: ${new Date(matchTime * 1000).toISOString()}`);
          console.log(`   Time until match: ${hoursUntilMatch.toFixed(1)} hours`);
          
          // Pre-match period (1 hour before)
          if (timeDiff <= (this.MATCH_TIME_CONFIG.PRE_MATCH_HOURS * 3600) && timeDiff > 0) {
            console.log(`   🟡 APPROACHING_MATCH period detected`);
            mostCriticalPeriod = 'APPROACHING_MATCH';
            activePeriodDetails.push({
              type: 'approaching',
              matchId: match.match_id,
              timeUntil: hoursUntilMatch
            });
          }
          
          // Active match period (match time to +2 hours after)
          if (timeDiff <= 0 && Math.abs(timeDiff) <= (this.MATCH_TIME_CONFIG.ACTIVE_MATCH_DURATION * 3600)) {
            console.log(`   🔴 ACTIVE_MATCH period detected`);
            mostCriticalPeriod = 'ACTIVE_MATCH';
            activePeriodDetails.push({
              type: 'active',
              matchId: match.match_id,
              minutesSinceStart: Math.abs(timeDiff) / 60
            });
          }
        }
      }
      
      // Analyze recently finished matches for post-match cooldown
      if (finishedMatches && finishedMatches.length > 0) {
        for (const match of finishedMatches) {
          if (!match.finished_at) continue;
          
          const finishTime = match.finished_at;
          const timeSinceFinish = now - finishTime;
          const hoursSinceFinish = timeSinceFinish / 3600;
          
          console.log(`🏁 Finished Match ${match.match_id}: finished ${hoursSinceFinish.toFixed(1)} hours ago`);
          
          // Post-match cooldown (first 3 hours after finish)
          if (timeSinceFinish <= (this.MATCH_TIME_CONFIG.COOLDOWN_DURATION * 3600)) {
            console.log(`   🟠 POST_MATCH_COOLDOWN period detected`);
            if (mostCriticalPeriod === 'NORMAL_PERIOD') {
              mostCriticalPeriod = 'POST_MATCH_COOLDOWN';
            }
            activePeriodDetails.push({
              type: 'cooldown',
              matchId: match.match_id,
              hoursSinceFinish: hoursSinceFinish
            });
          }
        }
      }
      
      console.log(`🎯 Determined cache period: ${mostCriticalPeriod}`);
      if (activePeriodDetails.length > 0) {
        console.log(`📊 Active period details:`, activePeriodDetails);
      }
      
      return mostCriticalPeriod;
    } catch (error) {
      console.error('❌ Error determining cache period:', error);
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
   * Get recent finished matches from cache for post-match analysis
   */
  async getRecentFinishedMatchesFromCache() {
    try {
      // Try memory cache first
      const memoryData = this.baseCache.getFromMemoryCache('matches:finished:10');
      if (memoryData) {
        return memoryData;
      }
      
      // Try database cache
      const dbData = await this.baseCache.getFromDatabaseCache('matches:finished:10');
      if (dbData) {
        return dbData;
      }
      
      return [];
    } catch (error) {
      console.error('Error getting finished matches from cache:', error);
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
   * Check if we should force refresh based on match timing and cache invalidation triggers
   */
  async shouldForceRefresh(cacheKey) {
    const period = await this.getCurrentCachePeriod();
    const lastCacheTime = this.lastCacheTimes.get(cacheKey);
    
    // Force refresh during active match periods if cache is older than 2 minutes
    if (period === 'ACTIVE_MATCH' && lastCacheTime) {
      const cacheAge = Date.now() - lastCacheTime;
      if (cacheAge > 2 * 60 * 1000) { // 2 minutes
        console.log(`🔄 Forcing refresh for ${cacheKey} during ACTIVE_MATCH (cache age: ${Math.round(cacheAge / 1000)}s)`);
        return true;
      }
    }
    
    // Force refresh for finished matches during post-match cooldown if cache is older than 5 minutes
    if (period === 'POST_MATCH_COOLDOWN' && cacheKey.includes('finished') && lastCacheTime) {
      const cacheAge = Date.now() - lastCacheTime;
      if (cacheAge > 5 * 60 * 1000) { // 5 minutes
        console.log(`🔄 Forcing refresh for ${cacheKey} during POST_MATCH_COOLDOWN (cache age: ${Math.round(cacheAge / 1000)}s)`);
        return true;
      }
    }
    
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
          // During normal periods, check for matches that should have finished
          await this.checkForOverdueMatches();
        }
      } catch (error) {
        console.error('Error in proactive checking:', error);
      }
    }, this.MATCH_TIME_CONFIG.PROACTIVE_CHECK_INTERVAL * 60 * 1000); // Convert minutes to ms
  }
  
  /**
   * Check for matches that should have finished but may not be reflected in cache
   */
  async checkForOverdueMatches() {
    try {
      console.log('🔍 Checking for overdue matches that may have finished...');
      
      const upcomingMatches = await this.getUpcomingMatchesFromCache();
      if (!upcomingMatches || upcomingMatches.length === 0) {
        return;
      }
      
      const now = Date.now() / 1000; // Unix timestamp
      let foundOverdueMatches = false;
      
      for (const match of upcomingMatches) {
        if (!match.scheduled_at) continue;
        
        const matchTime = match.scheduled_at;
        const timeSinceScheduled = now - matchTime;
        const hoursSinceScheduled = timeSinceScheduled / 3600;
        
        // If a match was scheduled more than 2.5 hours ago, it's likely finished
        // (Typical CS2 matches last 1-2 hours, so 2.5 hours is a safe threshold)
        if (hoursSinceScheduled >= 2.5) {
          console.log(`⚠️ Found overdue match: ${match.match_id} (${match.teams?.faction1?.name} vs ${match.teams?.faction2?.name})`);
          console.log(`   Scheduled: ${new Date(matchTime * 1000).toISOString()}`);
          console.log(`   Hours since scheduled: ${hoursSinceScheduled.toFixed(1)}`);
          foundOverdueMatches = true;
        }
      }
      
      if (foundOverdueMatches) {
        console.log('🔄 Overdue matches detected - invalidating cache to check for results...');
        await this.invalidateCacheForEvent('match_transition_check');
      }
      
    } catch (error) {
      console.error('Error checking for overdue matches:', error);
    }
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
   * Invalidate cache based on specific events (match start, finish, reschedule)
   */
  async invalidateCacheForEvent(eventType, matchId = null) {
    console.log(`🗑️ Cache invalidation triggered by event: ${eventType}${matchId ? ` (match: ${matchId})` : ''}`);
    
    switch (eventType) {
      case 'match_start':
        // Clear upcoming matches cache when match starts
        await this.baseCache.invalidateCache('matches:upcoming');
        this.lastCacheTimes.delete('matches:upcoming');
        break;
        
      case 'match_finish':
        // Clear both upcoming and finished matches cache when match finishes
        await this.baseCache.invalidateCache('matches:upcoming');
        await this.baseCache.invalidateCache('matches:finished:10');
        await this.baseCache.invalidateCache('matches:finished:20');
        this.lastCacheTimes.delete('matches:upcoming');
        this.lastCacheTimes.delete('matches:finished:10');
        this.lastCacheTimes.delete('matches:finished:20');
        break;
        
      case 'match_reschedule':
        // Clear upcoming matches cache when match is rescheduled
        await this.baseCache.invalidateCache('matches:upcoming');
        this.lastCacheTimes.delete('matches:upcoming');
        break;
        
      case 'rsvp_update':
        // No need to invalidate match data caches for RSVP updates
        // RSVP data is stored separately
        break;
        
      case 'thread_created':
      case 'thread_updated':
        // Invalidate relevant caches when threads are created/updated
        await this.baseCache.invalidateCache('matches:upcoming');
        break;
        
      case 'match_transition_check':
        // Clear caches to check for match state transitions (upcoming -> finished)
        console.log('🔄 Clearing caches to check for match state transitions...');
        await this.baseCache.invalidateCache('matches:upcoming');
        await this.baseCache.invalidateCache('matches:finished:10');
        await this.baseCache.invalidateCache('matches:finished:20');
        this.lastCacheTimes.delete('matches:upcoming');
        this.lastCacheTimes.delete('matches:finished:10');
        this.lastCacheTimes.delete('matches:finished:20');
        break;
        
      case 'force_refresh_all':
        // Force refresh everything
        await this.forceRefreshMatchData();
        break;
    }
    
    console.log(`✅ Cache invalidation completed for event: ${eventType}`);
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
    await this.baseCache.invalidateCache('team:data');
    await this.baseCache.invalidateCache('team:players');
    
    // Clear memory cache patterns
    await this.baseCache.invalidateCachePattern('matches:');
    await this.baseCache.invalidateCachePattern('team:');
    
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
