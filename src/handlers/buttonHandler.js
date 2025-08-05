const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../config/config');
const InteractionLogService = require('../services/recovery/interactionLogService');

class ButtonHandler {
  constructor(client, databaseService, discordService, slashCommandHandler = null) {
    this.client = client;
    this.db = databaseService;
    this.discordService = discordService;
    this.slashCommandHandler = slashCommandHandler;
    
    // Initialize interaction logging
    this.interactionLog = new InteractionLogService(databaseService);
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

    // Handle analyze enemy buttons
    if (interaction.customId.startsWith('analyze_enemy_')) {
      await this.handleAnalyzeEnemyButton(interaction);
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
        // Refresh RSVP status for just this specific match (immediate update)
        await this.discordService.updateThreadRsvpStatus(matchId, interaction.channel);
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
      
      // Reply to interaction
      await interaction.reply({ 
        content: `${responseEmoji} Your RSVP has been ${actionText}! **${userMapping.faceit_nickname}** - ${response.toUpperCase()}${threadLink}`, 
        flags: MessageFlags.Ephemeral
      });
      
      // Update thread RSVP status immediately (synchronous for better UX)
      await this.discordService.updateThreadRsvpStatus(matchId, interaction.channel);
      
      // Log this interaction for recovery purposes
      await this.interactionLog.logRsvpAction(
        matchId, 
        userId, 
        interaction.user.username, 
        response, 
        userMapping.faceit_nickname
      );
      
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
        const cache = require('../services/cache');
        teamPlayers = await cache.getTeamData('team_players', async () => {
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
      
      // Reply with status embed
      await interaction.reply({ 
        embeds: [embed], 
        components: [refreshRow],
        flags: MessageFlags.Ephemeral
      });
      
    } catch (err) {
      console.error(`Error handling status button: ${err.message}`);
      await interaction.reply({ 
        content: '❌ Sorry, there was an error retrieving RSVP status.', 
        flags: MessageFlags.Ephemeral
      });
    }
  }
  
  /**
   * Handle analyze enemy button
   */
  async handleAnalyzeEnemyButton(interaction) {
    try {
      const faceitService = require('../services/faceitService');
      const matchId = interaction.customId.split('_')[2];
      
      // Immediately defer the reply to prevent timeout
      await interaction.deferReply({ ephemeral: true });
      
      console.log(`🔍 Analyzing enemy team for match: ${matchId}`);
      
      // Use the comprehensive enemy team analysis method
      const analysis = await faceitService.getEnemyTeamAnalysis(matchId);
      
      if (!analysis || !analysis.enemyTeam) {
        await interaction.editReply({ 
          content: '❌ Unable to analyze enemy team. Match data may not be available.' 
        });
        return;
      }
      
      const { enemyTeam, analysis: teamAnalysis } = analysis;
      
      // Create the analysis embed
      const embed = new EmbedBuilder()
        .setTitle(`🎯 Enemy Team Analysis`)
        .setDescription(`**Team:** ${enemyTeam.name}\n**Match ID:** ${matchId}`)
        .setColor(0xff6b35)
        .setTimestamp();
      
      // Add team statistics
      if (teamAnalysis && teamAnalysis.teamAverages) {
        embed.addFields({
          name: '📊 Team Overview',
          value: [
            `**Average ELO:** ${teamAnalysis.teamAverages.elo}`,
            `**Average K/D:** ${teamAnalysis.teamAverages.kdRatio}`,
            `**Recent Matches:** ${teamAnalysis.teamAverages.matchesPlayed}`,
            `**Team Win Rate:** ${teamAnalysis.teamAverages.winRate}%`
          ].join('\n'),
          inline: false
        });
      }
      
      // Add team map analysis
      if (teamAnalysis && teamAnalysis.mapAnalysis) {
        const { bestMap, worstMap } = teamAnalysis.mapAnalysis;
        embed.addFields({
          name: '🗺️ Team Map Performance',
          value: [
            `**Best Map:** ${bestMap.map !== 'N/A' ? `${bestMap.map} (${bestMap.avgWinRate}% WR)` : 'N/A'}`,
            `**Worst Map:** ${worstMap.map !== 'N/A' ? `${worstMap.map} (${worstMap.avgWinRate}% WR)` : 'N/A'}`
          ].join('\n'),
          inline: true
        });
      }
      
      // Add individual player stats with map analysis (limit to avoid embed size limits)
      if (enemyTeam.players && enemyTeam.players.length > 0) {
        const playerStats = enemyTeam.players.slice(0, 5).map(player => {
          const elo = player.faceit_elo || 'N/A';
const kd = (player.stats && player.stats['Average K/D Ratio']) ? parseFloat(player.stats['Average K/D Ratio']).toFixed(2) : 'N/A';
          const skillLevel = player.skill_level || 'N/A';
          const winRate = player.stats && player.stats['Win Rate %'] ? `${player.stats['Win Rate %']}%` : 'N/A';
          
          // Find best and worst maps for this player
          let bestMap = 'N/A';
          let worstMap = 'N/A';
          
          if (player.mapStats && Object.keys(player.mapStats).length > 0) {
            let bestWinRate = -1;
            let worstWinRate = 101;
            
            Object.entries(player.mapStats).forEach(([map, stats]) => {
              if (stats.matchesPlayed >= 3) { // Only consider maps with reasonable sample size
                if (stats.winRate > bestWinRate) {
                  bestWinRate = stats.winRate;
                  bestMap = `${map} (${stats.winRate}%)`;
                }
                if (stats.winRate < worstWinRate) {
                  worstWinRate = stats.winRate;
                  worstMap = `${map} (${stats.winRate}%)`;
                }
              }
            });
          }
          
          return `**${player.nickname}**\n` +
                 `ELO: ${elo} | Level: ${skillLevel}\n` +
                 `K/D: ${kd} | Win Rate: ${winRate}\n` +
                 `Best Map: ${bestMap}\n` +
                 `Worst Map: ${worstMap}`;
        }).join('\n\n');
        
        embed.addFields({
          name: '👥 Enemy Players',
          value: playerStats,
          inline: false
        });
      }
      
      
      // Add footer with additional info
      embed.setFooter({ 
        text: `Analysis completed • Players analyzed: ${enemyTeam.players?.length || 0}` 
      });
      
      await interaction.editReply({ embeds: [embed] });
      
    } catch (err) {
      console.error(`Error handling analyze enemy button: ${err.message}`);
      
      // Try to edit reply, but fallback to followUp if interaction is already replied to
      try {
        await interaction.editReply({ 
          content: '❌ Sorry, there was an error analyzing the enemy team. Please try again later.' 
        });
      } catch (editError) {
        await interaction.followUp({ 
          content: '❌ Sorry, there was an error analyzing the enemy team. Please try again later.',
          ephemeral: true 
        });
      }
    }
  }

}

module.exports = ButtonHandler;
