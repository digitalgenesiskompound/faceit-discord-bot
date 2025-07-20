const { EmbedBuilder } = require('discord.js');
const faceitService = require('../../services/faceitService');

class ListPlayersCommand {
  constructor(databaseService, discordService) {
    this.db = databaseService;
    this.discordService = discordService;
    this.command = '!listplayers';
  }

  async handle(message) {
    try {
      console.log(`User ${message.author.tag} requested team players list`);
      const players = await faceitService.listTeamPlayers();

      if (players.length === 0) {
        await message.reply('❌ No players found for your team.');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🎮 Team Players')
        .setColor(0x0099ff)
        .setTimestamp();

      players.forEach((player, index) => {
        embed.addFields({ name: `${index + 1}. ${player.nickname}`, value: `Player ID: ${player.user_id}`, inline: false });
      });

      await message.reply({ embeds: [embed] });
      console.log(`Displayed ${players.length} team players to user ${message.author.tag}`);

    } catch (err) {
      console.error(`Error handling !listplayers command: ${err.message}`);
      await message.reply('❌ Sorry, there was an error fetching the player list.');
    }
  }
}

module.exports = ListPlayersCommand;
