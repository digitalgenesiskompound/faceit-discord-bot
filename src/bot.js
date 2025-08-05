const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
const http = require('http');

// Import configuration and services
const config = require('./config/config');
const DatabaseService = require('./services/databaseService');
const DiscordService = require('./services/discordService');
const BackupService = require('./services/backupService');
const RecoveryService = require('./services/recoveryService');
const faceitService = require('./services/faceitService');
const errorHandler = require('./utils/errorHandler');

// Import handlers
const ButtonHandler = require('./handlers/buttonHandler');

class FaceitBot {
  constructor() {
    // Initialize Discord client
    this.client = new Client({ 
      intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
      ] 
    });

    // Initialize services
    this.db = new DatabaseService();
    this.backupService = new BackupService();
    this.discordService = new DiscordService(this.client, this.db);
    
    // Initialize handlers
    this.slashCommandHandler = new (require('./handlers/slashCommandHandler'))(this.client, this.db, this.discordService, this.backupService);
    this.buttonHandler = new ButtonHandler(this.client, this.db, this.discordService, this.slashCommandHandler);

    // Setup event handlers
    this.setupEventHandlers();
  }

  /**
   * Setup Discord client event handlers
   */
  setupEventHandlers() {
    // Bot ready event
    this.client.once('ready', async () => {
      console.log(`✅ Logged in as ${this.client.user.tag}!`);
      console.log(`🔄 Initializing bot services...`);
      
      try {
        // Check for backup restoration before initializing database
        await this.checkAndRestoreBackup();
        
        // Initialize database
        await this.db.initialize();
        console.log('✅ Database service initialized');
        
        // Run recovery system if needed
        await this.runRecoveryIfNeeded();
        
        // Clear all caches on startup
        await this.clearCachesOnStartup();
        console.log('✅ Startup cache clearing completed');
        
        // Services initialized successfully
        
        // Initialize backup service (non-blocking)
        try {
          await this.backupService.initialize();
          console.log('✅ Backup service initialized');
        } catch (error) {
          console.error('❌ Failed to initialize backup service:', error.message);
          console.log('⚠️ Bot will continue without backup functionality. Rebuild Docker image to fix backup permissions.');
          // Don't throw error - let bot continue without backups
        }
        
        // Start scheduled tasks
        this.startScheduledTasks();
        console.log('✅ Scheduled tasks started');
        
        // Start health check server
        this.startHealthServer();
        console.log('✅ Health check server started');
        
        // Register slash commands
        await this.slashCommandHandler.registerSlashCommands();
        console.log('✅ Slash commands registered');
        
        console.log('🚀 Bot is ready and monitoring for matches!');
        
        // Perform initial match check
        setTimeout(() => {
          this.performMatchCheck();
        }, 5000); // Wait 5 seconds after startup
        
      } catch (error) {
        console.error('❌ Error during bot initialization:', error);
      }
    });

    // Message event handler - Disabled (all commands are now slash commands)
    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      // No longer handling prefix commands
    });

    // Interaction handler
    this.client.on('interactionCreate', async (interaction) => {
      console.log(`📥 Interaction received: Type=${interaction.type}, User=${interaction.user.tag}`);
      
      if (interaction.isButton()) {
        console.log(`🔘 Button interaction: ${interaction.customId}`);
        try {
          await this.buttonHandler.handleButtonInteraction(interaction);
        } catch (error) {
          console.error('❌ Error handling button interaction:', error);
          console.error('Stack trace:', error.stack);
        }
      } else if (interaction.isCommand()) {
        console.log(`⚡ Slash command interaction: /${interaction.commandName}`);
        try {
          await this.slashCommandHandler.handleSlashCommand(interaction);
        } catch (error) {
          console.error('Error handling slash command interaction:', error);
        }
      } else {
        console.log(`❓ Unknown interaction type: ${interaction.type}`);
      }
    });

    // Error handling
    this.client.on('error', (error) => {
      console.error('Discord client error:', error);
    });

    this.client.on('warn', (warning) => {
      console.warn('Discord client warning:', warning);
    });

    // Graceful shutdown handlers
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down...');
      this.shutdown();
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down...');
      this.shutdown();
    });

    // Handle uncaught exceptions and unhandled promise rejections
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error.message);
      console.error(error.stack);
      // Don't exit immediately, log the error but keep the bot running
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise);
      console.error('Reason:', reason);
      // Don't exit immediately, log the error but keep the bot running
    });
  }

  /**
   * Perform conservative thread validation on startup
   * Only removes threads that are definitively invalid to prevent data loss
   */
  async performStartupThreadValidation() {
    try {
      console.log('🔍 Starting conservative thread validation on startup...');
      
      const loadedThreads = this.db.matchThreads.size;
      console.log(`📊 Validating ${loadedThreads} reloaded thread references`);
      
      let validatedCount = 0;
      let removedCount = 0;
      let retainedCount = 0;
      
      // Create array from Map to avoid modification during iteration
      const threadEntries = Array.from(this.db.matchThreads.entries());
      
      for (const [matchId, threadId] of threadEntries) {
        try {
          const validationResult = await this.discordService.validateThread(matchId, threadId);
          validatedCount++;
          
          if (!validationResult.isValid && validationResult.shouldRemove) {
            console.warn(`⚠️ [STARTUP VALIDATION] Removing invalid thread reference: ${matchId} -> ${threadId}`);
            console.warn(`   Reason: ${validationResult.reason}`);
            await this.db.removeMatchThread(matchId);
            removedCount++;
          } else if (!validationResult.isValid) {
            console.log(`ℹ️ [STARTUP VALIDATION] Retaining questionable thread reference: ${matchId} -> ${threadId}`);
            console.log(`   Reason: ${validationResult.reason}`);
            retainedCount++;
          } else {
            console.log(`✅ [STARTUP VALIDATION] Thread reference validated: ${matchId} -> ${threadId}`);
          }
          
          // Proceed immediately for faster startup validation
          
        } catch (validationError) {
          console.error(`❌ [STARTUP VALIDATION] Error validating thread ${threadId}: ${validationError.message}`);
          // Conservative approach: retain thread on validation error
          retainedCount++;
        }
      }
      
      console.log('✅ Conservative thread validation completed:');
      console.log(`   - Total validated: ${validatedCount}`);
      console.log(`   - Removed (invalid): ${removedCount}`);
      console.log(`   - Retained (uncertain): ${retainedCount}`);
      console.log(`   - Final thread count: ${this.db.matchThreads.size}`);
      
    } catch (error) {
      console.error('❌ Error during startup thread validation:', error.message);
      // Continue startup even if validation fails
    }
  }
  
  /**
   * Conservative cache management on startup - only clear volatile caches, preserve critical data
   */
  async clearCachesOnStartup() {
    try {
      console.log('🔄 Running startup cache management...');
      
      // Get cache sizes before clearing for logging
      const beforeStats = {
        processedMatches: this.db.processedMatches?.length || 0,
        userMappings: Object.keys(this.db.userMappings || {}).length,
        rsvpStatus: Object.keys(this.db.rsvpStatus || {}).length,
        matchThreads: this.db.matchThreads?.size || 0,
        upcomingMatches: this.db.upcomingMatches?.size || 0,
        userSearchResults: this.db.userSearchResults?.size || 0
      };
      
      // Only clear volatile in-memory caches that should be refreshed
      // DO NOT clear userMappings or rsvpStatus - these are critical for functionality
      if (this.db.upcomingMatches) this.db.upcomingMatches = new Map();
      if (this.db.userSearchResults) this.db.userSearchResults = new Map();
      
      // Clear match threads temporarily and reload from database to ensure consistency
      if (this.db.matchThreads) this.db.matchThreads = new Map();
await this.db.reloadMatchThreads();
    
    // Perform conservative thread validation on startup
    await this.performStartupThreadValidation();
      
      // Only clean up expired entries from database caches, don't delete everything
      await this.db.cleanupExpiredApiCache();
      await this.db.cleanupExpiredCache();
      await this.db.cleanupExpiredTeamDataCache();
      
      console.log('💾 Conservative cache management completed:', {
        beforeStats,
        clearedVolatile: {
          upcomingMatches: beforeStats.upcomingMatches,
          userSearchResults: beforeStats.userSearchResults
        },
        preserved: {
          userMappings: Object.keys(this.db.userMappings || {}).length,
          rsvpStatus: Object.keys(this.db.rsvpStatus || {}).length,
          processedMatches: this.db.processedMatches?.length || 0
        },
        reloaded: {
          matchThreads: this.db.matchThreads?.size || 0
        }
      });
      
    } catch (error) {
      console.error('❌ Error during startup cache management:', error.message);
      // Don't throw - allow bot to continue even if cache management fails
    }
  }
  
  /**
   * Run recovery system if needed (checks for missing/incomplete data)
   */
  async runRecoveryIfNeeded() {
    try {
      console.log('🔍 Checking if recovery is needed...');
      
      // Initialize recovery service
      const recoveryService = new RecoveryService(this.db, this.discordService);
      
      // Check if recovery is needed by examining database state
      const needsRecovery = await this.assessRecoveryNeeds();
      
      if (needsRecovery.required) {
        console.log('🔄 Recovery needed, running recovery system...');
        console.log(`   Reasons: ${needsRecovery.reasons.join(', ')}`);
        
        // Run recovery process
        const recoveryResults = await recoveryService.performComprehensiveRecovery();
        
        console.log('✅ Recovery completed:', {
          userMappings: recoveryResults.userMappings,
          rsvpData: recoveryResults.rsvpData,
          interactionLogs: recoveryResults.interactionLogs
        });
        
      } else {
        console.log('✅ No recovery needed - database appears healthy');
      }
      
    } catch (error) {
      console.error('❌ Error during recovery assessment/execution:', error.message);
      console.log('⚠️ Bot will continue without recovery. Check logs for details.');
      // Don't throw - let bot continue even if recovery fails
    }
  }
  
  /**
   * Assess whether recovery is needed based on database state
   */
  async assessRecoveryNeeds() {
    const reasons = [];
    
    try {
      // Check user mappings
      const userMappingCount = Object.keys(this.db.userMappings || {}).length;
      if (userMappingCount === 0) {
        reasons.push('No user mappings found');
      }
      
      // Check recent RSVP data
      const rsvpCount = Object.keys(this.db.rsvpStatus || {}).length;
      if (rsvpCount === 0) {
        reasons.push('No RSVP data found');
      }
      
      // Check if environment variable forces recovery
      if (process.env.FORCE_RECOVERY === 'true') {
        reasons.push('Forced recovery via environment variable');
      }
      
      return {
        required: reasons.length > 0,
        reasons
      };
      
    } catch (error) {
      console.error('Error assessing recovery needs:', error.message);
      return {
        required: false,
        reasons: ['Error during assessment']
      };
    }
  }

  /**
   * Check for backup restoration before starting the bot
   */
  async checkAndRestoreBackup() {
    const fs = require('fs').promises;
    const path = require('path');
    
    const restoreOnStart = process.env.RESTORE_BACKUP_ON_START === 'true';
    const restoreBackupFile = process.env.RESTORE_BACKUP_FILE;
    
    if (!restoreOnStart) {
      console.log('💾 No backup restoration requested');
      return;
    }
    
    if (!restoreBackupFile) {
      console.log('⚠️ RESTORE_BACKUP_ON_START=true but no RESTORE_BACKUP_FILE specified');
      return;
    }
    
    try {
      console.log(`🔄 Attempting to restore backup: ${restoreBackupFile}`);
      
      // Determine backup file path
      let backupPath;
      if (path.isAbsolute(restoreBackupFile)) {
        backupPath = restoreBackupFile;
      } else {
        // Assume it's relative to backup directory
        backupPath = path.join(this.backupService.backupDir, restoreBackupFile);
      }
      
      // Check if backup file exists
      try {
        await fs.access(backupPath);
      } catch (error) {
        console.error(`❌ Backup file not found: ${backupPath}`);
        return;
      }
      
      // Restore the backup without creating a pre-restore backup
      // (since we're doing this at startup)
      await this.backupService.restoreFromBackup(backupPath, false);
      
        console.log('✅ Database restored successfully from backup');
        console.log('🔄 Clearing restoration environment variables...');
        
        // Log the restoration as a safe data recovery action
        console.log('📊 [SAFE RESTORATION] Backup restoration completed successfully');
        console.log(`   - Source: ${restoreBackupFile}`);
        console.log(`   - Action: Database restored from backup at startup`);
        console.log(`   - Reason: Environment variable RESTORE_BACKUP_ON_START=true`);
        console.log(`   - Impact: All database data replaced with backup content`);
        
        // Clear the environment variables to prevent repeated restoration
        delete process.env.RESTORE_BACKUP_ON_START;
        delete process.env.RESTORE_BACKUP_FILE;
      
    } catch (error) {
      console.error(`❌ Failed to restore backup: ${error.message}`);
      console.error('Bot will continue with existing database');
    }
  }
  
  /**
   * Start scheduled tasks using cron
   */
  startScheduledTasks() {
    // Schedule match checking every 30 minutes
    cron.schedule('*/30 * * * *', () => {
      console.log('🔄 Running scheduled match check...');
      if (this.client.isReady()) {
        this.performMatchCheck();
      } else {
        console.log('Discord client not ready, skipping check');
      }
    });

    // Schedule cleanup every 6 hours to remove old data
    cron.schedule('0 */6 * * *', () => {
      console.log('🧹 Running scheduled cleanup...');
      if (this.client.isReady()) {
        this.performCleanup();
      } else {
        console.log('Discord client not ready, skipping cleanup');
      }
    });
    
    // Schedule cache verification every 2 hours to ensure consistency
    cron.schedule('0 */2 * * *', () => {
      console.log('🔍 Running periodic cache verification...');
      if (this.client.isReady()) {
        this.performCacheVerification();
      } else {
        console.log('Discord client not ready, skipping cache verification');
      }
    });

    console.log('📅 Scheduled tasks configured:');
    console.log('   - Match check: Every 30 minutes');
    console.log('   - Data cleanup: Every 6 hours');
    console.log('   - Cache verification: Every 2 hours');
  }

  /**
   * Perform match check with enhanced error handling
   */
  async performMatchCheck() {
    try {
      await this.discordService.checkMatches(faceitService);
    } catch (error) {
      errorHandler.logger.error('Error during scheduled match check', {
        error: error.message,
        stack: error.stack,
        retryCount: error.retryCount
      });
      
      // Log API failures
      console.error('API failure during match check:', error.message);
    }
  }

  /**
   * Perform cleanup of old data with enhanced error handling
   */
  async performCleanup() {
    try {
      await this.db.db.cleanupOldData();
      await this.db.cleanupOldRsvpData();
      await this.db.cleanupExpiredApiCache();
      await this.db.cleanupExpiredCache();
      await this.db.cleanupExpiredTeamDataCache();
    } catch (error) {
      errorHandler.logger.error('Error during scheduled cleanup', {
        error: error.message,
        stack: error.stack,
        operation: error.operationName,
        retryCount: error.retryCount
      });
      
      // Log database issues
      console.error('Database failure during cleanup:', error.message);
    }
  }
  
  /**
   * Perform periodic cache verification and synchronization
   */
  async performCacheVerification() {
    try {
      console.log('🔍 Starting periodic cache verification...');
      
      // 1. Verify thread consistency between database and Discord
      const threadConsistencyResults = await this.discordService.reconcileExistingThreads();
      
      // 2. Check RSVP synchronization
      const rsvpSyncResults = await this.discordService.refreshAllRsvpStatuses(true);
      
      // 3. Verify cache health and performance
      const cache = require('./services/cache');
      const cacheStats = cache.getStats();
      
      console.log('📊 Cache verification completed:', {
        rsvpSync: {
          processed: rsvpSyncResults.processed,
          updated: rsvpSyncResults.updated,
          errors: rsvpSyncResults.errors
        },
        cacheStats: {
          hits: cacheStats.hits,
          misses: cacheStats.misses,
          hitRate: cacheStats.hitRate,
          memorySize: cacheStats.memorySize
        }
      });
      
      // 4. Log verification metrics
      errorHandler.logger.info('Periodic cache verification completed', {
        rsvpUpdates: rsvpSyncResults.updated,
        rsvpErrors: rsvpSyncResults.errors,
        cacheHitRate: cacheStats.hitRate,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      errorHandler.logger.error('Error during cache verification', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Start health check server
   */
  startHealthServer() {
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        const healthData = {
          status: 'ok',
          timestamp: new Date().toISOString(),
          discord_ready: this.client.isReady(),
          database_ready: this.db.isReady,
          uptime: process.uptime(),
          version: '3.0.0-slash-commands-enhanced',
          // Basic health metrics
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(healthData, null, 2));
        return;
      }
      
      if (req.url === '/metrics') {
        const metrics = {
          memory: process.memoryUsage(),
          timestamp: new Date().toISOString()
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(metrics, null, 2));
        return;
      }
      
      res.writeHead(404);
      res.end();
    });

    server.listen(config.server.port, () => {
      console.log(`🏥 Health check server running on port ${config.server.port}`);
    });

    // Store server reference for shutdown
    this.healthServer = server;
  }

  /**
   * Start the bot
   */
  async start() {
    try {
      console.log('🔄 Starting FACEIT Discord Bot...');
      console.log(`📝 Version: 3.0.0-slash-commands`);
      console.log(`🎮 Game: Counter-Strike 2`);
      console.log(`🎯 Team ID: ${config.faceit.teamId}`);
      console.log(`📡 Channel: ${config.discord.channelId}`);
      
      await this.client.login(config.discord.botToken);
    } catch (error) {
      console.error('❌ Failed to start bot:', error);
      process.exit(1);
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('📴 Shutting down bot...');
    
    try {
      if (this.client && this.client.user) {
        console.log('👋 Logging out from Discord...');
        await this.client.destroy();
      }
      
      if (this.healthServer) {
        console.log('🏥 Closing health check server...');
        this.healthServer.close();
      }
      
      // Simplified shutdown process
      
      if (this.backupService) {
        console.log('💾 Shutting down backup service...');
        this.backupService.shutdown();
      }
      
      console.log('✅ Bot shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Create and start the bot
const bot = new FaceitBot();

// Start the bot
bot.start().catch(error => {
  console.error('❌ Fatal error starting bot:', error);
  process.exit(1);
});

module.exports = FaceitBot;
