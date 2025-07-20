const { EmbedBuilder } = require('discord.js');
const config = require('../config/config');
const errorHandler = require('../utils/errorHandler');

/**
 * Service for handling user notifications about system failures and health
 */
class NotificationService {
  constructor(client, databaseService) {
    this.client = client;
    this.db = databaseService;
    this.lastNotifications = new Map();
    this.notificationCooldowns = new Map();
    this.healthCheckInterval = null;
  }

  /**
   * Initialize notification service
   */
  initialize() {
    // Start periodic health checks and notifications
    this.startHealthMonitoring();
    errorHandler.logger.info('Notification service initialized');
  }

  /**
   * Start health monitoring with periodic notifications
   * DISABLED: Frequent health checks were causing API rate limiting
   */
  startHealthMonitoring() {
    // Health monitoring disabled to prevent API rate limiting
    // Only perform health checks when explicitly requested
    console.log('Health monitoring disabled to prevent API rate limiting');
    
    // Instead, we'll only do health checks every 2 hours to minimize API usage
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 2 * 60 * 60 * 1000); // Every 2 hours instead of 5 minutes

    errorHandler.logger.info('Health monitoring started (2 hour intervals)');
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck() {
    try {
      const healthStatus = {
        database: await this.checkDatabaseHealth(),
        faceitApi: await this.checkFaceitApiHealth(),
        discord: this.checkDiscordHealth(),
        circuitBreakers: errorHandler.getCircuitBreakerStatus(),
        retryStats: errorHandler.getRetryStats(),
        timestamp: new Date().toISOString()
      };

      // Log health metrics
      errorHandler.logHealthMetrics();

      // Check for critical issues
      await this.evaluateHealthStatus(healthStatus);

    } catch (error) {
      errorHandler.logger.error('Health check failed', { error: error.message, stack: error.stack });
    }
  }

  /**
   * Check database connectivity and health
   */
  async checkDatabaseHealth() {
    try {
      // Simple query to check database responsiveness
      await this.db.db.get('SELECT 1 as test');
      return {
        status: 'healthy',
        responseTime: Date.now(),
        lastCheck: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        lastCheck: new Date().toISOString()
      };
    }
  }

  /**
   * Check FACEIT API health by making a simple request
   */
  async checkFaceitApiHealth() {
    try {
      // Make a simple API request to check health
      const startTime = Date.now();
      await errorHandler.httpRequestWithRetry(
        () => require('axios').get(`https://open.faceit.com/data/v4/players/${config.faceit.teamId}`, {
          headers: { 'Authorization': `Bearer ${config.faceit.apiKey}` },
          timeout: 10000
        }),
        {
          maxRetries: 1,
          circuitBreakerKey: 'faceit_health_check',
          context: { operation: 'health_check' }
        }
      );
      
      return {
        status: 'healthy',
        responseTime: Date.now() - startTime,
        lastCheck: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        responseTime: null,
        lastCheck: new Date().toISOString()
      };
    }
  }

  /**
   * Check Discord client health
   */
  checkDiscordHealth() {
    return {
      status: this.client.isReady() ? 'healthy' : 'unhealthy',
      readyState: this.client.readyState,
      ping: this.client.ws.ping,
      lastCheck: new Date().toISOString()
    };
  }

