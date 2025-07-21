/**
 * Performance Monitoring and Timeout Utilities
 * Tracks response times, memory usage, and provides timeout wrappers
 */
class PerformanceMonitor {
  constructor() {
    this.metrics = {
      requests: new Map(), // Track requests by type
      averageResponseTimes: new Map(),
      memorySnapshots: [],
      errors: new Map(),
      startTime: Date.now()
    };
    
    // Start memory monitoring
    this.startMemoryMonitoring();
  }
  
  /**
   * Wrap a function with timeout protection
   */
  static withTimeout(fn, timeoutMs = 10000, timeoutMessage = 'Operation timed out') {
    return async (...args) => {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`${timeoutMessage} (${timeoutMs}ms)`));
        }, timeoutMs);
      });
      
      return Promise.race([
        fn(...args),
        timeoutPromise
      ]);
    };
  }
  
  /**
   * Time an operation and track metrics
   */
  async timeOperation(operationType, fn, ...args) {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();
    
    try {
      const result = await fn(...args);
      const duration = Date.now() - startTime;
      const endMemory = process.memoryUsage();
      
      this.recordMetric(operationType, {
        duration,
        success: true,
        memoryDelta: {
          rss: endMemory.rss - startMemory.rss,
          heapUsed: endMemory.heapUsed - startMemory.heapUsed
        },
        timestamp: startTime
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.recordMetric(operationType, {
        duration,
        success: false,
        error: error.message,
        timestamp: startTime
      });
      
      throw error;
    }
  }
  
  /**
   * Record a performance metric
   */
  recordMetric(type, data) {
    if (!this.metrics.requests.has(type)) {
      this.metrics.requests.set(type, []);
    }
    
    const requests = this.metrics.requests.get(type);
    requests.push(data);
    
    // Keep only last 1000 requests per type
    if (requests.length > 1000) {
      requests.shift();
    }
    
    // Update average response time
    const successfulRequests = requests.filter(r => r.success);
    if (successfulRequests.length > 0) {
      const avgTime = successfulRequests.reduce((sum, r) => sum + r.duration, 0) / successfulRequests.length;
      this.metrics.averageResponseTimes.set(type, avgTime);
    }
    
    // Track errors
    if (!data.success) {
      const errorKey = `${type}_errors`;
      if (!this.metrics.errors.has(errorKey)) {
        this.metrics.errors.set(errorKey, []);
      }
      this.metrics.errors.get(errorKey).push({
        error: data.error,
        timestamp: data.timestamp
      });
    }
  }
  
  /**
   * Start monitoring memory usage
   */
  startMemoryMonitoring() {
    setInterval(() => {
      const memUsage = process.memoryUsage();
      this.metrics.memorySnapshots.push({
        ...memUsage,
        timestamp: Date.now()
      });
      
      // Keep only last 1000 snapshots (about 16 minutes if taken every second)
      if (this.metrics.memorySnapshots.length > 1000) {
        this.metrics.memorySnapshots.shift();
      }
    }, 60000); // Every minute
  }
  
  /**
   * Get performance statistics
   */
  getStats() {
    const now = Date.now();
    const uptime = now - this.metrics.startTime;
    
    const requestStats = {};
    for (const [type, requests] of this.metrics.requests) {
      const recentRequests = requests.filter(r => now - r.timestamp < 300000); // Last 5 minutes
      const successfulRequests = recentRequests.filter(r => r.success);
      const failedRequests = recentRequests.filter(r => !r.success);
      
      requestStats[type] = {
        total: requests.length,
        recent: recentRequests.length,
        successful: successfulRequests.length,
        failed: failedRequests.length,
        successRate: recentRequests.length > 0 ? 
          ((successfulRequests.length / recentRequests.length) * 100).toFixed(2) : 100,
        averageResponseTime: this.metrics.averageResponseTimes.get(type) || 0
      };
    }
    
    const currentMemory = process.memoryUsage();
    const recentMemorySnapshots = this.metrics.memorySnapshots.filter(
      s => now - s.timestamp < 3600000 // Last hour
    );
    
    let memoryTrend = 'stable';
    if (recentMemorySnapshots.length > 10) {
      const oldest = recentMemorySnapshots[0];
      const newest = recentMemorySnapshots[recentMemorySnapshots.length - 1];
      const growth = ((newest.heapUsed - oldest.heapUsed) / oldest.heapUsed) * 100;
      
      if (growth > 20) memoryTrend = 'increasing';
      else if (growth < -20) memoryTrend = 'decreasing';
    }
    
    return {
      uptime,
      requests: requestStats,
      memory: {
        current: currentMemory,
        trend: memoryTrend,
        snapshots: recentMemorySnapshots.length
      },
      errors: this.getRecentErrors()
    };
  }
  
  /**
   * Get recent errors
   */
  getRecentErrors() {
    const now = Date.now();
    const recentErrors = {};
    
    for (const [type, errors] of this.metrics.errors) {
      const recent = errors.filter(e => now - e.timestamp < 3600000); // Last hour
      if (recent.length > 0) {
        recentErrors[type] = recent.slice(-10); // Last 10 errors
      }
    }
    
    return recentErrors;
  }
  
  /**
   * Get overall health status
   */
  getHealthStatus() {
    const stats = this.getStats();
    let healthScore = 100;
    const issues = [];
    
    // Check memory usage
    const memoryUsagePercent = (stats.memory.current.heapUsed / stats.memory.current.heapTotal) * 100;
    if (memoryUsagePercent > 90) {
      healthScore -= 30;
      issues.push('High memory usage');
    }
    
    // Check error rates
    for (const [type, reqStats] of Object.entries(stats.requests)) {
      if (reqStats.recent > 10 && reqStats.successRate < 80) {
        healthScore -= 20;
        issues.push(`High error rate in ${type}`);
      }
    }
    
    // Check response times
    for (const [type, reqStats] of Object.entries(stats.requests)) {
      if (reqStats.averageResponseTime > 10000) { // 10 seconds
        healthScore -= 15;
        issues.push(`Slow response times in ${type}`);
      }
    }
    
    let status = 'healthy';
    if (healthScore < 50) status = 'critical';
    else if (healthScore < 80) status = 'degraded';
    
    return {
      status,
      score: Math.max(0, healthScore),
      issues
    };
  }
  
  /**
   * Reset all metrics
   */
  reset() {
    this.metrics = {
      requests: new Map(),
      averageResponseTimes: new Map(),
      memorySnapshots: [],
      errors: new Map(),
      startTime: Date.now()
    };
  }
}

// Singleton instance
const performanceMonitor = new PerformanceMonitor();

module.exports = {
  PerformanceMonitor,
  performanceMonitor,
  withTimeout: PerformanceMonitor.withTimeout
};
