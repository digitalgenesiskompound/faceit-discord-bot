const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../config/config');
const rateLimiter = require('../utils/rateLimiter');

class ButtonHandler {
  constructor(client, databaseService, discordService, slashCommandHandler = null) {
    this.client = client;
    this.db = databaseService;
    this.discordService = discordService;
    this.slashCommandHandler = slashCommandHandler;
  }

  /**
   * Handle button interactions
   */
  async handleButtonInteraction(interaction) {
    // Handle registration buttons
    if (interaction.customId.startsWith('register_')) {
      if (!this.slashCommandHandler) {
        await interaction.reply({
          content: '❌ Registration handler not available. Please try again.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      await this.slashCommandHandler.handleRegistrationButton(interaction);
      return;
    }

    // Handle RSVP buttons
    if (!interaction.customId.startsWith('rsvp_')) {
      return;
    }

    try {
      const [, response, matchId] = interaction.customId.split('_');
      const userId = interaction.user.id;
      
      console.log(`Button interaction: ${interaction.user.tag} -> ${response} for match ${matchId}`);
      
      // Handle status button
      if (response === 'status') {
        // Refresh RSVP status for just this specific match (much faster)
        await this.discordService.updateThreadRsvpStatusAsync(matchId);
        // Then handle status button
        await this.handleStatusButton(interaction, matchId);
        return;
      }
      
      // Handle RSVP yes/no responses
      if (response !== 'yes' && response !== 'no') {
        await interaction.reply({ content: '❌ Invalid RSVP response.', flags: MessageFlags.Ephemeral });
        return;
      }
      
      // Check if user is registered - query database directly to avoid cache issues
      const userMapping = await this.db.getUserMappingByDiscordIdFromDB(userId);
      if (!userMapping) {
        await interaction.reply({ 
          content: '❌ You must be linked to a FACEIT account to RSVP. Use `/register` to link your account with one click, or `/link <nickname>` if needed.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      
      // Check if the bot is a member of the thread
      if (interaction.channel && interaction.channel.isThread()) {
        const isBotMember = await this.discordService.checkThreadMembership(interaction.channel);
        if (!isBotMember) {
          console.log(`🤝 Bot is not a member of thread ${interaction.channel.name}, joining...`);
          const joined = await this.discordService.joinThread(interaction.channel);
          if (!joined) {
            await interaction.reply({
              content: '⚠️ There was a problem joining the thread. Please try again later.',
              flags: MessageFlags.Ephemeral
            });
            return;
          }
        }
      }
      
      // Check if user already has an RSVP for this match
      const existingRsvp = this.db.getUserRsvp(matchId, userId);
      
      // Add/update RSVP
      await this.db.addRsvp(matchId, userId, response, userMapping.faceit_nickname);
      
      const responseEmoji = response === 'yes' ? '✅' : '❌';
      const actionText = existingRsvp ? 'updated' : 'recorded';
      
      // Get thread link if available (avoid expensive Discord API call)
      let threadLink = '';
      const threadId = this.db.matchThreads.get(matchId);
      if (threadId && interaction.guild?.id) {
        threadLink = `\n🔗 [View Match Thread](https://discord.com/channels/${interaction.guild.id}/${threadId})`;
      }
      
      // Use rate limiter for interaction replies
      await rateLimiter.enqueue('interaction', async () => {
        return await interaction.reply({ 
          content: `${responseEmoji} Your RSVP has been ${actionText}! **${userMapping.faceit_nickname}** - ${response.toUpperCase()}${threadLink}`, 
          flags: MessageFlags.Ephemeral
        });
      }, 1); // Higher priority for user responses
      
      // Update thread RSVP status
      await this.discordService.updateThreadRsvpStatusAsync(matchId);
      
      console.log(`RSVP ${actionText} via button: ${interaction.user.tag} (${userMapping.faceit_nickname}) -> ${response} for match ${matchId}`);
      
    } catch (err) {
      console.error(`Error handling button interaction: ${err.message}`);
      if (!interaction.replied) {
        await interaction.reply({ content: '❌ Sorry, there was an error processing your RSVP.', flags: MessageFlags.Ephemeral });
      }
    }
  }

  /**
   * Handle the status button click with enhanced display
   */
  async handleStatusButton(interaction, matchId) {
    try {
      // Get match data for context
      const match = this.db.upcomingMatches.get(matchId);
      const matchRsvps = this.db.getRsvpForMatch(matchId);
      const allUserMappings = this.db.userMappings;
      
      // Get all team players from FACEIT using cached data (same as createDynamicRsvpStatus)
      let teamPlayers = [];
      try {
        const timeSensitiveCache = require('../services/timeSensitiveCacheService');
        teamPlayers = await timeSensitiveCache.getTeamPlayersTimeAware(async () => {
          const faceitService = require('../services/faceitService');
          const teamData = await faceitService.makeProtectedApiRequest(
            `https://open.faceit.com/data/v4/teams/${require('../config/config').faceit.teamId}`,
            {},
            {
              operation: 'list_team_players_button',
              teamId: require('../config/config').faceit.teamId
            }
          );
          
          if (teamData && teamData.members) {
            return teamData.members;
          }
          return [];
        });
      } catch (err) {
        console.error(`Error fetching team players: ${err.message}`);
        // Fallback to registered Discord users if FACEIT API fails
        teamPlayers = Object.values(allUserMappings).map(user => ({ nickname: user.faceit_nickname }));
      }
      
      if (teamPlayers.length === 0) {
        await interaction.reply({
          content: '❌ No team players found. Please try again later.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      
      // Create a mapping of FACEIT nicknames to Discord user mappings for quick lookup
      const nicknameToDiscordMapping = new Map();
      Object.values(allUserMappings).forEach(user => {
        nicknameToDiscordMapping.set(user.faceit_nickname, user);
      });
      
      // Categorize players by RSVP status
      const attendingPlayers = [];
      const notAttendingPlayers = [];
      const noResponsePlayers = [];
      
      teamPlayers.forEach(player => {
        const playerNickname = player.nickname;
        const discordUser = nicknameToDiscordMapping.get(playerNickname);
        
        if (discordUser && matchRsvps[discordUser.discord_id]) {
          const rsvp = matchRsvps[discordUser.discord_id];
          if (rsvp.response === 'yes') {
            attendingPlayers.push({
              nickname: playerNickname,
              timestamp: rsvp.timestamp
            });
          } else {
            notAttendingPlayers.push({
              nickname: playerNickname,
              timestamp: rsvp.timestamp
            });
          }
        } else {
          // Player hasn't RSVP'd (either not registered with Discord or no RSVP response)
          noResponsePlayers.push(playerNickname);
        }
      });
      
      // Sort by timestamp (most recent first)
      attendingPlayers.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      notAttendingPlayers.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      const embed = new EmbedBuilder()
        .setTitle('📝 Match RSVP Status')
        .setColor(0x0099ff)
        .setTimestamp();
      
      // Add match context if available
      if (match && match.teams) {
        const faction1 = match.teams.faction1?.name || 'TBD';
        const faction2 = match.teams.faction2?.name || 'TBD';
        embed.setDescription(`**Match:** ${faction1} vs ${faction2}\n**Total Team Players:** ${teamPlayers.length}`);
      } else {
        embed.setDescription(`**Match ID:** \`${matchId}\`\n**Total Team Players:** ${teamPlayers.length}`);
      }
      
      // Add attending players
      if (attendingPlayers.length > 0) {
        const attendingList = attendingPlayers.map(p => p.nickname).join('\n');
        embed.addFields({
          name: `✅ Attending (${attendingPlayers.length})`,
          value: attendingList,
          inline: true
        });
      } else {
        embed.addFields({
          name: '✅ Attending (0)',
          value: 'No players attending yet',
          inline: true
        });
      }
      
      // Add not attending players
      if (notAttendingPlayers.length > 0) {
        const notAttendingList = notAttendingPlayers.map(p => p.nickname).join('\n');
        embed.addFields({
          name: `❌ Not Attending (${notAttendingPlayers.length})`,
          value: notAttendingList,
          inline: true
        });
      } else {
        embed.addFields({
          name: '❌ Not Attending (0)',
          value: 'No declined responses',
          inline: true
        });
      }
      
      // Add no response players (always show, even if empty for completeness)
      if (noResponsePlayers.length > 0) {
        embed.addFields({
          name: `⏳ No Response (${noResponsePlayers.length})`,
          value: noResponsePlayers.join('\n'),
          inline: true
        });
      } else {
        embed.addFields({
          name: '⏳ No Response (0)',
          value: 'All players have responded',
          inline: true
        });
      }
      
      // Add summary statistics
      const responseRate = teamPlayers.length > 0 ? 
        Math.round(((attendingPlayers.length + notAttendingPlayers.length) / teamPlayers.length) * 100) : 0;
      
      embed.addFields({
        name: '📊 Summary',
        value: `**Response Rate:** ${responseRate}% (${attendingPlayers.length + notAttendingPlayers.length}/${teamPlayers.length})\n**Latest Update:** <t:${Math.floor(Date.now() / 1000)}:R>`,
        inline: false
      });
      
      // Add refresh button
      const refreshRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`rsvp_status_${matchId}`)
            .setLabel('🔄 Refresh Status')
            .setStyle(ButtonStyle.Secondary)
        );
      
      // Use rate limiter for status responses
      await rateLimiter.enqueue('interaction', async () => {
        return await interaction.reply({ 
          embeds: [embed], 
          components: [refreshRow],
          flags: MessageFlags.Ephemeral
        });
      }, 0); // Normal priority
      
    } catch (err) {
      console.error(`Error handling status button: ${err.message}`);
      await interaction.reply({ 
        content: '❌ Sorry, there was an error retrieving RSVP status.', 
        flags: MessageFlags.Ephemeral
      });
    }
  }

}

module.exports = ButtonHandler;
