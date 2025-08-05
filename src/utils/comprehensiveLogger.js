const logger = require('./logger');

/**
 * Comprehensive Logger - Simplified wrapper around basic logger
 * Maintains compatibility with existing complex logging calls
 */
class ComprehensiveLogger {
  constructor() {
    this.logger = logger;
    
    // Define origins for compatibility
    this.origins = {
      SYSTEM: 'system',
      API: 'api',
      API_LIVE: 'api_live',
      USER_INPUT: 'user_input',
      VALIDATION: 'validation',
      RECONCILIATION: 'reconciliation',
      DISCORD: 'discord',
      DATABASE: 'database',
      CACHE: 'cache'
    };
    
    // Define event categories for compatibility
    this.eventCategories = {
      SYNC: 'sync',
      SKIP: 'skip',
      VALIDATION: 'validation',
      RECONCILIATION: 'reconciliation',
      MUTATION: 'mutation',
      STATUS_CONVERSION: 'status_conversion',
      CONVERSION: 'conversion'
    };
  }
  
  // Generate simple operation ID
  generateOperationId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
  
  // Sanitize data for logging
  sanitizeData(data) {
    if (!data) return null;
    try {
      // Remove sensitive information and limit size
      const sanitized = JSON.parse(JSON.stringify(data));
      return sanitized;
    } catch {
      return String(data).substring(0, 500);
    }
  }
  
  // Basic logging methods
  info(message, context = {}) {
    this.logger.info(message, context);
  }
  
  warn(message, context = {}) {
    this.logger.warn(message, context);
  }
  
  error(message, error = null, context = {}) {
    this.logger.error(message, error, context);
  }
  
  debug(message, context = {}) {
    this.logger.debug(message, context);
  }
  
  /**
   * Log synchronization events (simplified)
   */
  logSync(syncOperation, options = {}) {
    const {
      matchId,
      sourceOrigin = this.origins.SYSTEM,
      targetOrigin = this.origins.SYSTEM,
      reasoning = 'Synchronization required',
      context = {},
      sourceState = null,
      targetState = null,
      syncResult = 'success'
    } = options;

    const logData = {
      category: this.eventCategories.SYNC,
      origin: `${sourceOrigin}→${targetOrigin}`,
      matchId,
      syncOperation,
      reasoning,
      syncResult,
      context: {
        ...context,
        sourceOrigin,
        targetOrigin,
        sourceState: sourceState ? this.sanitizeData(sourceState) : null,
        targetState: targetState ? this.sanitizeData(targetState) : null,
        timestamp: new Date().toISOString(),
        operation_id: this.generateOperationId()
      }
    };

    const logLevel = syncResult === 'success' ? 'info' : 'warn';
    this.logger[logLevel](`Sync operation: ${syncOperation}`, logData);

    // Console output with sync direction
    const emoji = syncResult === 'success' ? '✅' : '⚠️';
    console.log(`${emoji} [SYNC] ${syncOperation}`);
    console.log(`   Direction: ${sourceOrigin} → ${targetOrigin}`);
    console.log(`   Reasoning: ${reasoning}`);
    console.log(`   Result: ${syncResult}`);
    if (matchId) console.log(`   Match: ${matchId}`);
  }

  /**
   * Log when data is NOT updated due to validation
   */
  logSkip(operation, data, options = {}) {
    const {
      matchId,
      origin = this.origins.VALIDATION,
      reasoning = 'Data validation prevented update',
      context = {},
      validationIssues = [],
      existingState = null
    } = options;

    const logData = {
      category: this.eventCategories.SKIP,
      origin,
      matchId,
      operation,
      reasoning,
      context: {
        ...context,
        validationIssues,
        existingState: existingState ? this.sanitizeData(existingState) : null,
        timestamp: new Date().toISOString(),
        operation_id: this.generateOperationId()
      }
    };

    this.logger.info(`Operation skipped: ${operation}`, logData);

    // Console log showing why operation was skipped
    console.log(`⏭️ [SKIP] ${operation}`);
    console.log(`   Reasoning: ${reasoning}`);
    if (validationIssues.length > 0) {
      console.log(`   Issues: ${validationIssues.join(', ')}`);
    }
    if (matchId) console.log(`   Match: ${matchId}`);
  }