  /**
   * Evaluate health status and send notifications if needed
   */
  async evaluateHealthStatus(healthStatus) {
    const criticalIssues = [];
    const warnings = [];

    // Check database health
    if (healthStatus.database.status === 'unhealthy') {
      criticalIssues.push({
        component: 'Database',
        issue: 'Database connectivity failed',
        details: healthStatus.database.error
      });
    }

    // Check FACEIT API health
    if (healthStatus.faceitApi.status === 'unhealthy') {
      warnings.push({
        component: 'FACEIT API',
        issue: 'API requests failing',
        details: healthStatus.faceitApi.error
      });
    }

    // Check Discord health
    if (healthStatus.discord.status === 'unhealthy') {
      criticalIssues.push({
        component: 'Discord',
        issue: 'Discord client not ready',
        details: `Ready state: ${healthStatus.discord.readyState}`
      });
    }

    // Check circuit breakers
    for (const [key, breaker] of Object.entries(healthStatus.circuitBreakers)) {
      if (breaker.state === 'OPEN') {
        warnings.push({
          component: `Circuit Breaker (${key})`,
          issue: 'Circuit breaker is open',
          details: `${breaker.consecutiveFailures} consecutive failures`
        });
      }
    }

    // Check retry statistics for high failure rates
    for (const [key, stats] of Object.entries(healthStatus.retryStats)) {
      if (stats.successRate < 0.8 && stats.totalRequests > 10) {
        warnings.push({
          component: `Retry Stats (${key})`,
          issue: 'High failure rate detected',
          details: `Success rate: ${(stats.successRate * 100).toFixed(1)}%`
        });
      }
    }

    // Send notifications if issues found
    if (criticalIssues.length > 0) {
      await this.sendSystemHealthNotification('critical', criticalIssues);
    }

    if (warnings.length > 0) {
      await this.sendSystemHealthNotification('warning', warnings);
    }
  }

  /**
   * Send system health notification
   */
  async sendSystemHealthNotification(severity, issues) {
    const notificationKey = `health_${severity}`;
    
    // Check cooldown to prevent spam
    if (this.isOnCooldown(notificationKey)) {
      return;
    }

    try {
      const embed = this.createHealthNotificationEmbed(severity, issues);
      const channel = this.client.channels.cache.get(config.discord.channelId);

      if (channel) {
        await channel.send({ embeds: [embed] });
        this.setCooldown(notificationKey, severity === 'critical' ? 30 * 60 * 1000 : 60 * 60 * 1000); // 30 min for critical, 1 hour for warnings
        
        errorHandler.logger.warn(`Sent ${severity} health notification`, { 
          issueCount: issues.length,
          issues: issues.map(i => `${i.component}: ${i.issue}`)
        });
      }
    } catch (error) {
      errorHandler.logger.error('Failed to send health notification', { 
        error: error.message,
        severity,
        issueCount: issues.length
      });
    }
  }

  /**
   * Create health notification embed
   */
  createHealthNotificationEmbed(severity, issues) {
    const embed = new EmbedBuilder()
      .setTimestamp();

    if (severity === 'critical') {
      embed
        .setTitle('🚨 Critical System Issues Detected')
        .setDescription('The bot has detected critical issues that may affect functionality. Please check the system immediately.')
        .setColor(0xff0000); // Red
    } else {
      embed
        .setTitle('⚠️ System Health Warning')
        .setDescription('The bot has detected some issues that may impact performance.')
        .setColor(0xffa500); // Orange
    }

    // Add each issue as a field
    issues.forEach((issue, index) => {
      embed.addFields({
        name: `${issue.component}`,
        value: `**Issue:** ${issue.issue}\n**Details:** ${issue.details}`,
        inline: false
      });
    });

    embed.addFields({
      name: 'Recommended Actions',
      value: severity === 'critical' 
        ? '• Check bot logs immediately\n• Verify database connectivity\n• Restart bot if necessary\n• Check Discord connection'
        : '• Monitor system performance\n• Check logs for detailed information\n• Consider restarting if issues persist',
      inline: false
    });

    return embed;
  }

