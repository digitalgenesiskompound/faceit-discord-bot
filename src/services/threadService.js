const { formatMatchTime } = require('../utils/helpers');
const config = require('../config/config');
const cache = require('./cache');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Thread Service - Handles Discord thread operations
 * Extracted from discordService.js for better separation of concerns
 */
class ThreadService {
  constructor(client, databaseService) {
    this.client = client;
    this.db = databaseService;
  }

  /**
   * Create a new thread for a match
   */
  async createMatchThread(match, type = 'upcoming') {
    try {
      if (!match || !match.teams || !match.teams.faction1 || !match.teams.faction2) {
        throw new Error('Invalid match data for thread creation');
      }

      const faction1 = match.teams.faction1.name;
      const faction2 = match.teams.faction2.name;
      const matchTimes = formatMatchTime(match.scheduled_at);
      
      const targetChannel = this.client.channels.cache.get(config.discord.channelId);
      if (!targetChannel) {
        throw new Error('Could not find target channel for thread creation');
      }

      // Create thread name based on type
      let threadName;
      if (type === 'result') {
        threadName = `RESULT: ${faction1} vs ${faction2}`;
      } else {
        threadName = `INCOMING: ${matchTimes.mountain} - ${faction1} vs ${faction2}`;
      }

      // Create the thread
      const thread = await targetChannel.threads.create({
        name: threadName,
        autoArchiveDuration: 60,
        type: 11, // GUILD_PUBLIC_THREAD
        reason: `Thread for match: ${faction1} vs ${faction2}`
      });

// Add Analyze button for INCOMING threads
      if (type === 'upcoming') {
        const analyzeButtonRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`analyze_enemy_${match.match_id}`)
              .setLabel('Analyze')
              .setStyle(ButtonStyle.Primary)
          );
          
        await thread.send({
          content: 'Analyze the enemy team!',
          components: [analyzeButtonRow]
        });
      }

      // Store thread reference in database
      await this.db.addMatchThread(match.match_id, thread.id, type);
      
