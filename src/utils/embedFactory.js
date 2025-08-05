const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { formatMatchTime } = require('./helpers');
const config = require('../config/config');

/**
 * Factory for creating standardized Discord embeds
 * Centralizes embed creation to reduce duplication
 */
class EmbedFactory {
  /**
   * Create match notification embed
   */
  static createMatchNotificationEmbed(match, rsvpChart) {
    const faction1 = match.teams.faction1.name;
    const faction2 = match.teams.faction2.name;
    const matchTimes = formatMatchTime(match.scheduled_at);
    const matchUrl = `https://www.faceit.com/en/cs2/room/${match.match_id}`;

    return new EmbedBuilder()
      .setTitle(`🎮 ${faction1} vs ${faction2}`)
      .setDescription(`🔗 **[Join Match Room](${matchUrl})**\n\n⏰ **Match Times:**\n${matchTimes.pacific}\n${matchTimes.mountain}\n\n📋 **Team RSVP Status:**\n${rsvpChart}`)
      .setColor(0x00ff00)
      .setTimestamp();
  }

  /**
   * Create RSVP status embed for threads
   */
  static createRsvpStatusEmbed(match, rsvpStatus) {
    const faction1 = match.teams.faction1.name;
    const faction2 = match.teams.faction2.name;
    const matchTimes = formatMatchTime(match.scheduled_at);
    const matchUrl = `https://www.faceit.com/en/cs2/room/${match.match_id}`;

    return new EmbedBuilder()
      .setTitle(`📋 ${faction1} vs ${faction2} - RSVP Status`)
      .setDescription(`⏰ ${matchTimes.pacific}\n⏰ ${matchTimes.mountain}\n\n🔗 [Join Match Room](${matchUrl})\n\n**Current RSVPs:**\n${rsvpStatus}`)
      .setColor(0x1e88e5)
      .setTimestamp()
      .setFooter({ text: `Match ID: ${match.match_id}` });
  }

  /**
   * Create match result embed
   */
  static createMatchResultEmbed(match, winner, result, matchDate) {
    const faction1 = match.teams.faction1.name;
    const faction2 = match.teams.faction2.name;
    const matchUrl = `https://www.faceit.com/en/cs2/room/${match.match_id}`;
    
    // Determine if we won or lost
    const isOurTeam = (team) => team?.faction_id === config.faceit.teamId;
    const isWinnerOurTeam = (isOurTeam(match.teams.faction1) && winner === faction1) || 
                           (isOurTeam(match.teams.faction2) && winner === faction2);
    
    let resultColor = 0x808080; // Default gray
    let resultIcon = '⚪';
    
    if (winner) {
      if (isWinnerOurTeam) {
        resultColor = 0x00ff00; // Green for win
        resultIcon = '🏆';
      } else {
        resultColor = 0xff0000; // Red for loss
        resultIcon = '💔';
      }
    }
    
    const embed = new EmbedBuilder()
      .setTitle(`${resultIcon} ${faction1} vs ${faction2} - Match Complete`)
      .setDescription(`🔗 **[View Match Details](${matchUrl})**\n\n📅 **Match Date:** ${matchDate}\n🏟️ **Competition:** ${match.competition_name || 'FACEIT Match'}\n\n**📊 Final Result:**\n${result}`)
      .setColor(resultColor)
      .setTimestamp()
      .setFooter({ text: `Match ID: ${match.match_id}` });
    
    // Add winner field if we have one
    if (winner) {
      embed.addFields({
        name: '🎉 Winner',
        value: `**${winner}**`,
        inline: true
      });
    }
    
    // Add match duration if available
    if (match.started_at && match.finished_at) {
      const durationMs = (match.finished_at - match.started_at) * 1000;
      const durationMinutes = Math.round(durationMs / (1000 * 60));
      embed.addFields({
        name: '⏱️ Match Duration',
        value: `${durationMinutes} minutes`,
        inline: true
      });
    }
    
    return embed;
  }

  /**
   * Create error notification embed
   */
  static createErrorEmbed(title, description, isEphemeral = true) {
    return new EmbedBuilder()
      .setTitle(`❌ ${title}`)
      .setDescription(description)
      .setColor(0xff0000)
      .setTimestamp();
  }

  /**
   * Create success notification embed
   */
  static createSuccessEmbed(title, description) {
    return new EmbedBuilder()
      .setTitle(`✅ ${title}`)
      .setDescription(description)
      .setColor(0x00ff00)
      .setTimestamp();
  }

  /**
   * Create warning notification embed
   */
  static createWarningEmbed(title, description) {
    return new EmbedBuilder()
      .setTitle(`⚠️ ${title}`)
      .setDescription(description)
      .setColor(0xffa500)
      .setTimestamp();
  }
}

/**
 * Factory for creating standardized button components
 */
class ButtonFactory {
  /**
   * Create RSVP button row
   */
  static createRsvpButtons(matchId) {
    return new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`rsvp_yes_${matchId}`)
          .setLabel('✅ Attending')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`rsvp_no_${matchId}`)
          .setLabel('❌ Not Attending')
          .setStyle(ButtonStyle.Danger)
      );
  }

  /**
   * Create status button row
   */
  static createStatusButtons(matchId) {
    return new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`rsvp_status_${matchId}`)
          .setLabel('📋 View RSVPs')
          .setStyle(ButtonStyle.Secondary)
      );
  }

  /**
   * Create combined RSVP and status buttons
   */
  static createFullRsvpButtons(matchId) {
    return new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`rsvp_yes_${matchId}`)
          .setLabel('✅ Attending')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`rsvp_no_${matchId}`)
          .setLabel('❌ Not Attending')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`rsvp_status_${matchId}`)
          .setLabel('📋 View RSVPs')
          .setStyle(ButtonStyle.Secondary)
      );
  }
}

module.exports = { EmbedFactory, ButtonFactory };