  /**
   * Send API failure notification after multiple retries
   */
  async notifyApiFailure(apiName, error, context = {}) {
    const notificationKey = `api_failure_${apiName}`;
    
    // Check cooldown
    if (this.isOnCooldown(notificationKey)) {
      return;
    }

    try {
      const embed = new EmbedBuilder()
        .setTitle('🔌 API Connection Issue')
        .setDescription(`The ${apiName} API is experiencing connectivity issues after multiple retry attempts.`)
        .setColor(0xff6b00) // Orange
        .addFields(
          {
            name: 'Service',
            value: apiName,
            inline: true
          },
          {
            name: 'Last Error',
            value: error.message.substring(0, 1000),
            inline: false
          },
          {
            name: 'Retry Count',
            value: error.retryCount?.toString() || 'Unknown',
            inline: true
          },
          {
            name: 'Status',
            value: 'Automatic retries will continue. Manual intervention may be needed if issues persist.',
            inline: false
          }
        )
        .setTimestamp();

      const channel = this.client.channels.cache.get(config.discord.channelId);
      if (channel) {
        await channel.send({ embeds: [embed] });
        this.setCooldown(notificationKey, 45 * 60 * 1000); // 45 minutes cooldown
        
        errorHandler.logger.warn('Sent API failure notification', { 
          apiName,
          error: error.message,
          context
        });
      }
    } catch (notificationError) {
      errorHandler.logger.error('Failed to send API failure notification', { 
        apiName,
        error: notificationError.message
      });
    }
  }

  /**
   * Send database failure notification
   */
  async notifyDatabaseFailure(operation, error, context = {}) {
    const notificationKey = `db_failure_${operation}`;
    
    // Check cooldown
    if (this.isOnCooldown(notificationKey)) {
      return;
    }

    try {
      const embed = new EmbedBuilder()
        .setTitle('💾 Database Operation Failed')
        .setDescription(`A database operation has failed after multiple retry attempts. This may affect bot functionality.`)
        .setColor(0xff0000) // Red
        .addFields(
          {
            name: 'Operation',
            value: operation,
            inline: true
          },
          {
            name: 'Error Details',
            value: error.message.substring(0, 1000),
            inline: false
          },
          {
            name: 'Retry Count',
            value: error.retryCount?.toString() || 'Unknown',
            inline: true
          },
          {
            name: 'Impact',
            value: 'Some bot features may be temporarily unavailable. The bot will continue to retry automatically.',
            inline: false
          }
        )
        .setTimestamp();

      const channel = this.client.channels.cache.get(config.discord.channelId);
      if (channel) {
        await channel.send({ embeds: [embed] });
        this.setCooldown(notificationKey, 30 * 60 * 1000); // 30 minutes cooldown
        
        errorHandler.logger.error('Sent database failure notification', { 
          operation,
          error: error.message,
          context
        });
      }
    } catch (notificationError) {
      errorHandler.logger.error('Failed to send database failure notification', { 
        operation,
        error: notificationError.message
      });
    }
  }

  /**
   * Check if a notification type is on cooldown
   */
  isOnCooldown(key) {
    const cooldown = this.notificationCooldowns.get(key);
    if (!cooldown) return false;
    
    return Date.now() < cooldown;
  }

  /**
   * Set cooldown for a notification type
   */
  setCooldown(key, duration) {
    this.notificationCooldowns.set(key, Date.now() + duration);
  }

  /**
   * Send recovery notification when systems recover
   */
  async notifySystemRecovery(component, details = {}) {
    try {
      const embed = new EmbedBuilder()
        .setTitle('✅ System Recovery')
        .setDescription(`The ${component} has recovered and is now functioning normally.`)
        .setColor(0x00ff00) // Green
        .addFields({
          name: 'Component',
          value: component,
          inline: true
        })
        .setTimestamp();

      if (details.downtime) {
        embed.addFields({
          name: 'Downtime',
          value: details.downtime,
          inline: true
        });
      }

      const channel = this.client.channels.cache.get(config.discord.channelId);
      if (channel) {
        await channel.send({ embeds: [embed] });
        
        errorHandler.logger.info('Sent system recovery notification', { 
          component,
          details
        });
      }
    } catch (error) {
      errorHandler.logger.error('Failed to send recovery notification', { 
        component,
        error: error.message
      });
    }
  }

  /**
   * Cleanup notification service
   */
  shutdown() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    errorHandler.logger.info('Notification service shutdown');
  }
}

module.exports = NotificationService;
