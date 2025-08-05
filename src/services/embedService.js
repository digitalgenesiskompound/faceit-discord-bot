const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { formatMatchTime } = require('../utils/helpers');
const config = require('../config/config');

/**
 * Embed Service - Handles Discord embed creation operations
 * Extracted from discordService.js for better separation of concerns
 */
class EmbedService {

  /**
   * Create a match notification embed
   * @param {Object} match - Match details
   * @returns {EmbedBuilder} - Match embed
   */
  createMatchEmbed(match) {
    const faction1 = match.teams.faction1.name;
    const faction2 = match.teams.faction2.name;
    const matchTimes = formatMatchTime(match.scheduled_at);
    const matchUrl = `https://www.faceit.com/en/cs2/room/${match.match_id}`;

    return new EmbedBuilder()
      .setTitle(`🎮 ${faction1} vs ${faction2}`)
      .setDescription(`🔗 **[Join Match Room](${matchUrl})**\n\n⏰ **Match Times:**\n${matchTimes.pacific}\n${matchTimes.mountain}`)
      .setColor(0x00ff00)
      .setTimestamp();
  }

  /**
   * Create RSVP buttons for a match
   * @param {string} matchId - Match ID
   * @returns {ActionRowBuilder[]} - Array of ActionRowBuilder with buttons
   */
  createRsvpButtons(matchId) {
    const rsvpRow = new ActionRowBuilder()
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

    const statusRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`rsvp_status_${matchId}`)
          .setLabel('📋 View RSVPs')
          .setStyle(ButtonStyle.Secondary)
      );

    return [rsvpRow, statusRow];
  }

  /**
   * Create a simple RSVP chart for a match
   * @param {string} matchId - Match ID
   * @returns {string} - RSVP chart
   */
  createSimpleRsvpChart(matchId) {
    // Create a chart based on RSVP data extracted (mocked here)
    return `✅ Attending: Player1, Player2\n❌ Not Attending: Player3\n⏳ No Response: Player4, Player5`;
  }
}

module.exports = new EmbedService();
