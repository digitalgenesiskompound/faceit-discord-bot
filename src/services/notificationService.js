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
      // Make a simple API request to check health using the team endpoint
      const startTime = Date.now();
      await errorHandler.httpRequestWithRetry(
        () => require('axios').get(`https://open.faceit.com/data/v4/teams/${config.faceit.teamId}`, {
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
const adminUser = await this.client.users.fetch(config.adminDiscordId);

if (adminUser) {
  await adminUser.send({ embeds: [embed] });
  this.setCooldown(notificationKey, 30 * 60 * 1000); // 30 min for critical or warning

  errorHandler.logger.warn(`Sent ${severity} health notification via DM to admin`, { 
    issueCount: issues.length,
    issues: issues.map(i => `${i.component}: ${i.issue}`)
  });
} else {
  errorHandler.logger.error('Failed to send health notification via DM (admin not found)', {
    severity,
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
   * Create enhanced health notification embed with comprehensive diagnostics for admin DMs
   */
  createHealthNotificationEmbed(severity, issues) {
    const embed = new EmbedBuilder()
      .setTimestamp();

    if (severity === 'critical') {
      embed
        .setTitle('🚨 Critical System Issue')
        .setDescription(`Bot has critical issues affecting functionality. Immediate attention required.`)
        .setColor(0xff0000); // Red
    } else {
      embed
        .setTitle('⚠️ System Warning')
        .setDescription(`Bot detected issues that may impact performance. Monitoring recommended.`)
        .setColor(0xffa500); // Orange
    }

    // Add each issue with comprehensive diagnostic information
    issues.forEach((issue, index) => {
      let diagnosticInfo = `**Issue:** ${issue.issue}\n`;
      
      // Add HTTP status code if available
      if (issue.httpStatus) {
        diagnosticInfo += `**HTTP Status:** ${issue.httpStatus}\n`;
      }
      
      // Add API URL if available
      if (issue.apiUrl) {
        diagnosticInfo += `**API URL:** \`${issue.apiUrl}\`\n`;
      }
      
      // Add response body/text if available
      if (issue.responseBody) {
        const responsePreview = issue.responseBody.length > 150 
          ? issue.responseBody.substring(0, 150) + '...'
          : issue.responseBody;
        diagnosticInfo += `**Response:** \`${responsePreview}\`\n`;
      }
      
      // Add error details
      if (issue.details) {
        const errorPreview = issue.details.length > 200 
          ? issue.details.substring(0, 200) + '...'
          : issue.details;
        diagnosticInfo += `**Error:** ${errorPreview}\n`;
      }
      
      // Add context information if available
      if (issue.context) {
        const contextInfo = typeof issue.context === 'object' 
          ? JSON.stringify(issue.context, null, 0).substring(0, 100)
          : issue.context.toString().substring(0, 100);
        diagnosticInfo += `**Context:** \`${contextInfo}\`\n`;
      }
      
      // Add retry information if available
      if (issue.retryCount !== undefined) {
        diagnosticInfo += `**Retry Count:** ${issue.retryCount}\n`;
      }
      
      // Add timestamp of the issue
      if (issue.timestamp) {
        diagnosticInfo += `**Occurred:** ${new Date(issue.timestamp).toLocaleString()}\n`;
      }
      
      embed.addFields({
        name: `${issue.component} ${index + 1}`,
        value: diagnosticInfo.trim(),
        inline: false
      });
    });

    // Add comprehensive system diagnostics
    const memUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const memTotal = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const uptime = Math.floor(process.uptime() / 60);
    const nodeVersion = process.version;
    const platform = process.platform;
    
    let systemDiagnostics = `**Memory Usage:** ${memUsage}MB / ${memTotal}MB RSS\n`;
    systemDiagnostics += `**Uptime:** ${uptime} minutes\n`;
    systemDiagnostics += `**Node.js:** ${nodeVersion}\n`;
    systemDiagnostics += `**Platform:** ${platform}\n`;
    systemDiagnostics += `**Bot Status:** ${this.client.isReady() ? 'Connected' : 'Disconnected'}\n`;
    systemDiagnostics += `**Discord WS Ping:** ${this.client.ws.ping}ms\n`;
    systemDiagnostics += `**Process ID:** ${process.pid}\n`;
    systemDiagnostics += `**Timestamp:** ${new Date().toISOString()}`;
    
    embed.addFields({
      name: '🔧 System Diagnostics',
      value: systemDiagnostics,
      inline: false
    });

    // Add circuit breaker status if available
    const circuitBreakers = errorHandler.getCircuitBreakerStatus();
    if (Object.keys(circuitBreakers).length > 0) {
      let cbStatus = '';
      for (const [key, breaker] of Object.entries(circuitBreakers)) {
        cbStatus += `**${key}:** ${breaker.state} (${breaker.consecutiveFailures} failures)\n`;
      }
      
      embed.addFields({
        name: '🔌 Circuit Breakers',
        value: cbStatus.trim() || 'All circuit breakers healthy',
        inline: false
      });
    }

    return embed;
  }

  /**
   * Send comprehensive API failure notification with full diagnostic details
   */
  async notifyApiFailure(apiName, error, context = {}) {
    const notificationKey = `api_failure_${apiName}`;
    
    // Check cooldown
    if (this.isOnCooldown(notificationKey)) {
      return;
    }

    try {
      // Enhanced diagnostic information gathering
      const diagnostics = {
        timestamp: new Date().toISOString(),
        apiName,
        retryCount: error.retryCount || 'unknown',
        httpStatus: error.response?.status || error.status || 'N/A',
        httpStatusText: error.response?.statusText || error.statusText || 'N/A',
        apiUrl: error.config?.url || context.url || 'N/A',
        method: error.config?.method?.toUpperCase() || context.method || 'GET',
        responseBody: '',
        requestHeaders: {},
        responseHeaders: {},
        errorCode: error.code || 'N/A',
        context: context
      };

      // Capture response data safely
      if (error.response?.data) {
        try {
          diagnostics.responseBody = typeof error.response.data === 'string' 
            ? error.response.data
            : JSON.stringify(error.response.data, null, 2);
        } catch (jsonError) {
          diagnostics.responseBody = 'Unable to parse response data';
        }
      } else if (error.response) {
        diagnostics.responseBody = 'No response body available';
      }

      // Capture relevant headers (excluding sensitive data)
      if (error.config?.headers) {
        const safeHeaders = { ...error.config.headers };
        delete safeHeaders.Authorization;
        delete safeHeaders.authorization;
        diagnostics.requestHeaders = safeHeaders;
      }

      if (error.response?.headers) {
        diagnostics.responseHeaders = {
          'content-type': error.response.headers['content-type'],
          'content-length': error.response.headers['content-length'],
          'server': error.response.headers.server,
          'date': error.response.headers.date
        };
      }

      const embed = new EmbedBuilder()
        .setTitle(`🔌 ${apiName} API Failure`)
        .setDescription(`Critical API failure after ${diagnostics.retryCount} retry attempts. Requires immediate attention.`)
        .setColor(0xff0000) // Red for API failures
        .addFields(
          {
            name: '🌐 Request Details',
            value: `**Method:** ${diagnostics.method}\n**URL:** \`${diagnostics.apiUrl}\`\n**Error Code:** ${diagnostics.errorCode}`,
            inline: false
          },
          {
            name: '📊 Response Details',
            value: `**HTTP Status:** ${diagnostics.httpStatus} ${diagnostics.httpStatusText}\n**Content-Type:** ${diagnostics.responseHeaders['content-type'] || 'N/A'}\n**Server:** ${diagnostics.responseHeaders.server || 'N/A'}`,
            inline: false
          },
          {
            name: '💬 Response Body',
            value: diagnostics.responseBody ? 
              `\`\`\`${diagnostics.responseBody.substring(0, 800)}${diagnostics.responseBody.length > 800 ? '...' : ''}\`\`\`` :
              'No response body available',
            inline: false
          },
          {
            name: '❌ Error Message',
            value: `\`\`\`${error.message.substring(0, 500)}${error.message.length > 500 ? '...' : ''}\`\`\``,
            inline: false
          }
        )
        .addFields(
          {
            name: '🔧 Diagnostic Context',
            value: `**Retry Count:** ${diagnostics.retryCount}\n**Occurred:** ${diagnostics.timestamp}\n**Operation:** ${context.operation || 'Unknown'}\n**Additional Context:** \`${JSON.stringify(context, null, 0).substring(0, 100)}\``,
            inline: false
          },
          {
            name: '⚡ Next Steps',
            value: 'Bot will continue retrying automatically. Check API status and credentials if issue persists.',
            inline: false
          }
        )
        .setTimestamp();

      // Send comprehensive API failure notification to admin via DM
      const adminUser = await this.client.users.fetch(config.adminDiscordId);
      if (adminUser) {
        await adminUser.send({ embeds: [embed] });
        errorHandler.logger.error('Sent comprehensive API failure notification via DM to admin', { 
          apiName,
          diagnostics,
          error: error.message
        });
      } else {
        errorHandler.logger.error('Failed to send API failure notification via DM (admin not found)', {
          apiName,
          diagnostics,
          error: error.message
        });
      }
      this.setCooldown(notificationKey, 45 * 60 * 1000); // 45 minutes cooldown
    } catch (notificationError) {
      errorHandler.logger.error('Failed to send API failure notification', { 
        apiName,
        error: notificationError.message,
        originalError: error.message
      });
    }
  }

  /**
   * Send comprehensive database failure notification with full diagnostic details
   */
  async notifyDatabaseFailure(operation, error, context = {}) {
    const notificationKey = `db_failure_${operation}`;
    
    // Check cooldown
    if (this.isOnCooldown(notificationKey)) {
      return;
    }

    try {
      // Enhanced diagnostic information gathering
      const diagnostics = {
        timestamp: new Date().toISOString(),
        operation,
        retryCount: error.retryCount || 'unknown',
        errorCode: error.code || error.errno || 'N/A',
        sqlState: error.sqlState || 'N/A',
        query: context.query || 'N/A',
        parameters: context.parameters || [],
        databasePath: context.databasePath || 'N/A',
        tableName: context.tableName || 'N/A',
        transactionActive: context.inTransaction || false,
        context: context
      };

      // Sanitize sensitive parameters (remove potential PII)
      const sanitizedParams = diagnostics.parameters.map((param, index) => {
        if (typeof param === 'string' && param.length > 50) {
          return `[String:${param.length}chars]`;
        }
        return param;
      });

      const embed = new EmbedBuilder()
        .setTitle(`💾 Database Operation Failure`)
        .setDescription(`Critical database ${operation} failure after ${diagnostics.retryCount} retry attempts. Database functionality compromised.`)
        .setColor(0xff0000) // Red for database failures
        .addFields(
          {
            name: '🗄️ Database Details',
            value: `**Operation:** ${diagnostics.operation}\n**Table:** ${diagnostics.tableName}\n**Database:** \`${diagnostics.databasePath}\`\n**Transaction Active:** ${diagnostics.transactionActive ? 'Yes' : 'No'}`,
            inline: false
          },
          {
            name: '📝 Query Information',
            value: `**SQL Query:**\n\`\`\`sql\n${diagnostics.query.substring(0, 300)}${diagnostics.query.length > 300 ? '...' : ''}\n\`\`\`\n**Parameters:** \`${JSON.stringify(sanitizedParams)}\``,
            inline: false
          },
          {
            name: '❌ Error Details',
            value: `**Error Code:** ${diagnostics.errorCode}\n**SQL State:** ${diagnostics.sqlState}\n**Message:**\n\`\`\`${error.message.substring(0, 400)}${error.message.length > 400 ? '...' : ''}\`\`\``,
            inline: false
          }
        )
        .addFields(
          {
            name: '🔧 Diagnostic Context',
            value: `**Retry Count:** ${diagnostics.retryCount}\n**Occurred:** ${diagnostics.timestamp}\n**Stack Trace Available:** ${error.stack ? 'Yes' : 'No'}\n**Context:** \`${JSON.stringify(context, null, 0).substring(0, 150)}\``,
            inline: false
          },
          {
            name: '⚠️ Impact Assessment',
            value: `Bot features that depend on database operations may be temporarily affected. Automatic retry mechanisms are active.\n\n**Affected Operations:**\n• User RSVP tracking\n• Match thread management\n• User mapping storage\n• Historical data retrieval`,
            inline: false
          },
          {
            name: '🚨 Recommended Actions',
            value: `1. Check database file permissions\n2. Verify disk space availability\n3. Monitor for corruption issues\n4. Consider database integrity check\n5. Review recent schema changes`,
            inline: false
          }
        )
        .setTimestamp();

      // Add stack trace if available and not too long
      if (error.stack && error.stack.length < 1000) {
        embed.addFields({
          name: '📚 Stack Trace',
          value: `\`\`\`${error.stack.substring(0, 800)}\`\`\``,
          inline: false
        });
      }

      // Send comprehensive database failure notification to admin via DM
      const adminUser = await this.client.users.fetch(config.adminDiscordId);
      if (adminUser) {
        await adminUser.send({ embeds: [embed] });
        errorHandler.logger.error('Sent comprehensive database failure notification via DM to admin', { 
          operation,
          diagnostics,
          error: error.message
        });
      } else {
        errorHandler.logger.error('Failed to send database failure notification via DM (admin not found)', {
          operation,
          diagnostics,
          error: error.message
        });
      }
      this.setCooldown(notificationKey, 30 * 60 * 1000); // 30 minutes cooldown
    } catch (notificationError) {
      errorHandler.logger.error('Failed to send database failure notification', { 
        operation,
        error: notificationError.message,
        originalError: error.message
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