  /**
   * Log data validation events with detailed results
   */
  logValidation(validationType, data, options = {}) {
    const {
      matchId,
      origin = this.origins.VALIDATION,
      reasoning = 'Data validation performed',
      context = {},
      validationResult = {},
      isValid = true,
      issues = []
    } = options;

    const logData = {
      category: this.eventCategories.VALIDATION,
      origin,
      matchId,
      validationType,
      reasoning,
      isValid,
      context: {
        ...context,
        validationResult: this.sanitizeData(validationResult),
        issues,
        timestamp: new Date().toISOString(),
        operation_id: this.generateOperationId()
      }
    };

    const logLevel = isValid && issues.length === 0 ? 'debug' : 'info';
    this.logger[logLevel](`Data validation: ${validationType}`, logData);

    // Console output based on validation result
    const emoji = isValid ? '✅' : '❌';
    const status = isValid ? 'PASSED' : 'FAILED';
    console.log(`${emoji} [VALIDATION] ${validationType} - ${status}`);
    console.log(`   Reasoning: ${reasoning}`);
    if (issues.length > 0) {
      console.log(`   Issues: ${issues.join(', ')}`);
    }
    if (matchId) console.log(`   Match: ${matchId}`);
  }

  /**
   * Log reconciliation events with detailed decision information
   */
  logReconciliation(reconciliationType, data, options = {}) {
    const {
      matchId,
      origin = this.origins.RECONCILIATION,
      reasoning = 'Data reconciliation performed',
      context = {},
      action = 'unknown',
      confidence = 'unknown',
      freshData = null,
      existingData = null,
      resultData = null
    } = options;

    const logData = {
      category: this.eventCategories.RECONCILIATION,
      origin,
      matchId,
      reconciliationType,
      reasoning,
      action,
      confidence,
      context: {
        ...context,
        freshData: freshData ? this.sanitizeData(freshData) : null,
        existingData: existingData ? this.sanitizeData(existingData) : null,
        resultData: resultData ? this.sanitizeData(resultData) : null,
        timestamp: new Date().toISOString(),
        operation_id: this.generateOperationId()
      }
    };

    this.logger.info(`Data reconciliation: ${reconciliationType}`, logData);

    // Console output showing reconciliation decision
    const emoji = action === 'update' ? '🔄' : action === 'skip' ? '⏭️' : '❓';
    console.log(`${emoji} [RECONCILIATION] ${reconciliationType}`);
    console.log(`   Action: ${action.toUpperCase()}`);
    console.log(`   Confidence: ${confidence}`);
    console.log(`   Reasoning: ${reasoning}`);
    if (matchId) console.log(`   Match: ${matchId}`);
  }

  /**
   * Log thread state transitions with detailed context
   */
  logThreadTransition(matchId, transition, options = {}) {
    const {
      origin = this.origins.SYSTEM,
      reasoning = 'Thread state transition',
      context = {},
      previousState = null,
      newState = null,
      threadId = null,
      threadName = null
    } = options;

    const logData = {
      category: this.eventCategories.MUTATION,
      origin,
      matchId,
      operation: `thread_transition_${transition}`,
      reasoning,
      context: {
        ...context,
        transition,
        threadId,
        threadName,
        previousState,
        newState,
        timestamp: new Date().toISOString(),
        operation_id: this.generateOperationId()
      }
    };

    this.logger.info(`Thread transition: ${transition}`, logData);

    console.log(`🧵 [THREAD TRANSITION] ${transition}`);
    console.log(`   Match: ${matchId}`);
    if (threadName) console.log(`   Thread: ${threadName}`);
    console.log(`   Reasoning: ${reasoning}`);
    if (previousState && newState) {
      console.log(`   State: ${previousState} → ${newState}`);
    }
  }

