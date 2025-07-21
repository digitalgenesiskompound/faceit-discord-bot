/**
 * Discord Rate Limiter with Request Queue
 * Handles Discord API rate limits to prevent 429 errors
 */
class DiscordRateLimiter {
  constructor() {
    this.queues = new Map(); // Different queues for different endpoints
    this.processing = new Map(); // Track which queues are being processed
    
    // Rate limits per endpoint type (requests per second)
    this.limits = {
      interaction: { requests: 5, window: 1000 }, // 5 requests per second
      message: { requests: 5, window: 1000 },
      channel: { requests: 10, window: 1000 },
      default: { requests: 3, window: 1000 }
    };
    
    // Track last request times
    this.lastRequests = new Map();
  }
  
  /**
   * Add a request to the queue
   */
  async enqueue(type, requestFn, priority = 0) {
    const queueKey = type || 'default';
    
    if (!this.queues.has(queueKey)) {
      this.queues.set(queueKey, []);
    }
    
    return new Promise((resolve, reject) => {
      this.queues.get(queueKey).push({
        fn: requestFn,
        resolve,
        reject,
        priority,
        timestamp: Date.now()
      });
      
      // Sort by priority (higher first) then by timestamp (older first)
      this.queues.get(queueKey).sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.timestamp - b.timestamp;
      });
      
      this.processQueue(queueKey);
    });
  }
  
  /**
   * Process the queue for a specific endpoint type
   */
  async processQueue(queueKey) {
    if (this.processing.get(queueKey)) return;
    
    const queue = this.queues.get(queueKey);
    if (!queue || queue.length === 0) return;
    
    this.processing.set(queueKey, true);
    
    const limit = this.limits[queueKey] || this.limits.default;
    const lastRequestTimes = this.lastRequests.get(queueKey) || [];
    
    try {
      while (queue.length > 0) {
        const now = Date.now();
        
        // Remove old request times outside the window
        const validTimes = lastRequestTimes.filter(time => now - time < limit.window);
        
        // Check if we can make another request
        if (validTimes.length >= limit.requests) {
          // Wait until the oldest request is outside the window
          const waitTime = limit.window - (now - validTimes[0]) + 10; // +10ms buffer
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        
        const request = queue.shift();
        
        try {
          // Execute the request
          const result = await request.fn();
          
          // Track this request
          validTimes.push(Date.now());
          this.lastRequests.set(queueKey, validTimes);
          
          request.resolve(result);
        } catch (error) {
          // Handle rate limit errors specifically
          if (error.code === 429) {
            console.warn(`Rate limited on ${queueKey}, retrying after delay`);
            const retryAfter = error.retryAfter || 1000;
            await new Promise(resolve => setTimeout(resolve, retryAfter));
            // Put the request back at the front of the queue
            queue.unshift(request);
            continue;
          } else {
            request.reject(error);
          }
        }
      }
    } finally {
      this.processing.set(queueKey, false);
    }
  }
  
  /**
   * Get queue status for monitoring
   */
  getStatus() {
    const status = {};
    for (const [key, queue] of this.queues) {
      status[key] = {
        pending: queue.length,
        processing: this.processing.get(key) || false,
        recentRequests: (this.lastRequests.get(key) || []).length
      };
    }
    return status;
  }
  
  /**
   * Clear all queues (for shutdown)
   */
  clear() {
    for (const [key, queue] of this.queues) {
      queue.forEach(req => req.reject(new Error('Rate limiter shutdown')));
      queue.length = 0;
    }
    this.processing.clear();
    this.lastRequests.clear();
  }
}

// Singleton instance
const rateLimiter = new DiscordRateLimiter();

module.exports = rateLimiter;
