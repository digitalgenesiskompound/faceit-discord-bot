const { EmbedBuilder } = require('discord.js');

class StatusCommand {
  constructor(databaseService, discordService) {
    this.db = databaseService;
    this.discordService = discordService;
    this.command = '!status';
  }

  async handle(message) {
    const args = message.content.split(' ');
    
    if (args.length < 2) {
      await message.reply('❌ Please provide a match ID. Usage: `!status <match_id>`\nExample: `!status 1-abc123def-456789`');
      return;
    }
    
    const matchId = args[1];
    
    try {
      console.log(`User ${message.author.tag} requested RSVP status for match ${matchId}`);
      
      const matchRsvps = this.db.getRsvpForMatch(matchId);
      
      if (Object.keys(matchRsvps).length === 0) {
        await message.reply(`📝 No RSVPs found for match ID: \`${matchId}\`\n\nThis could mean:\n• The match ID doesn't exist\n• No one has RSVP'd for this match yet`);
        return;
      }
      
      const yesRsvps = [];
      const noRsvps = [];
      
      for (const [discordId, rsvpData] of Object.entries(matchRsvps)) {
        const entry = `${rsvpData.faceit_nickname}`;
        if (rsvpData.response === 'yes') {
          yesRsvps.push(entry);
        } else {
          noRsvps.push(entry);
        }
      }
      
      const embed = new EmbedBuilder()
        .setTitle('📝 Match RSVP Status')
        .setDescription(`RSVP status for match ID: \`${matchId}\``)
        .setColor(0x0099ff)
        .setTimestamp();
      
      if (yesRsvps.length > 0) {
        embed.addFields({
          name: '✅ Attending',
          value: yesRsvps.join('\n'),
          inline: true
        });
      }
      
      if (noRsvps.length > 0) {
        embed.addFields({
          name: '❌ Not Attending',
          value: noRsvps.join('\n'),
          inline: true
        });
      }
      
      embed.addFields({
        name: 'Total Responses',
        value: `${Object.keys(matchRsvps).length} player(s)`,
        inline: false
      });
      
      await message.reply({ embeds: [embed] });
      
    } catch (err) {
      console.error(`Error handling !status command: ${err.message}`);
      await message.reply('❌ Sorry, there was an error retrieving RSVP status for that match.');
    }
  }
}

module.exports = StatusCommand;
