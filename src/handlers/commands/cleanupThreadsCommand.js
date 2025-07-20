const { EmbedBuilder } = require('discord.js');

class CleanupThreadsCommand {
  constructor(databaseService, discordService) {
    this.db = databaseService;
    this.discordService = discordService;
    this.command = '!cleanup-threads';
  }

  async handle(message) {
    try {
      console.log(`User ${message.author.tag} requested thread cleanup`);
      
      // Check if user has permission (you can adjust this check as needed)
      if (!message.member.permissions.has('MANAGE_CHANNELS')) {
        await message.reply('❌ You need "Manage Channels" permission to use this command.');
        return;
      }

      const statusMessage = await message.reply('🧹 Starting thread cleanup process...');

      // Perform thread cleanup
      const cleanedCount = await this.discordService.cleanupStaleThreads();
      
      const embed = new EmbedBuilder()
        .setTitle('🧹 Thread Cleanup Complete')
        .setDescription(`Cleaned up **${cleanedCount}** stale thread references.`)
        .setColor(cleanedCount > 0 ? 0x00ff00 : 0x0099ff)
        .addFields({
          name: 'What was cleaned up',
          value: cleanedCount > 0 
            ? '• Removed references to archived/locked threads\n• Removed references to deleted threads\n• Database has been updated'
            : '• All thread references are valid\n• No cleanup was needed',
          inline: false
        })
        .addFields({
          name: 'Next Steps',
          value: cleanedCount > 0
            ? 'New notifications for existing matches will now create fresh threads if no active thread exists.'
            : 'Thread management is working normally.',
          inline: false
        })
        .setTimestamp()
        .setFooter({ text: 'Thread cleanup completed' });

      await statusMessage.edit({ 
        content: '', 
        embeds: [embed] 
      });

      console.log(`Thread cleanup completed: ${cleanedCount} stale references removed`);
      
    } catch (err) {
      console.error(`Error handling !cleanup-threads command: ${err.message}`);
      await message.reply('❌ Sorry, there was an error during thread cleanup. Please check the logs.');
    }
  }
}

module.exports = CleanupThreadsCommand;
