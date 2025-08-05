/**
 * Player Data Refresh Service
 * 
 * Manages periodic updates of player data from FACEIT API to keep the database fresh.
 * This service helps prevent stale data issues in the /team command and other features.
 */

class PlayerDataRefreshService {
  constructor(databaseService, faceitService) {
    this.db = databaseService;
    this.faceitService = faceitService;
    this.isRunning = false;
    this.refreshInterval = null;
    this.refreshIntervalMs = 6 * 60 * 60 * 1000; // 6 hours
    this.lastRefreshTime = null;
    this.stats = {
      totalRefreshes: 0,
      playersRefreshed: 0,
      errors: 0,
      lastError: null
    };
  }

  /**
   * Start the background refresh service
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ Player data refresh service is already running');
      return;
    }

    console.log('🔄 Starting player data refresh service...');
    this.isRunning = true;

    // Run initial refresh after a short delay
    setTimeout(() => this.performRefresh(), 30000); // 30 seconds

    // Set up periodic refresh
    this.refreshInterval = setInterval(() => {
      this.performRefresh();
    }, this.refreshIntervalMs);

    console.log(`✅ Player data refresh service started (refreshes every ${this.refreshIntervalMs / 1000 / 60 / 60} hours)`);
  }

  /**
   * Stop the background refresh service
   */
  stop() {
    if (!this.isRunning) {
      console.log('⚠️ Player data refresh service is not running');
      return;
    }

    console.log('🛑 Stopping player data refresh service...');
    this.isRunning = false;

    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    console.log('✅ Player data refresh service stopped');
  }

  /**
   * Perform a refresh of all player data
   */
  async performRefresh() {
    if (!this.isRunning) {
      return;
    }

    console.log('🔄 Starting periodic player data refresh...');
    const startTime = Date.now();

    try {
      // Get all user mappings that need refreshing
      const userMappings = await this.db.getAllUserMappings();
      
      if (userMappings.length === 0) {
        console.log('📊 No user mappings found - skipping refresh');
        return;
      }

      // Filter mappings that need refreshing (stale or incomplete data)
      const mappingsToRefresh = this.filterMappingsForRefresh(userMappings);
      
      if (mappingsToRefresh.length === 0) {
        console.log(`📊 All ${userMappings.length} player mappings are up to date - skipping refresh`);
        return;
      }

      console.log(`📊 Refreshing ${mappingsToRefresh.length} of ${userMappings.length} player mappings`);

      let refreshedCount = 0;
      let errorCount = 0;

      // Refresh each mapping with rate limiting
      for (let i = 0; i < mappingsToRefresh.length; i++) {
        const mapping = mappingsToRefresh[i];

        try {
          console.log(`🔄 [${i + 1}/${mappingsToRefresh.length}] Refreshing ${mapping.faceit_nickname}...`);

          // Fetch fresh data from FACEIT API
          const freshData = await this.faceitService.getPlayerByNickname(mapping.faceit_nickname);

          if (freshData) {
            // Extract game stats (prefer CS2, fallback to CS:GO)
            const cs2Stats = freshData.games?.cs2;
            const csgoStats = freshData.games?.csgo;
            const gameStats = cs2Stats || csgoStats;

            if (gameStats) {
              // Update database with fresh data
              await this.db.updateUserMappingStats(mapping.discord_id, {
                faceit_skill_level: gameStats.skill_level || 'Unknown',
                faceit_elo: gameStats.faceit_elo || 'Unknown',
                country: freshData.country || 'Unknown'
              });

              refreshedCount++;
              console.log(`✅ Refreshed ${mapping.faceit_nickname}: Level ${gameStats.skill_level}, ${gameStats.faceit_elo} ELO`);
            } else {
              console.log(`⚠️ No game stats found for ${mapping.faceit_nickname}`);
            }
          } else {
            console.log(`❌ Could not fetch data for ${mapping.faceit_nickname}`);
            errorCount++;
          }

          // Rate limiting: delay between API calls to respect FACEIT rate limits
          if (i < mappingsToRefresh.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
          }

        } catch (error) {
          console.error(`❌ Error refreshing ${mapping.faceit_nickname}: ${error.message}`);
          errorCount++;
          this.stats.lastError = error.message;
        }
      }

      // Update stats
      this.stats.totalRefreshes++;
      this.stats.playersRefreshed += refreshedCount;
      this.stats.errors += errorCount;
      this.lastRefreshTime = Date.now();

      const duration = Date.now() - startTime;
      console.log(`✅ Player data refresh completed: ${refreshedCount} refreshed, ${errorCount} errors, ${duration}ms duration`);

    } catch (error) {
      console.error(`❌ Error during player data refresh: ${error.message}`);
      this.stats.errors++;
      this.stats.lastError = error.message;
    }
  }

  /**
   * Filter user mappings to find ones that need refreshing
   */
  filterMappingsForRefresh(userMappings) {
    const now = Date.now();
    const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours
    const mappingsToRefresh = [];

    for (const mapping of userMappings) {
      let needsRefresh = false;

      // Check if data is stale (older than 24 hours)
      const updatedAt = mapping.updated_at ? new Date(mapping.updated_at).getTime() : 0;
      if (now - updatedAt > staleThreshold) {
        needsRefresh = true;
      }

      // Check if data is incomplete
      if (!mapping.faceit_skill_level || 
          mapping.faceit_skill_level === 'N/A' || 
          mapping.faceit_skill_level === 'Unknown' ||
          !mapping.faceit_elo || 
          mapping.faceit_elo === 'N/A' || 
          mapping.faceit_elo === 'Unknown') {
        needsRefresh = true;
      }

      if (needsRefresh) {
        mappingsToRefresh.push(mapping);
      }
    }

    return mappingsToRefresh;
  }

  /**
   * Manually trigger a refresh (for admin commands or testing)
   */
  async manualRefresh() {
    console.log('🔄 Manual player data refresh triggered...');
    await this.performRefresh();
  }

  /**
   * Get service status and statistics
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      refreshInterval: this.refreshIntervalMs,
      lastRefreshTime: this.lastRefreshTime,
      nextRefreshTime: this.lastRefreshTime ? this.lastRefreshTime + this.refreshIntervalMs : null,
      stats: {
        ...this.stats
      }
    };
  }

  /**
   * Update refresh interval (requires restart to take effect)
   */
  setRefreshInterval(intervalMs) {
    this.refreshIntervalMs = intervalMs;
    console.log(`🔄 Player data refresh interval updated to ${intervalMs / 1000 / 60 / 60} hours`);
    
    if (this.isRunning) {
      console.log('⚠️ Restart the service for the new interval to take effect');
    }
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalRefreshes: 0,
      playersRefreshed: 0,
      errors: 0,
      lastError: null
    };
    console.log('📊 Player data refresh statistics reset');
  }
}

module.exports = PlayerDataRefreshService;
