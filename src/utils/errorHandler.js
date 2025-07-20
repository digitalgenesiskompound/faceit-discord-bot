const winston = require('winston');
const path = require('path');
const config = require('../config/config');

/**
 * Advanced Error Handler with retry logic, exponential backoff, logging, and circuit breaker
 */
class ErrorHandler {
  constructor() {
    this.logger = this.createLogger();
    this.circuitBreakers = new Map();
    this.retryStats = new Map();
  }

  /**
   * Create structured logger with multiple transports
   */
  createLogger() {
    const logFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.json(),
      winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
        let logMessage = `${timestamp} [${level.toUpperCase()}] ${message}`;
        if (stack) {
          logMessage += `\nStack: ${stack}`;
        }
        if (Object.keys(meta).length > 0) {
          logMessage += `\nMeta: ${JSON.stringify(meta, null, 2)}`;
        }
        return logMessage;
      })
    );

    return winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: logFormat,
      transports: [
        // Console logging
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        }),
        // File logging for errors
        new winston.transports.File({ 
          filename: path.join(__dirname, '../../logs/error.log'),
          level: 'error',
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        }),
        // General application log
        new winston.transports.File({ 
          filename: path.join(__dirname, '../../logs/app.log'),
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        }),
      ],
    });
  }

  /**
   * Enhanced HTTP request with advanced retry logic and circuit breaker
   */
  async httpRequestWithRetry(requestFunction, options = {}) {
    const {
      maxRetries = 3,
      baseDelay = 1000,
      maxDelay = 30000,
      timeout = 15000,
      retryCondition = this.defaultHttpRetryCondition,
      circuitBreakerKey = 'default',
      context = {}
    } = options;

    // Check circuit breaker
    if (this.isCircuitOpen(circuitBreakerKey)) {
      const error = new Error(`Circuit breaker is OPEN for ${circuitBreakerKey}`);
      this.logger.warn('Circuit breaker prevented request', { 
        circuitBreakerKey, 
        context 
      });
      throw error;
    }

    let lastError;
    let retryCount = 0;

    while (retryCount <= maxRetries) {
      try {
        // Log attempt
        this.logger.debug('HTTP request attempt', {
          attempt: retryCount + 1,
          maxRetries: maxRetries + 1,
          circuitBreakerKey,
          context
        });

        // Execute the request with timeout
        const result = await Promise.race([
          requestFunction(),
          this.createTimeoutPromise(timeout)
        ]);

        // Success - record and reset circuit breaker
        this.recordSuccess(circuitBreakerKey);
        this.recordRetryStats(circuitBreakerKey, retryCount, true);
        
        this.logger.info('HTTP request succeeded', {
          attempt: retryCount + 1,
          circuitBreakerKey,
          context
        });

        return result;

      } catch (error) {
        lastError = error;
        
        // Log the error
        this.logger.error('HTTP request failed', {
          attempt: retryCount + 1,
          error: error.message,
          status: error.response?.status,
          circuitBreakerKey,
          context,
          stack: error.stack
        });

        // Check if we should retry
        if (retryCount >= maxRetries || !retryCondition(error)) {
          break;
        }

        // Calculate delay with jitter
        const delay = Math.min(
          baseDelay * Math.pow(2, retryCount) + Math.random() * 1000,
          maxDelay
        );

        this.logger.warn('Retrying HTTP request', {
          retryCount: retryCount + 1,
          delay,
          circuitBreakerKey,
          context
        });

        await this.sleep(delay);
        retryCount++;
      }
    }

    // All retries failed - record failure and update circuit breaker
    this.recordFailure(circuitBreakerKey);
    this.recordRetryStats(circuitBreakerKey, retryCount, false);

    // Enhance error with retry information
    lastError.retryCount = retryCount;
    lastError.circuitBreakerKey = circuitBreakerKey;
    
    this.logger.error('HTTP request exhausted all retries', {
      totalAttempts: retryCount + 1,
      finalError: lastError.message,
      circuitBreakerKey,
      context
    });

    throw lastError;
  }

  /**
   * Enhanced database operation with retry logic
   */
  async databaseOperationWithRetry(operation, options = {}) {
    const {
      maxRetries = 3,
      baseDelay = 500,
      maxDelay = 5000,
      retryCondition = this.defaultDatabaseRetryCondition,
      operationName = 'database_operation',
      context = {}
    } = options;

    let lastError;
    let retryCount = 0;

    while (retryCount <= maxRetries) {
      try {
        this.logger.debug('Database operation attempt', {
          operation: operationName,
          attempt: retryCount + 1,
          maxRetries: maxRetries + 1,
          context
        });

        const result = await operation();

        this.logger.debug('Database operation succeeded', {
          operation: operationName,
          attempt: retryCount + 1,
          context
        });

        return result;

      } catch (error) {
        lastError = error;
        
        this.logger.error('Database operation failed', {
          operation: operationName,
          attempt: retryCount + 1,
          error: error.message,
          code: error.code,
          context,
          stack: error.stack
        });

        // Check if we should retry
        if (retryCount >= maxRetries || !retryCondition(error)) {
          break;
        }

        // Calculate delay with jitter
        const delay = Math.min(
          baseDelay * Math.pow(2, retryCount) + Math.random() * 200,
          maxDelay
        );

        this.logger.warn('Retrying database operation', {
          operation: operationName,
          retryCount: retryCount + 1,
          delay,
          context
        });

        await this.sleep(delay);
        retryCount++;
      }
    }

    // All retries failed
    lastError.retryCount = retryCount;
    lastError.operationName = operationName;

    this.logger.error('Database operation exhausted all retries', {
      operation: operationName,
      totalAttempts: retryCount + 1,
      finalError: lastError.message,
      context
    });

    throw lastError;
  }

  /**
   * Circuit breaker implementation
   */
  isCircuitOpen(key) {
    const breaker = this.circuitBreakers.get(key);
    if (!breaker) return false;

    const now = Date.now();
    
    // Check if we're in the timeout period
    if (breaker.state === 'OPEN' && now - breaker.lastFailureTime > breaker.timeout) {
      breaker.state = 'HALF_OPEN';
      this.logger.info('Circuit breaker moved to HALF_OPEN', { key });
    }

    return breaker.state === 'OPEN';
  }

  recordSuccess(key) {
    const breaker = this.circuitBreakers.get(key) || this.createCircuitBreaker();
    breaker.consecutiveFailures = 0;
    breaker.state = 'CLOSED';
    this.circuitBreakers.set(key, breaker);
  }

  recordFailure(key) {
    const breaker = this.circuitBreakers.get(key) || this.createCircuitBreaker();
    breaker.consecutiveFailures++;
    breaker.lastFailureTime = Date.now();

    if (breaker.consecutiveFailures >= breaker.threshold) {
      breaker.state = 'OPEN';
      this.logger.warn('Circuit breaker opened', { 
        key, 
        consecutiveFailures: breaker.consecutiveFailures,
        threshold: breaker.threshold
      });
    }

    this.circuitBreakers.set(key, breaker);
  }

  createCircuitBreaker() {
    return {
      threshold: 5,
      timeout: 60000, // 1 minute
      consecutiveFailures: 0,
      lastFailureTime: 0,
      state: 'CLOSED' // CLOSED, OPEN, HALF_OPEN
    };
  }

  /**
   * Record retry statistics for monitoring
   */
  recordRetryStats(key, retryCount, success) {
    const stats = this.retryStats.get(key) || {
      totalRequests: 0,
      totalRetries: 0,
      successCount: 0,
      failureCount: 0,
      lastUpdated: Date.now()
    };

    stats.totalRequests++;
    stats.totalRetries += retryCount;
    stats.lastUpdated = Date.now();

    if (success) {
      stats.successCount++;
    } else {
      stats.failureCount++;
    }

    this.retryStats.set(key, stats);
  }

  /**
   * Default retry conditions
   */
  defaultHttpRetryCondition(error) {
    // Retry on network errors
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || 
        error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
      return true;
    }

    // Retry on 5xx server errors and 429 rate limiting
    if (error.response?.status >= 500 || error.response?.status === 429) {
      return true;
    }

    // Don't retry on client errors (4xx except 429)
    return false;
  }

  defaultDatabaseRetryCondition(error) {
    // SQLite specific error codes that are worth retrying
    const retryableCodes = [
      'SQLITE_BUSY',     // Database is locked
      'SQLITE_LOCKED',   // Database table is locked
      'SQLITE_IOERR',    // I/O error
      'SQLITE_CORRUPT',  // Database corruption (might be temporary)
      'SQLITE_CANTOPEN'  // Cannot open database (might be temporary)
    ];

    return retryableCodes.some(code => error.message.includes(code) || error.code === code);
  }

  /**
   * Create timeout promise
   */
  createTimeoutPromise(timeout) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);
    });
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get circuit breaker status for monitoring
   */
  getCircuitBreakerStatus() {
    const status = {};
    for (const [key, breaker] of this.circuitBreakers.entries()) {
      status[key] = {
        state: breaker.state,
        consecutiveFailures: breaker.consecutiveFailures,
        lastFailureTime: breaker.lastFailureTime
      };
    }
    return status;
  }

  /**
   * Get retry statistics for monitoring
   */
  getRetryStats() {
    const stats = {};
    for (const [key, stat] of this.retryStats.entries()) {
      stats[key] = {
        ...stat,
        successRate: stat.totalRequests > 0 ? stat.successCount / stat.totalRequests : 0,
        averageRetries: stat.totalRequests > 0 ? stat.totalRetries / stat.totalRequests : 0
      };
    }
    return stats;
  }

  /**
   * Log system health metrics
   */
  logHealthMetrics() {
    const circuitStatus = this.getCircuitBreakerStatus();
    const retryStats = this.getRetryStats();

    this.logger.info('System health metrics', {
      circuitBreakers: circuitStatus,
      retryStatistics: retryStats,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = new ErrorHandler();
