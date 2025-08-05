/**
 * Utility to handle match rescheduling detection and updates
 */
class RescheduleHandler {
  constructor(databaseService, discordService) {
    this.db = databaseService;
    this.discordService = discordService;
    
    // Import unified cache service for invalidation
    this.cache = require('../services/cache');
  }

  /**
   * Check if a match has been rescheduled by comparing stored vs current scheduled_at
   */
  async detectReschedule(match) {
    try {
      // Get the last known scheduled time from cache or database
      const cachedMatch = this.db.upcomingMatches.get(match.match_id);
      
      if (cachedMatch && cachedMatch.scheduled_at !== match.scheduled_at) {
console.log(`🔄 Detected reschedule for match ${match.match_id}`);
        return {
          isRescheduled: true,
          oldTime: cachedMatch.scheduled_at,
          newTime: match.scheduled_at,
          matchId: match.match_id
        };
      }
      
      return { isRescheduled: false };
    } catch (error) {
      console.error(`Error detecting reschedule for match ${match.match_id}: ${error.message}`);
      return { isRescheduled: false };
    }
  }

  /**
   * Handle a rescheduled match by updating thread and notifying users
   */
  async handleReschedule(match, rescheduleInfo) {
    try {
      console.log(`🔄 Handling reschedule for match ${match.match_id}`);
      
      // 1. Update the cached match data
      this.db.upcomingMatches.set(match.match_id, match);
      
      // 2. Invalidate match-related caches due to reschedule
    await this.cache.invalidate(match.match_id);
      console.log(`🗑️ Invalidated caches for rescheduled match ${match.match_id}`);
      
      // 3. Find and update the existing thread
      const threadId = this.db.matchThreads.get(match.match_id);
      if (threadId) {
        await this.updateThreadForReschedule(threadId, match, rescheduleInfo);
      }
      
      // 4. Send reschedule notification to the channel
      await this.sendRescheduleNotification(match, rescheduleInfo);
      
      console.log(`✅ Successfully handled reschedule for match ${match.match_id}`);
      
    } catch (error) {
      console.error(`Error handling reschedule for match ${match.match_id}: ${error.message}`);
    }
  }

  /**
   * Update existing thread with new match time
   */
  async updateThreadForReschedule(threadId, match, rescheduleInfo) {
    try {
      const thread = await this.discordService.client.channels.fetch(threadId);
      if (!thread) return;

      // Send reschedule update message to the thread
      const { formatMatchTime } = require('./helpers');
      const oldTimes = formatMatchTime(rescheduleInfo.oldTime);
      const newTimes = formatMatchTime(rescheduleInfo.newTime);
      
      const rescheduleEmbed = {
        title: '🔄 Match Rescheduled',
        description: `**${match.teams.faction1.name} vs ${match.teams.faction2.name}**\n\n` +
          `~~⏰ **Old Time:** ${oldTimes.pacific} / ${oldTimes.mountain}~~\n` +
          `⏰ **New Time:** ${newTimes.pacific} / ${newTimes.mountain}\n\n` +
          `🔗 [Join Match Room](https://www.faceit.com/en/cs2/room/${match.match_id})`,
        color: 0xff9500, // Orange for reschedule
        timestamp: new Date().toISOString(),
        footer: { text: `Match ID: ${match.match_id}` }
      };

      await thread.send({ embeds: [rescheduleEmbed] });
      
      // Update the RSVP status message with new times
      await this.discordService.updateThreadRsvpStatus(match.match_id, thread);
      
    } catch (error) {
      console.error(`Error updating thread for reschedule: ${error.message}`);
    }
  }

  /**
   * Send reschedule notification to main channel
   */
  async sendRescheduleNotification(match, rescheduleInfo) {
    try {
      const channel = this.discordService.client.channels.cache.get(
        require('../config/config').discord.channelId
      );
      
      if (!channel) return;

      const { formatMatchTime } = require('./helpers');
      const oldTimes = formatMatchTime(rescheduleInfo.oldTime);
      const newTimes = formatMatchTime(rescheduleInfo.newTime);
      
      const notification = {
        title: '🔄 Match Rescheduled',
        description: `**${match.teams.faction1.name} vs ${match.teams.faction2.name}** has been rescheduled!\n\n` +
          `~~⏰ **Old Time:** ${oldTimes.pacific} / ${oldTimes.mountain}~~\n` +
          `⏰ **New Time:** ${newTimes.pacific} / ${newTimes.mountain}\n\n` +
          `Please update your availability if needed.`,
        color: 0xff9500,
        timestamp: new Date().toISOString()
      };

      await channel.send({ embeds: [notification] });
      
    } catch (error) {
      console.error(`Error sending reschedule notification: ${error.message}`);
    }
  }
}

module.exports = RescheduleHandler;
