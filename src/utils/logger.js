const fs = require('fs');
const path = require('path');

/**
 * Simple Logger - Replaces comprehensiveLogger and complex validation logging
 * Focuses on essential logging with minimal overhead
 */
class Logger {
  constructor() {
    this.logDir = path.join(__dirname, '../../logs');
    this.ensureLogDir();
  }

  ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  formatMessage(level, message, context = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...context
    };
    return JSON.stringify(logEntry);
  }

  writeToFile(filename, content) {
    try {
      const filepath = path.join(this.logDir, filename);
      fs.appendFileSync(filepath, content + '\n');
    } catch (error) {
      console.error('Log write failed:', error.message);
    }
  }

  // Core logging methods
  info(message, context = {}) {
    const formatted = this.formatMessage('INFO', message, context);
    console.log(`ℹ️ ${message}`, context);
    this.writeToFile('bot.log', formatted);
  }

  warn(message, context = {}) {
    const formatted = this.formatMessage('WARN', message, context);
    console.warn(`⚠️ ${message}`, context);
    this.writeToFile('bot.log', formatted);
  }

  error(message, error = null, context = {}) {
    const errorContext = {
      ...context,
      error: error ? {
        message: error.message,
        stack: error.stack
      } : null
    };
    
    const formatted = this.formatMessage('ERROR', message, errorContext);
    console.error(`❌ ${message}`, errorContext);
    this.writeToFile('errors.log', formatted);
    this.writeToFile('bot.log', formatted);
  }

  debug(message, context = {}) {
    if (process.env.NODE_ENV === 'development') {
      const formatted = this.formatMessage('DEBUG', message, context);
      console.log(`🐛 ${message}`, context);
      this.writeToFile('debug.log', formatted);
    }
  }

  // Specific event logging methods (simplified)
  rsvp(action, matchId, context = {}) {
    this.info(`RSVP ${action}`, { matchId, ...context });
  }

  cache(action, key, context = {}) {
    this.debug(`Cache ${action}: ${key}`, context);
  }

  thread(action, threadId, context = {}) {
    this.info(`Thread ${action}`, { threadId, ...context });
  }

  match(action, matchId, context = {}) {
    this.info(`Match ${action}`, { matchId, ...context });
  }

  // Get recent logs (for debugging)
  getRecentLogs(filename = 'bot.log', lines = 50) {
    try {
      const filepath = path.join(this.logDir, filename);
      if (!fs.existsSync(filepath)) return [];

      const content = fs.readFileSync(filepath, 'utf8');
      const logLines = content.trim().split('\n');
      return logLines.slice(-lines).map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return { message: line, timestamp: new Date().toISOString() };
        }
      });
    } catch (error) {
      this.error('Failed to read logs', error);
      return [];
    }
  }

  // Cleanup old logs
  cleanup(daysToKeep = 7) {
    try {
      const files = fs.readdirSync(this.logDir);
      const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

      files.forEach(file => {
        const filepath = path.join(this.logDir, file);
        const stats = fs.statSync(filepath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          fs.unlinkSync(filepath);
          console.log(`🗑️ Cleaned up old log file: ${file}`);
        }
      });
    } catch (error) {
      this.error('Log cleanup failed', error);
    }
  }
}

module.exports = new Logger();
