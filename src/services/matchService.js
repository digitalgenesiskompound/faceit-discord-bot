const config = require('../config/config');

/**
 * Match Service - Handles match-specific operations
 * Extracted from discordService.js for better separation of concerns
 */
class MatchService {
  constructor(client, databaseService) {
    this.client = client;
    this.db = databaseService;
  }

  /**
   * Send a match notification,
   * create a thread for discussion if it doesn't already exist
   * @param {Object} match - Match details
   * @param {import('./embedService')} embedService - Embed service for creating embeds
   * @param {import('./threadService')} threadService - Thread service for managing threads
   */
  async notifyMatch(match, embedService, threadService) {
    try {
      const targetChannel = this.client.channels.cache.get(config.discord.channelId);
      if (!targetChannel) {
        throw new Error('Could not find target channel for match notification');
      }

      // Avoid duplicate threads
      const hasThread = await this.db.hasAnyMatchThread(match.match_id);
      if (hasThread) {
        console.log(`Thread already exists for match ${match.match_id}, skipping notification`);
        return;
      }

      // Send match notification
      const embed = embedService.createMatchEmbed(match);
      const buttons = embedService.createRsvpButtons(match.match_id);
      const message = await targetChannel.send({
        embeds: [embed],
        components: buttons
      });

      // Create a dedicated thread for the match
      const thread = await threadService.createMatchThread(match);

      console.log(`🔔 Sent notification for match: ${match.match_id}`);
      return { message, thread };

    } catch (error) {
      console.error(`❌ Error notifying match:`, error.message);
      throw error;
    }
  }

  /**
   * Update match information and notify changes
   * @param {Object} match - Match details
   * @param {Object} freshMatchDetails - Fresh match details from API
   * @param {import('./embedService')} embedService - Embed service for creating embeds
   * @param {import('./threadService')} threadService - Thread service for managing threads
   */
  async updateMatchInfo(match, freshMatchDetails, embedService, threadService) {
    try {
      const existingThread = await threadService.getThreadByMatchId(match.match_id);
      if (!existingThread) {
        console.log(`No existing thread for match ${match.match_id}`);
        return;
      }

      // Update thread with new information
      await threadService.updateThreadInfo(match.match_id, freshMatchDetails);

      console.log(`✏️ Updated match info for: ${match.match_id}`);
    } catch (error) {
      console.error(`❌ Error updating match info for ${match.match_id}:`, error.message);
      throw error;
    }
  }

  /**
   * Handle match completion and convert thread if needed
   * @param {Object} match - Match details
   * @param {import('./threadService')} threadService - Thread service for managing threads
   */
  async handleMatchCompletion(match, threadService) {
    try {
      const existingThread = await threadService.getThreadByMatchId(match.match_id);
      if (!existingThread) {
        console.log(`No existing thread for match ${match.match_id}`);
        return;
      }

      // Convert the thread to a result type if finished
      await threadService.convertToResultThread(match.match_id, match);

      console.log(`🏁 Handled match completion for: ${match.match_id}`);
    } catch (error) {
      console.error(`❌ Error handling match completion for ${match.match_id}:`, error.message);
      throw error;
    }
  }
}

module.exports = MatchService;
