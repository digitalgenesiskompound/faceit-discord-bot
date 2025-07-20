const { EmbedBuilder } = require('discord.js');
const faceitService = require('../../services/faceitService');

class LinkCommand {
  constructor(databaseService, discordService) {
    this.db = databaseService;
    this.discordService = discordService;
    this.command = '!link';
  }

  async handle(message) {
    const args = message.content.split(' ');
    const userId = message.author.id;
    
    if (args.length < 2) {
      await message.reply('❌ Please provide a player nickname. Usage: `!link <nickname>`\nExample: `!link john123`');
      return;
    }
    
    const nickname = args[1];
    
    try {
      console.log(`User ${message.author.tag} linking to FACEIT account: ${nickname}`);
      
      // Check if the Discord user is already linked
      const existingMapping = this.db.getUserMappingByDiscordId(userId);
      if (existingMapping) {
        await message.reply(`❌ You are already linked to FACEIT account **${existingMapping.faceit_nickname}**. Use \`!unlink\` first if you want to link a different account.`);
        return;
      }

      // Validate the FACEIT account by nickname
      const playerData = await faceitService.getPlayerByNickname(nickname);
      if (!playerData) {
        await message.reply('❌ FACEIT account not found. Please make sure the nickname is correct.');
        return;
      }

      // Check if FACEIT account is already mapped
      const duplicateMapping = this.db.isFaceitAccountMapped(playerData.player_id);
      if (duplicateMapping) {
        await message.reply('❌ This FACEIT account is already linked to another Discord user.');
        return;
      }

      // Create the mapping
      await this.db.addUserMapping(userId, message.author.username, playerData);

      const embed = new EmbedBuilder()
        .setTitle('✅ FACEIT Account Linked Successfully!') 
        .setDescription(`Your Discord account has been linked to FACEIT account **${playerData.nickname}**`)
        .addFields(
          { name: '🏆 Skill Level', value: `${playerData.skill_level || 'N/A'} (${playerData.faceit_elo || 'N/A'} ELO)`, inline: true },
          { name: '🌍 Country', value: playerData.country || 'Unknown', inline: true }
        )
        .setColor(0x00ff00)
        .setTimestamp();

      await message.reply({ embeds: [embed] });

      console.log(`Successfully linked user ${message.author.tag} to FACEIT account ${playerData.nickname}`);

    } catch (err) {
      console.error(`Error handling !link command: ${err.message}`);
      await message.reply('❌ Sorry, there was an error linking your FACEIT account.');
    }
  }
}

module.exports = LinkCommand;
