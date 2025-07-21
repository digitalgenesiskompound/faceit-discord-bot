/**
 * Circuit Breaker Pattern for External API Calls
 * Prevents cascading failures when external services are down
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.threshold = options.threshold || 5; // Number of failures before opening
    this.timeout = options.timeout || 60000; // How long to stay open (ms)
    this.monitor = options.monitor || 30000; // How often to check if we should retry (ms)
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.nextAttempt = null;
    
    // Statistics
    this.stats = {
      requests: 0,
      failures: 0,
      successes: 0,
      circuitOpened: 0,
      lastReset: Date.now()
    };
  }
  
  /**
   * Execute a function with circuit breaker protection
   */
  async execute(fn, fallback = null) {
    this.stats.requests++;
    
    // Check if circuit should be closed
    if (this.state === 'OPEN') {
      if (Date.now() >= this.nextAttempt) {
        this.state = 'HALF_OPEN';
        console.log('Circuit breaker: Moving to HALF_OPEN state');
      } else {
        const error = new Error('Circuit breaker is OPEN');
        error.circuitBreakerOpen = true;
        if (fallback) return fallback();
        throw error;
      }
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      if (fallback) return fallback();
      throw error;
    }
  }
  
  /**
   * Handle successful execution
   */
  onSuccess() {
    this.stats.successes++;
    this.failureCount = 0;
    
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      console.log('Circuit breaker: Moving to CLOSED state after successful request');
    }
  }
  
  /**
   * Handle failed execution
   */
  onFailure(error) {
    this.stats.failures++;
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.timeout;
      this.stats.circuitOpened++;
      console.error(`Circuit breaker: OPENED after ${this.failureCount} failures. Next attempt in ${this.timeout}ms`);
    }
    
    console.warn(`Circuit breaker failure ${this.failureCount}/${this.threshold}: ${error.message}`);
  }
  
  /**
   * Get current status
   */
  getStatus() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      nextAttempt: this.nextAttempt,
      stats: { ...this.stats },
      healthCheck: {
        isHealthy: this.state === 'CLOSED',
        uptime: Date.now() - this.stats.lastReset,
        successRate: this.stats.requests > 0 ? 
          ((this.stats.successes / this.stats.requests) * 100).toFixed(2) : 100
      }
    };
  }
  
  /**
   * Manually reset the circuit breaker
   */
  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.nextAttempt = null;
    console.log('Circuit breaker manually reset');
  }
  
  /**
   * Get a safe fallback function for API calls
   */
  static createFallback(defaultValue, logMessage = 'Using fallback due to circuit breaker') {
    return () => {
      console.warn(logMessage);
      return defaultValue;
    };
  }
}

/**
 * Circuit Breaker Manager for multiple APIs
 */
class CircuitBreakerManager {
  constructor() {
    this.breakers = new Map();
  }
  
  /**
   * Get or create a circuit breaker for a specific service
   */
  getBreaker(serviceName, options = {}) {
    if (!this.breakers.has(serviceName)) {
      this.breakers.set(serviceName, new CircuitBreaker({
        threshold: 5,
        timeout: 60000, // 1 minute
        monitor: 30000, // 30 seconds
        ...options
      }));
    }
    return this.breakers.get(serviceName);
  }
  
  /**
   * Execute a function with circuit breaker protection
   */
  async execute(serviceName, fn, fallback = null, options = {}) {
    const breaker = this.getBreaker(serviceName, options);
    return breaker.execute(fn, fallback);
  }
  
  /**
   * Get status of all circuit breakers
   */
  getAllStatus() {
    const status = {};
    for (const [name, breaker] of this.breakers) {
      status[name] = breaker.getStatus();
    }
    return status;
  }
  
  /**
   * Reset a specific circuit breaker
   */
  reset(serviceName) {
    const breaker = this.breakers.get(serviceName);
    if (breaker) {
      breaker.reset();
    }
  }
  
  /**
   * Reset all circuit breakers
   */
  resetAll() {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}

// Export singleton instance
const circuitBreakerManager = new CircuitBreakerManager();

module.exports = {
  CircuitBreaker,
  CircuitBreakerManager,
  circuitBreakerManager
};
