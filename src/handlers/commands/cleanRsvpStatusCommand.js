const { EmbedBuilder } = require('discord.js');
const config = require('../../config/config');

class CleanRsvpStatusCommand {
  constructor(databaseService, discordService) {
    this.db = databaseService;
    this.discordService = discordService;
    this.command = '!clean rsvp_status';
    this.adminOnly = true;
  }

  async handle(message) {
    // Check if user is admin
    if (message.author.id !== config.adminDiscordId) {
      await message.reply('❌ This command requires administrator permissions.');
      return;
    }

    try {
      console.log(`Admin ${message.author.tag} is cleaning RSVP status...`);
      
      // Get current count
      let totalRsvpCount = 0;
      const matchCount = Object.keys(this.db.rsvpStatus).length;
      
      for (const matchId in this.db.rsvpStatus) {
        totalRsvpCount += Object.keys(this.db.rsvpStatus[matchId]).length;
      }
      
      // Store thread info before clearing
      const activeThreads = Array.from(this.db.matchThreads.entries());
      
      // Clear RSVP status from memory
      this.db.rsvpStatus = {};
      
      // Clear RSVP status from database
      await this.db.db.clearAllRsvpData();
      
      // Refresh threads with empty RSVP status
      let refreshedThreads = 0;
      for (const [matchId, threadId] of activeThreads) {
        try {
          const thread = await this.discordService.getThread(threadId);
          if (thread) {
            // Post a message to the thread indicating RSVP reset
            const resetEmbed = new EmbedBuilder()
              .setTitle('🔄 RSVP Status Reset')
              .setDescription('RSVP data has been cleared by an administrator. You can re-RSVP using the buttons in the main channel.')
              .setColor(0xff9900)
              .setTimestamp();
              
            await thread.send({ embeds: [resetEmbed] });
            refreshedThreads++;
          }
        } catch (threadErr) {
          console.warn(`Could not refresh thread ${threadId}: ${threadErr.message}`);
        }
      }
      
      const embed = new EmbedBuilder()
        .setTitle('🧹 RSVP Status Cleaned')
        .setDescription(`Successfully cleared all RSVP status data and refreshed active threads.`)
        .addFields(
          { name: 'Matches Cleared', value: `${matchCount}`, inline: true },
          { name: 'RSVPs Removed', value: `${totalRsvpCount}`, inline: true },
          { name: 'Threads Refreshed', value: `${refreshedThreads}/${activeThreads.length}`, inline: true }
        )
        .setColor(0xff9900)
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      console.log(`Cleaned ${totalRsvpCount} RSVPs from ${matchCount} matches, refreshed ${refreshedThreads} threads`);
      
    } catch (err) {
      console.error(`Error handling !clean rsvp_status command: ${err.message}`);
      await message.reply('❌ Sorry, there was an error cleaning the RSVP status.');
    }
  }
}

module.exports = CleanRsvpStatusCommand;
