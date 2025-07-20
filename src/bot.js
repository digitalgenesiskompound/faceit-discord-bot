const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
const http = require('http');

// Import configuration and services
const config = require('./config/config');
const DatabaseService = require('./services/databaseService');
const DiscordService = require('./services/discordService');
const NotificationService = require('./services/notificationService');
const faceitService = require('./services/faceitService');
const errorHandler = require('./utils/errorHandler');

// Import handlers
const MessageHandler = require('./handlers/messageHandler');
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
    this.discordService = new DiscordService(this.client, this.db);
    this.notificationService = new NotificationService(this.client, this.db);
    
    // Initialize handlers
    this.messageHandler = new MessageHandler(this.client, this.db, this.discordService);
    this.buttonHandler = new ButtonHandler(this.client, this.db, this.discordService);

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
        // Initialize database
        await this.db.initialize();
        console.log('✅ Database service initialized');
        
        // Initialize notification service
        this.notificationService.initialize();
        console.log('✅ Notification service initialized');
        
        // Start scheduled tasks
        this.startScheduledTasks();
        console.log('✅ Scheduled tasks started');
        
        // Start health check server
        this.startHealthServer();
        console.log('✅ Health check server started');
        
        console.log('🚀 Bot is ready and monitoring for matches!');
        
        // Perform initial match check
        setTimeout(() => {
          this.performMatchCheck();
        }, 5000); // Wait 5 seconds after startup
        
      } catch (error) {
        console.error('❌ Error during bot initialization:', error);
      }
    });

    // Message event handler
    this.client.on('messageCreate', async (message) => {
      if (message.author.bot || !message.content.startsWith('!')) return;
      
      try {
        await this.messageHandler.handleMessage(message);
      } catch (error) {
        console.error('Error handling message:', error);
      }
    });

    // Button interaction handler
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isButton()) return;
      
      try {
        await this.buttonHandler.handleButtonInteraction(interaction);
      } catch (error) {
        console.error('Error handling button interaction:', error);
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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          status: 'ok', 
          discord_ready: this.client.isReady(),
          database_ready: this.db.isReady,
          uptime: process.uptime(),
          version: '2.0.0-modular'
        }));
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
      console.log(`📝 Version: 2.0.0-modular`);
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
      
      if (this.notificationService) {
        console.log('📢 Shutting down notification service...');
        this.notificationService.shutdown();
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
