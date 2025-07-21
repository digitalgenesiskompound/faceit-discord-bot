const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
const http = require('http');

// Import configuration and services
const config = require('./config/config');
const DatabaseService = require('./services/databaseService');
const DiscordService = require('./services/discordService');
const NotificationService = require('./services/notificationService');
const BackupService = require('./services/backupService');
const faceitService = require('./services/faceitService');
const errorHandler = require('./utils/errorHandler');
const rateLimiter = require('./utils/rateLimiter');
const { circuitBreakerManager } = require('./utils/circuitBreaker');
const { performanceMonitor } = require('./utils/performanceMonitor');

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
    this.notificationService = new NotificationService(this.client, this.db);
    
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
        
        // Clear all caches on startup
        await this.clearCachesOnStartup();
        console.log('✅ Startup cache clearing completed');
        
        // Initialize notification service
        this.notificationService.initialize();
        console.log('✅ Notification service initialized');
        
        // Initialize backup service
        await this.backupService.initialize();
        console.log('✅ Backup service initialized');
        
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
          console.error('Error handling button interaction:', error);
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
   * Clear all caches on startup (equivalent to /clear-cache command)
   */
  async clearCachesOnStartup() {
    try {
      console.log('🔄 Clearing all caches on startup...');
      
      // Get cache sizes before clearing for logging
      const beforeStats = {
        processedMatches: this.db.processedMatches?.length || 0,
        userMappings: Object.keys(this.db.userMappings || {}).length,
        rsvpStatus: Object.keys(this.db.rsvpStatus || {}).length,
        matchThreads: this.db.matchThreads?.size || 0,
        upcomingMatches: this.db.upcomingMatches?.size || 0,
        userSearchResults: this.db.userSearchResults?.size || 0
      };
      
      // Clear all in-memory caches
      if (this.db.processedMatches) this.db.processedMatches = [];
      if (this.db.userMappings) this.db.userMappings = {};
      if (this.db.rsvpStatus) this.db.rsvpStatus = {};
      if (this.db.matchThreads) this.db.matchThreads = new Map();
      if (this.db.upcomingMatches) this.db.upcomingMatches = new Map();
      if (this.db.userSearchResults) this.db.userSearchResults = new Map();
      
      // Clear database caches (all entries, not just expired)
      const apiCacheCleared = await this.db.run('DELETE FROM api_cache');
      const matchesCacheCleared = await this.db.run('DELETE FROM matches_cache');
      const teamDataCacheCleared = await this.db.run('DELETE FROM team_data_cache');
      
      // Also clean up any remaining expired entries from other tables
      await this.db.cleanupExpiredApiCache();
      await this.db.cleanupExpiredCache();
      await this.db.cleanupExpiredTeamDataCache();
      
      console.log('💾 Memory cache cleared:', {
        processedMatches: beforeStats.processedMatches,
        userMappings: beforeStats.userMappings,
        rsvpStatus: beforeStats.rsvpStatus,
        matchThreads: beforeStats.matchThreads,
        upcomingMatches: beforeStats.upcomingMatches,
        userSearchResults: beforeStats.userSearchResults
      });
      
      console.log('🗃️ Database cache cleared:', {
        apiCache: apiCacheCleared.changes,
        matchesCache: matchesCacheCleared.changes,
        teamDataCache: teamDataCacheCleared.changes
      });
      
    } catch (error) {
      console.error('❌ Error clearing caches on startup:', error.message);
      // Don't throw - allow bot to continue even if cache clearing fails
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

    console.log('📅 Scheduled tasks configured:');
    console.log('   - Match check: Every 30 minutes');
    console.log('   - Data cleanup: Every 6 hours');
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
      
      // Notify about API failures if they persist
      if (error.circuitBreakerKey === 'faceit_api') {
        await this.notificationService.notifyApiFailure('FACEIT API', error, {
          operation: 'scheduled_match_check',
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  /**
   * Perform cleanup of old data with enhanced error handling
   */
  async performCleanup() {
    try {
      await this.db.db.cleanupOldData();
    } catch (error) {
      errorHandler.logger.error('Error during scheduled cleanup', {
        error: error.message,
        stack: error.stack,
        operation: error.operationName,
        retryCount: error.retryCount
      });
      
      // Notify about persistent database issues
      if (error.operationName) {
        await this.notificationService.notifyDatabaseFailure(
          'scheduled_cleanup',
          error,
          {
            timestamp: new Date().toISOString()
          }
        );
      }
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
          performance: performanceMonitor.getStats(),
          circuitBreakers: circuitBreakerManager.getAllStatus(),
          rateLimiter: rateLimiter.getStatus()
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(healthData, null, 2));
        return;
      }
      
      if (req.url === '/metrics') {
        const metrics = {
          performance: performanceMonitor.getStats(),
          circuitBreakers: circuitBreakerManager.getAllStatus(),
          rateLimiter: rateLimiter.getStatus(),
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
      
      console.log('🚦 Clearing rate limiter queues...');
      rateLimiter.clear();
      
      console.log('🔧 Resetting circuit breakers...');
      circuitBreakerManager.resetAll();
      
      console.log('🔐 Releasing database locks...');
      const { databaseLockManager } = require('./utils/databaseLock');
      databaseLockManager.releaseAllLocks();
      
      if (this.notificationService) {
        console.log('📢 Shutting down notification service...');
        this.notificationService.shutdown();
      }
      
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
