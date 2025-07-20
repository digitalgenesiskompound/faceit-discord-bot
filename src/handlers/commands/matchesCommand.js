const { EmbedBuilder } = require('discord.js');
const { formatMatchTime } = require('../../utils/helpers');
const faceitService = require('../../services/faceitService');

class MatchesCommand {
  constructor(databaseService, discordService) {
    this.db = databaseService;
    this.discordService = discordService;
    this.command = '!matches';
  }

  async handle(message) {
    try {
      console.log(`User ${message.author.tag} requested matches list`);
      
      const matches = await faceitService.getUpcomingMatches();
      
      if (matches.length === 0) {
        await message.reply('No upcoming matches found for your team.');
        return;
      }
      
      const embed = new EmbedBuilder()
        .setTitle('🎮 Upcoming FACEIT Matches')
        .setColor(0x0099ff)
        .setTimestamp();
      
      let description = '';
      
      matches.forEach((match, index) => {
        const faction1 = match.teams.faction1?.name || 'TBD';
        const faction2 = match.teams.faction2?.name || 'TBD';
        const matchTimes = formatMatchTime(match.scheduled_at);
        const matchUrl = `https://www.faceit.com/en/cs2/room/${match.match_id}`;
        
        // Check if this match has any RSVPs
        const matchRsvps = this.db.getRsvpForMatch(match.match_id);
        const rsvpCount = Object.keys(matchRsvps).length;
        const rsvpIndicator = rsvpCount > 0 ? ` (${rsvpCount} RSVPs)` : '';
        
        description += `**${index + 1}.** ${faction1} vs ${faction2}${rsvpIndicator}\n`;
        description += `📅 ${matchTimes.pacific} / ${matchTimes.mountain}\n`;
        description += `🔗 [View Match](${matchUrl})\n`;
        description += `🆔 Match ID: \`${match.match_id}\`\n\n`;
      });
      
      embed.setDescription(description);
      
      embed.addFields({
        name: '📝 RSVP',
        value: `Use \`!rsvp yes\` or \`!rsvp no\` to RSVP for matches.\n\`!rsvps\` - View all RSVP responses\n\`!status [match_id]\` - View RSVPs for specific match`,
        inline: false,
      });
      
      await message.reply({ embeds: [embed] });
      
    } catch (err) {
      console.error(`Error handling !matches command: ${err.message}`);
      await message.reply('Sorry, there was an error fetching match information.');
    }
  }
}

module.exports = MatchesCommand;
