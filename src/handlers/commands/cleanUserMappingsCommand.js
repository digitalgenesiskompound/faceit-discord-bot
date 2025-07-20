const { EmbedBuilder } = require('discord.js');
const config = require('../../config/config');

class CleanUserMappingsCommand {
  constructor(databaseService, discordService) {
    this.db = databaseService;
    this.discordService = discordService;
    this.command = '!clean user_mappings';
    this.adminOnly = true;
  }

  async handle(message) {
    // Check if user is admin
    if (message.author.id !== config.adminDiscordId) {
      await message.reply('❌ This command requires administrator permissions.');
      return;
    }

    try {
      console.log(`Admin ${message.author.tag} is cleaning user mappings...`);
      
      // Get current count
      const currentCount = Object.keys(this.db.userMappings).length;
      
      // Clear user mappings from memory
      this.db.userMappings = {};
      
      // Clear user mappings from database
      await this.db.db.clearAllUserMappings();
      
      const embed = new EmbedBuilder()
        .setTitle('🧹 User Mappings Cleaned')
        .setDescription(`Successfully cleared all user mapping data.`)
        .addFields(
          { name: 'Records Removed', value: `${currentCount}`, inline: true },
          { name: 'Status', value: 'Complete', inline: true }
        )
        .setColor(0xff9900)
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      console.log(`Cleaned ${currentCount} user mappings`);
      
    } catch (err) {
      console.error(`Error handling !clean user_mappings command: ${err.message}`);
      await message.reply('❌ Sorry, there was an error cleaning the user mappings.');
    }
  }
}

module.exports = CleanUserMappingsCommand;