  /**
   * Log status conversions with API source information
   */
  logStatusConversion(matchId, statusChange, options = {}) {
    const {
      origin = this.origins.API_LIVE,
      reasoning = 'Status change detected from API',
      context = {},
      previousStatus = null,
      newStatus = null,
      apiTimestamp = null,
      localTimestamp = null,
      isApiNewer = false
    } = options;

    // Determine if this is a normal or concerning status change
    const normalProgressions = {
      'SCHEDULED': ['READY', 'LIVE', 'FINISHED', 'CANCELLED'],
      'READY': ['LIVE', 'FINISHED', 'CANCELLED'],
      'LIVE': ['FINISHED', 'CANCELLED'],
      'FINISHED': [], 
      'CANCELLED': []
    };
    
    const isNormalProgression = normalProgressions[previousStatus]?.includes(newStatus) || false;
    const emoji = isNormalProgression ? '📈' : '⚠️';
    const logLevel = isNormalProgression ? 'info' : 'warn';

    // Enhanced reasoning based on status change context
    let enhancedReasoning = reasoning;
    if (previousStatus && newStatus) {
      if (isApiNewer) {
        enhancedReasoning = `${reasoning} - API confirmed ${newStatus}, previous status ${previousStatus}, API timestamp newer`;
      } else {
        enhancedReasoning = `${reasoning} - Status change ${previousStatus} → ${newStatus}`;
      }
      
      if (!isNormalProgression) {
        enhancedReasoning += ' (concerning status regression detected)';
      }
    }

    const logData = {
      category: this.eventCategories.CONVERSION,
      origin,
      matchId,
      conversion: `status_${previousStatus}_to_${newStatus}`,
      reasoning: enhancedReasoning,
      context: {
        ...context,
        previousStatus,
        newStatus,
        isNormalProgression,
        isApiNewer,
        apiTimestamp,
        localTimestamp,
        timestamp: new Date().toISOString(),
        operation_id: this.generateOperationId()
      }
    };

    this.logger[logLevel](`Status conversion: ${previousStatus} → ${newStatus}`, logData);

    console.log(`${emoji} [STATUS CONVERSION] ${previousStatus} → ${newStatus}`);
    console.log(`   Match: ${matchId}`);
    console.log(`   Reasoning: ${enhancedReasoning}`);
    console.log(`   Origin: ${origin}`);
    if (apiTimestamp && localTimestamp) {
      console.log(`   API Timestamp: ${new Date(apiTimestamp * 1000).toISOString()}`);
      console.log(`   Local Timestamp: ${new Date(localTimestamp * 1000).toISOString()}`);
    }
  }

  /**
   * Log result thread conversions with match completion details
   */
  logResultThreadConversion(matchId, options = {}) {
    const {
      origin = this.origins.API_LIVE,
      reasoning = 'Converted to result thread: live API confirmed FINISHED, previous status SCHEDULED, API timestamp newer',
      context = {},
      previousThreadType = 'upcoming',
      newThreadType = 'finished',
      matchResult = null,
      score = null,
      finishedAt = null
    } = options;

    const logData = {
      category: this.eventCategories.CONVERSION,
      origin,
      matchId,
      conversion: `thread_${previousThreadType}_to_${newThreadType}`,
      reasoning,
      context: {
        ...context,
        previousThreadType,
        newThreadType,
        matchResult: matchResult ? this.sanitizeData(matchResult) : null,
        score,
        finishedAt,
        timestamp: new Date().toISOString(),
        operation_id: this.generateOperationId()
      }
    };

    this.logger.info(`Thread type conversion: ${previousThreadType} → ${newThreadType}`, logData);

    console.log(`🏆 [RESULT CONVERSION] Thread converted to result type`);
    console.log(`   Match: ${matchId}`);
    console.log(`   Reasoning: ${reasoning}`);
    if (score) console.log(`   Score: ${score}`);
    if (finishedAt) console.log(`   Finished: ${new Date(finishedAt * 1000).toISOString()}`);
  }

  /**
   * Sanitize data for logging (remove sensitive information)
   */
  sanitizeData(data) {
    if (!data || typeof data !== 'object') return data;
    
    const sanitized = { ...data };
    
    // Remove or mask sensitive fields
    const sensitiveFields = ['password', 'token', 'apiKey', 'secret'];
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });
    
    // Limit string lengths to prevent log bloat
    Object.keys(sanitized).forEach(key => {
      if (typeof sanitized[key] === 'string' && sanitized[key].length > 500) {
        sanitized[key] = sanitized[key].substring(0, 500) + '... [TRUNCATED]';
      }
    });
    
    return sanitized;
  }

  /**
   * Generate unique operation ID for tracking related log entries
   */
  generateOperationId() {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get logger statistics for monitoring
   */
  getLoggerStats() {
    return {
      transports: this.logger.transports.length,
      level: this.logger.level,
      categories: Object.keys(this.eventCategories),
      origins: Object.keys(this.origins),
      logFiles: [
        'logs/bot-admin.log',
        'logs/mutations.log', 
        'logs/critical-events.log'
      ]
    };
  }

  /**
   * Create admin notification for critical events
   */
  async notifyAdmin(event, details, options = {}) {
    const {
      severity = 'info',
      context = {},
      immediate = false
    } = options;

    // Log the admin notification event
    this.logger.warn(`Admin notification: ${event}`, {
      category: 'ADMIN_NOTIFICATION',
      severity,
      details: this.sanitizeData(details),
      context,
      immediate,
      timestamp: new Date().toISOString()
    });

    // For immediate notifications, could integrate with external notification services
    if (immediate) {
      console.log(`🚨 [ADMIN ALERT] ${event}`);
      console.log(`   Severity: ${severity.toUpperCase()}`);
      console.log(`   Details: ${JSON.stringify(details, null, 2)}`);
    }
  }
}

module.exports = new ComprehensiveLogger();
