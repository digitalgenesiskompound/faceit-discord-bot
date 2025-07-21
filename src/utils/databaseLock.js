/**
 * Database Locking and Connection Management
 * Prevents race conditions and manages SQLite connections safely
 */
class DatabaseLockManager {
  constructor() {
    this.locks = new Map(); // Track active locks
    this.waitingQueue = new Map(); // Queue for waiting operations
    this.lockTimeouts = new Map(); // Timeout handlers
    
    this.defaultTimeout = 30000; // 30 seconds default timeout
    this.maxRetries = 3;
  }
  
  /**
   * Acquire a lock for a specific resource
   */
  async acquireLock(resource, operation, timeout = this.defaultTimeout) {
    const lockId = `${resource}_${Date.now()}_${Math.random()}`;
    
    return new Promise((resolve, reject) => {
      const attemptLock = () => {
        if (!this.locks.has(resource)) {
          // Lock is available
          this.locks.set(resource, {
            id: lockId,
            startTime: Date.now(),
            operation,
            timeout: setTimeout(() => {
              this.releaseLock(resource, lockId);
              reject(new Error(`Database lock timeout for ${resource} after ${timeout}ms`));
            }, timeout)
          });
          
          resolve(lockId);
        } else {
          // Lock is busy, add to queue
          if (!this.waitingQueue.has(resource)) {
            this.waitingQueue.set(resource, []);
          }
          
          this.waitingQueue.get(resource).push({
            resolve,
            reject,
            operation,
            timeout,
            startTime: Date.now()
          });
        }
      };
      
      attemptLock();
    });
  }
  
  /**
   * Release a lock and process next in queue
   */
  releaseLock(resource, lockId) {
    const lock = this.locks.get(resource);
    
    if (lock && lock.id === lockId) {
      // Clear timeout
      if (lock.timeout) {
        clearTimeout(lock.timeout);
      }
      
      this.locks.delete(resource);
      
      // Process next in queue
      const queue = this.waitingQueue.get(resource);
      if (queue && queue.length > 0) {
        const next = queue.shift();
        
        // Check if request hasn't timed out while waiting
        const waitTime = Date.now() - next.startTime;
        if (waitTime < next.timeout) {
          const newLockId = `${resource}_${Date.now()}_${Math.random()}`;
          const remainingTimeout = next.timeout - waitTime;
          
          this.locks.set(resource, {
            id: newLockId,
            startTime: Date.now(),
            operation: next.operation,
            timeout: setTimeout(() => {
              this.releaseLock(resource, newLockId);
              next.reject(new Error(`Database lock timeout for ${resource} after ${next.timeout}ms`));
            }, remainingTimeout)
          });
          
          next.resolve(newLockId);
        } else {
          // Request timed out while waiting
          next.reject(new Error(`Database lock request timed out while waiting for ${resource}`));
          
          // Try next in queue
          if (queue.length > 0) {
            setImmediate(() => this.releaseLock(resource, 'dummy'));
          }
        }
      }
      
      // Clean up empty queue
      if (!queue || queue.length === 0) {
        this.waitingQueue.delete(resource);
      }
    }
  }
  
  /**
   * Execute an operation with automatic locking
   */
  async withLock(resource, operation, timeout = this.defaultTimeout) {
    let lockId = null;
    let retries = 0;
    
    while (retries < this.maxRetries) {
      try {
        lockId = await this.acquireLock(resource, operation.name || 'unnamed', timeout);
        const result = await operation();
        this.releaseLock(resource, lockId);
        return result;
      } catch (error) {
        if (lockId) {
          this.releaseLock(resource, lockId);
        }
        
        retries++;
        
        // If it's a timeout or lock error and we have retries left, try again
        if (retries < this.maxRetries && (
          error.message.includes('timeout') || 
          error.message.includes('lock') ||
          error.message.includes('SQLITE_BUSY') ||
          error.message.includes('database is locked')
        )) {
          console.warn(`Database operation retry ${retries}/${this.maxRetries} for ${resource}: ${error.message}`);
          
          // Exponential backoff
          const delay = Math.min(1000 * Math.pow(2, retries - 1), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        throw error;
      }
    }
    
    throw new Error(`Database operation failed after ${this.maxRetries} retries for ${resource}`);
  }
  
  /**
   * Get lock status for monitoring
   */
  getStatus() {
    const locks = {};
    const queues = {};
    
    for (const [resource, lock] of this.locks) {
      locks[resource] = {
        operation: lock.operation,
        duration: Date.now() - lock.startTime,
        id: lock.id.split('_')[2] // Just the random part
      };
    }
    
    for (const [resource, queue] of this.waitingQueue) {
      queues[resource] = {
        waiting: queue.length,
        operations: queue.map(q => q.operation)
      };
    }
    
    return { locks, queues };
  }
  
  /**
   * Force release all locks (emergency cleanup)
   */
  releaseAllLocks() {
    for (const [resource, lock] of this.locks) {
      if (lock.timeout) {
        clearTimeout(lock.timeout);
      }
    }
    
    this.locks.clear();
    
    // Reject all waiting operations
    for (const [resource, queue] of this.waitingQueue) {
      queue.forEach(item => {
        item.reject(new Error('Database lock manager shutdown'));
      });
    }
    
    this.waitingQueue.clear();
  }
}

// Singleton instance
const databaseLockManager = new DatabaseLockManager();

module.exports = {
  DatabaseLockManager,
  databaseLockManager
};
