const EventEmitter = require('events');

/**
 * Centralized event dispatcher for Discord bot events
 * Simplifies event handling and reduces coupling between components
 */
class EventDispatcher extends EventEmitter {
  constructor() {
    super();
    this.eventHistory = new Map();
    this.eventStats = {
      total: 0,
      byType: new Map()
    };
  }

  /**
   * Emit an event with metadata and statistics tracking
   */
  emitEvent(eventType, data = {}, metadata = {}) {
    const eventData = {
      type: eventType,
      timestamp: new Date().toISOString(),
      data,
      metadata: {
        source: metadata.source || 'unknown',
        priority: metadata.priority || 'normal',
        ...metadata
      }
    };

    // Track statistics
    this.eventStats.total++;
    const typeCount = this.eventStats.byType.get(eventType) || 0;
    this.eventStats.byType.set(eventType, typeCount + 1);

    // Store recent event history (keep last 100 events)
    if (this.eventHistory.size >= 100) {
      const oldestKey = this.eventHistory.keys().next().value;
      this.eventHistory.delete(oldestKey);
    }
    this.eventHistory.set(Date.now(), eventData);

    console.log(`📡 Event dispatched: ${eventType} from ${eventData.metadata.source}`);
    
    // Emit the event
    this.emit(eventType, eventData);
    
    // Also emit a general 'event' for global listeners
    this.emit('event', eventData);
  }

  /**
   * Get event statistics
   */
  getStats() {
    return {
      ...this.eventStats,
      byType: Object.fromEntries(this.eventStats.byType)
    };
  }

  /**
   * Get recent event history
   */
  getRecentEvents(limit = 10) {
    const events = Array.from(this.eventHistory.values()).slice(-limit);
    return events.reverse(); // Most recent first
  }

  /**
   * Clear event history and stats
   */
  clearHistory() {
    this.eventHistory.clear();
    this.eventStats.total = 0;
    this.eventStats.byType.clear();
  }
}

// Event type constants
const EVENT_TYPES = {
  // Match events
  MATCH_NOTIFICATION_SENT: 'match:notification_sent',
  MATCH_THREAD_CREATED: 'match:thread_created',
  MATCH_THREAD_CONVERTED: 'match:thread_converted',
  MATCH_FINISHED: 'match:finished',
  
  // RSVP events
  RSVP_SUBMITTED: 'rsvp:submitted',
  RSVP_UPDATED: 'rsvp:updated',
  RSVP_STATUS_REQUESTED: 'rsvp:status_requested',
  
  // User events
  USER_REGISTERED: 'user:registered',
  USER_LINKED: 'user:linked',
  
  // System events
  BOT_READY: 'system:bot_ready',
  HEALTH_CHECK: 'system:health_check',
  ERROR_OCCURRED: 'system:error',
  
  // Discord events
  BUTTON_INTERACTION: 'discord:button_interaction',
  SLASH_COMMAND: 'discord:slash_command',
  THREAD_JOINED: 'discord:thread_joined'
};

// Create singleton instance
const eventDispatcher = new EventDispatcher();

module.exports = { eventDispatcher, EVENT_TYPES };
