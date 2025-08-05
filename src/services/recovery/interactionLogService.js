/**
 * Interaction Log Service
 * 
 * Tracks and logs user interactions for recovery purposes.
 * Maintains persistent logs of RSVP actions, registrations, and other critical events.
 */

const fs = require('fs').promises;
const path = require('path');

class InteractionLogService {
  constructor(databaseService) {
    this.db = databaseService;
    this.logFile = path.join(process.cwd(), 'data', 'interaction_log.jsonl');
    
    // Ensure data directory exists
    this.ensureDataDirectory();
  }

  /**
   * Ensure the data directory exists
   */
  async ensureDataDirectory() {
    try {
      const dataDir = path.dirname(this.logFile);
      await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
      console.error('Error creating data directory:', error.message);
    }
  }

  /**
   * Log a user interaction
   * @param {Object} interaction - Interaction data
   */
  async logInteraction(interaction) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        type: interaction.type,
        userId: interaction.userId,
        username: interaction.username,
        data: interaction.data,
        context: interaction.context || {}
      };

      // Append to log file (JSONL format - one JSON object per line)
      await fs.appendFile(this.logFile, JSON.stringify(logEntry) + '\n', 'utf8');
      
      console.log(`📝 Logged interaction: ${interaction.type} for user ${interaction.username}`);
    } catch (error) {
      console.error('Error logging interaction:', error.message);
    }
  }

  /**
   * Log RSVP action
   * @param {string} matchId - Match ID
   * @param {string} userId - Discord user ID
   * @param {string} username - Discord username
   * @param {string} response - RSVP response (yes/no)
   * @param {string} faceitNickname - FACEIT nickname
   */
  async logRsvpAction(matchId, userId, username, response, faceitNickname) {
    await this.logInteraction({
      type: 'rsvp_action',
      userId,
      username,
      data: {
        matchId,
        response,
        faceitNickname
      },
      context: {
        action: 'button_click',
        source: 'discord_thread'
      }
    });
  }

  /**
   * Log user registration/linking
   * @param {string} userId - Discord user ID
   * @param {string} username - Discord username
   * @param {string} faceitNickname - FACEIT nickname
   * @param {Object} faceitData - Additional FACEIT data
   */
  async logUserRegistration(userId, username, faceitNickname, faceitData = {}) {
    await this.logInteraction({
      type: 'user_registration',
      userId,
      username,
      data: {
        faceitNickname,
        faceitPlayerId: faceitData.player_id,
        skillLevel: faceitData.skill_level,
        elo: faceitData.faceit_elo,
        country: faceitData.country
      },
      context: {
        action: 'account_linking',
        source: 'slash_command'
      }
    });
  }

  /**
   * Recover interaction history from log files
   * @param {Object} options - Recovery options
   * @returns {Object} Recovery results
   */
  async recoverInteractionHistory(options = {}) {
    const { scanDepthDays = 30, dryRun = false } = options;
    const cutoffDate = new Date(Date.now() - (scanDepthDays * 24 * 60 * 60 * 1000));

    const results = {
      recovered: 0,
      errors: 0,
      details: []
    };

    try {
      // Check if log file exists
      try {
        await fs.access(this.logFile);
      } catch (accessError) {
        console.log('📝 No interaction log file found - starting fresh');
        return results;
      }

      // Read and parse log file
      const logContent = await fs.readFile(this.logFile, 'utf8');
      const logLines = logContent.trim().split('\n').filter(line => line.trim());

      console.log(`📝 Found ${logLines.length} log entries to process`);

      for (const line of logLines) {
        try {
          const logEntry = JSON.parse(line);
          const entryDate = new Date(logEntry.timestamp);

          // Skip entries older than cutoff
          if (entryDate < cutoffDate) continue;

          // Process different types of interactions
          if (logEntry.type === 'rsvp_action') {
            await this.recoverRsvpFromLog(logEntry, dryRun);
            results.recovered++;
          } else if (logEntry.type === 'user_registration') {
            await this.recoverUserMappingFromLog(logEntry, dryRun);
            results.recovered++;
          }

          results.details.push({
            type: logEntry.type,
            timestamp: logEntry.timestamp,
            userId: logEntry.userId,
            recovered: !dryRun
          });

        } catch (parseError) {
          console.error('Error parsing log entry:', parseError.message);
          results.errors++;
        }
      }

      return results;

    } catch (error) {
      console.error('Error recovering interaction history:', error.message);
      results.errors++;
      return results;
    }
  }

  /**
   * Recover RSVP data from log entry
   * @param {Object} logEntry - Log entry object
   * @param {boolean} dryRun - Whether to actually save the data
   */
  async recoverRsvpFromLog(logEntry, dryRun = false) {
    if (dryRun) return;

    try {
      const { matchId, response, faceitNickname } = logEntry.data;
      const userId = logEntry.userId;

      // Check if RSVP already exists
      const existingRsvp = this.db.getUserRsvp(matchId, userId);
      if (!existingRsvp) {
        await this.db.addRsvp(matchId, userId, response, faceitNickname);
        console.log(`✅ Recovered RSVP from log: ${faceitNickname} -> ${response} for match ${matchId}`);
      }
    } catch (error) {
      console.error('Error recovering RSVP from log:', error.message);
    }
  }

  /**
   * Recover user mapping from log entry
   * @param {Object} logEntry - Log entry object
   * @param {boolean} dryRun - Whether to actually save the data
   */
  async recoverUserMappingFromLog(logEntry, dryRun = false) {
    if (dryRun) return;

    try {
      const userId = logEntry.userId;
      const username = logEntry.username;
      const { faceitNickname, faceitPlayerId, skillLevel, elo, country } = logEntry.data;

      // Check if user mapping already exists
      const existingMapping = await this.db.getUserMappingByDiscordIdFromDB(userId);
      if (!existingMapping) {
        await this.db.addUserMapping(userId, username, {
          nickname: faceitNickname,
          player_id: faceitPlayerId || 'recovered_from_log',
          skill_level: skillLevel || 'Unknown',
          faceit_elo: elo || 'Unknown',
          country: country || 'Unknown'
        });
        console.log(`✅ Recovered user mapping from log: ${username} -> ${faceitNickname}`);
      }
    } catch (error) {
      console.error('Error recovering user mapping from log:', error.message);
    }
  }

  /**
   * Get interaction statistics
   * @param {number} days - Number of days to analyze
   * @returns {Object} Statistics summary
   */
  async getInteractionStats(days = 7) {
    const stats = {
      rsvpActions: 0,
      userRegistrations: 0,
      totalInteractions: 0,
      uniqueUsers: new Set(),
      dailyBreakdown: {}
    };

    try {
      const logContent = await fs.readFile(this.logFile, 'utf8');
      const logLines = logContent.trim().split('\n').filter(line => line.trim());
      const cutoffDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));

      for (const line of logLines) {
        try {
          const logEntry = JSON.parse(line);
          const entryDate = new Date(logEntry.timestamp);

          if (entryDate >= cutoffDate) {
            stats.totalInteractions++;
            stats.uniqueUsers.add(logEntry.userId);

            const dateKey = entryDate.toISOString().split('T')[0];
            if (!stats.dailyBreakdown[dateKey]) {
              stats.dailyBreakdown[dateKey] = { rsvp: 0, registration: 0 };
            }

            if (logEntry.type === 'rsvp_action') {
              stats.rsvpActions++;
              stats.dailyBreakdown[dateKey].rsvp++;
            } else if (logEntry.type === 'user_registration') {
              stats.userRegistrations++;
              stats.dailyBreakdown[dateKey].registration++;
            }
          }
        } catch (parseError) {
          // Skip invalid entries
        }
      }

      stats.uniqueUsers = stats.uniqueUsers.size;
      return stats;

    } catch (error) {
      console.error('Error getting interaction stats:', error.message);
      return stats;
    }
  }

  /**
   * Clean up old log entries
   * @param {number} retentionDays - Number of days to retain
   */
  async cleanupOldLogs(retentionDays = 90) {
    try {
      const logContent = await fs.readFile(this.logFile, 'utf8');
      const logLines = logContent.trim().split('\n').filter(line => line.trim());
      const cutoffDate = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000));

      const keptLines = [];
      let removedCount = 0;

      for (const line of logLines) {
        try {
          const logEntry = JSON.parse(line);
          const entryDate = new Date(logEntry.timestamp);

          if (entryDate >= cutoffDate) {
            keptLines.push(line);
          } else {
            removedCount++;
          }
        } catch (parseError) {
          // Keep lines that can't be parsed to avoid data loss
          keptLines.push(line);
        }
      }

      // Write back the cleaned log
      await fs.writeFile(this.logFile, keptLines.join('\n') + '\n', 'utf8');
      console.log(`🧹 Cleaned up ${removedCount} old log entries (kept ${keptLines.length})`);

    } catch (error) {
      console.error('Error cleaning up old logs:', error.message);
    }
  }
}

module.exports = InteractionLogService;
