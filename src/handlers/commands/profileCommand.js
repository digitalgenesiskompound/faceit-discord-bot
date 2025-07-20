const { EmbedBuilder } = require('discord.js');

class ProfileCommand {
  constructor(databaseService, discordService) {
    this.db = databaseService;
    this.discordService = discordService;
    this.command = '!profile';
  }

  async handle(message) {
    const userId = message.author.id;
    
    try {
      const mapping = this.db.getUserMappingByDiscordId(userId);
      if (!mapping) {
        await message.reply('❌ You don\'t have a linked FACEIT account. Use `!register` to see available players, then `!link <nickname>` to link your account.');
        return;
      }
      
      const embed = new EmbedBuilder()
        .setTitle('🎮 Your Linked FACEIT Account')
        .setDescription(`**[${mapping.faceit_nickname}](https://www.faceit.com/en/players/${mapping.faceit_nickname})**`)
        .addFields(
          { name: '🏆 Skill Level', value: `${mapping.faceit_skill_level} (${mapping.faceit_elo} ELO)`, inline: true },
          { name: '🌍 Country', value: mapping.country, inline: true },
          { name: '📅 Linked On', value: new Date(mapping.registered_at).toLocaleDateString(), inline: true }
        )
        .setColor(0xff5500)
        .setTimestamp();
      
      await message.reply({ embeds: [embed] });
      
    } catch (err) {
      console.error(`Error handling !profile command: ${err.message}`);
      await message.reply('❌ Sorry, there was an error retrieving your profile.');
    }
  }
}

module.exports = ProfileCommand;