      console.log(`✅ Created ${type} thread: ${thread.name}`);
      return thread;

    } catch (error) {
      console.error(`❌ Error creating ${type} thread:`, error.message);
      throw error;
    }
  }

  /**
   * Convert an INCOMING thread to RESULT thread
   */
  async convertToResultThread(matchId, finishedMatch) {
    try {
      const threadId = this.db.matchThreads.get(matchId);
      if (!threadId) {
        throw new Error(`No thread found for match ${matchId}`);
      }

      const thread = await this.client.channels.fetch(threadId);
      if (!thread) {
        throw new Error(`Could not fetch thread ${threadId}`);
      }

      // Skip if already a result thread
      if (thread.name && thread.name.startsWith('RESULT:')) {
        console.log(`Thread ${threadId} is already a result thread`);
        return thread;
      }

      const faction1 = finishedMatch.teams.faction1.name;
      const faction2 = finishedMatch.teams.faction2.name;
      
      // Get score if available
      let scoreText = '';
      if (finishedMatch.results && finishedMatch.results.score) {
        const score1 = finishedMatch.results.score.faction1 || 0;
        const score2 = finishedMatch.results.score.faction2 || 0;
        scoreText = ` (${score1}-${score2})`;
      }

      // Update thread name
      const newName = `RESULT: ${faction1} vs ${faction2}${scoreText}`;
      await thread.setName(newName);

      // Update database record
      await this.db.updateMatchThreadType(matchId, 'result');

      console.log(`🏆 Converted thread to result: ${newName}`);
      return thread;

    } catch (error) {
      console.error(`❌ Error converting thread to result:`, error.message);
      throw error;
    }
  }

  /**
   * Archive old threads
   */
  async archiveOldThreads(daysOld = 7) {
    try {
      console.log(`🗃️ Archiving threads older than ${daysOld} days...`);
      
      const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
      let archivedCount = 0;

      for (const [matchId, threadId] of this.db.matchThreads.entries()) {
        try {
          const thread = await this.client.channels.fetch(threadId);
          if (!thread) continue;

          // Check if thread is old enough
          if (thread.createdTimestamp < cutoffTime) {
            await thread.setArchived(true);
            archivedCount++;
            console.log(`📦 Archived old thread: ${thread.name}`);
          }
        } catch (error) {
          console.error(`Error archiving thread ${threadId}:`, error.message);
        }
      }

      console.log(`✅ Archived ${archivedCount} old threads`);
      return archivedCount;

    } catch (error) {
      console.error('❌ Error archiving old threads:', error.message);
      throw error;
    }
  }

  /**
   * Get thread by match ID
   */
  async getThreadByMatchId(matchId) {
    try {
      const threadId = this.db.matchThreads.get(matchId);
      if (!threadId) {
        return null;
      }

      const thread = await this.client.channels.fetch(threadId);
      return thread;
    } catch (error) {
      console.error(`Error fetching thread for match ${matchId}:`, error.message);
      return null;
    }
  }

  /**
   * Update thread with new match information
   */
  async updateThreadInfo(matchId, updatedMatch) {
    try {
      const thread = await this.getThreadByMatchId(matchId);
      if (!thread) {
        console.log(`No thread found for match ${matchId} to update`);
        return;
      }

      const faction1 = updatedMatch.teams.faction1.name;
      const faction2 = updatedMatch.teams.faction2.name;

      // Update thread name if match is finished
      if (updatedMatch.status === 'FINISHED') {
        await this.convertToResultThread(matchId, updatedMatch);
      } else {
        // Update upcoming thread name with new time if needed
        const matchTimes = formatMatchTime(updatedMatch.scheduled_at);
        const newName = `INCOMING: ${matchTimes.mountain} - ${faction1} vs ${faction2}`;
        
        if (thread.name !== newName) {
          await thread.setName(newName);
          console.log(`📝 Updated thread name: ${newName}`);
        }
      }

    } catch (error) {
      console.error(`Error updating thread info for match ${matchId}:`, error.message);
    }
  }

  /**
   * Create missing thread for existing match
   */
  async createMissingThread(match, type = 'upcoming') {
    try {
      console.log(`🔧 Creating missing ${type} thread for match ${match.match_id}`);
      
      // Check if thread already exists to avoid duplicates
      const existingThread = await this.getThreadByMatchId(match.match_id);
      if (existingThread) {
        console.log(`Thread already exists for match ${match.match_id}`);
        return existingThread;
      }

      // Create the thread
      const thread = await this.createMatchThread(match, type);
      
      console.log(`✅ Created missing ${type} thread for match ${match.match_id}`);
      return thread;

    } catch (error) {
      console.error(`Error creating missing thread:`, error.message);
      throw error;
    }
  }

  /**
   * Clean up orphaned thread references
   */
  async cleanupOrphanedThreads() {
    try {
      console.log('🧹 Cleaning up orphaned thread references...');
      
      let cleanedCount = 0;
      const threadEntries = Array.from(this.db.matchThreads.entries());

      for (const [matchId, threadId] of threadEntries) {
        try {
          const thread = await this.client.channels.fetch(threadId);
          if (!thread) {
            // Thread doesn't exist anymore, remove from database
            this.db.matchThreads.delete(matchId);
            cleanedCount++;
            console.log(`🗑️ Removed orphaned thread reference: ${matchId} -> ${threadId}`);
          }
        } catch (error) {
          // Thread fetch failed, likely deleted
          this.db.matchThreads.delete(matchId);
          cleanedCount++;
          console.log(`🗑️ Removed orphaned thread reference: ${matchId} -> ${threadId}`);
        }
      }

      console.log(`✅ Cleaned up ${cleanedCount} orphaned thread references`);
      return cleanedCount;

    } catch (error) {
      console.error('❌ Error cleaning up orphaned threads:', error.message);
      throw error;
    }
  }
}

module.exports = ThreadService;
