const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
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

    // Handle edit-rsvp staged buttons
    if (interaction.customId.startsWith('editrsvp_match_')) {
      await this.handleEditRsvpSelectUser(interaction);
      return;
    }
    if (interaction.customId.startsWith('editrsvp_user_')) {
      await this.handleEditRsvpSelectStatus(interaction);
      return;
    }
    if (interaction.customId.startsWith('editrsvp_set_')) {
      await this.handleEditRsvpSet(interaction);
      return;
    }
    if (interaction.customId.startsWith('editrsvp_users_')) {
      await this.handleEditRsvpUsersPage(interaction);
      return;
    }
    if (interaction.customId.startsWith('editrsvp_search_')) {
      await this.handleEditRsvpOpenSearch(interaction);
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
   * Stage 2: After selecting a match, present user buttons
   */
  async handleEditRsvpSelectUser(interaction) {
    try {
      const parts = interaction.customId.split('_');
      const matchId = parts[2];
      let query = '';
      const qIndex = parts.findIndex(p => p === 'q');
      if (qIndex >= 0 && parts[qIndex + 1]) {
        try { query = Buffer.from(parts[qIndex + 1], 'base64url').toString('utf8'); } catch {}
      }

      // Load user mappings (prefer in-memory cache, fallback to DB)
      let userMappings = Object.values(this.db.userMappings || {});
      if (!userMappings || userMappings.length === 0) {
        userMappings = await this.db.getAllUserMappings();
      }

      if (!userMappings || userMappings.length === 0) {
        await interaction.reply({ content: '❌ No linked users found to edit.', flags: MessageFlags.Ephemeral });
        return;
      }

      // Apply optional search filter
      const norm = s => (s || '').toString().toLowerCase();
      if (query) {
        userMappings = userMappings.filter(u =>
          norm(u.faceit_nickname).includes(norm(query)) ||
          norm(u.discord_username).includes(norm(query))
        );
      }

      if (userMappings.length === 0) {
        await interaction.reply({ content: '❌ No users match your search.', flags: MessageFlags.Ephemeral });
        return;
      }

      // Pagination
      const page = 0;
      await this.renderEditRsvpUsers(interaction, matchId, userMappings, page, query);
    } catch (err) {
      console.error(`Error in handleEditRsvpSelectUser: ${err.message}`);
      if (!interaction.replied) {
        await interaction.reply({ content: '❌ Error showing users.', flags: MessageFlags.Ephemeral });
      }
    }
  }

  async renderEditRsvpUsers(interaction, matchId, userMappings, page, query) {
    const PAGE_SIZE = 25;
    const totalPages = Math.max(1, Math.ceil(userMappings.length / PAGE_SIZE));
    const current = Math.min(Math.max(0, page), totalPages - 1);
    const start = current * PAGE_SIZE;
    const pageItems = userMappings.slice(start, start + PAGE_SIZE);

    const embed = new EmbedBuilder()
      .setTitle('🛠️ Edit RSVP • Step 2: Select User')
      .setDescription('Choose a user to set their RSVP:')
      .setColor(0xff5500)
      .setTimestamp();

    if (query) {
      embed.setFooter({ text: `Page ${current + 1}/${totalPages} • Filter: ${query}` });
    } else {
      embed.setFooter({ text: `Page ${current + 1}/${totalPages}` });
    }

    const rows = [];
    for (let i = 0; i < pageItems.length; i += 5) {
      const row = new ActionRowBuilder();
      const slice = pageItems.slice(i, i + 5);
      slice.forEach(u => {
        const label = (u.faceit_nickname || u.discord_username || 'User').toString().slice(0, 80);
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`editrsvp_user_${matchId}_${u.discord_id}`)
            .setLabel(label)
            .setStyle(ButtonStyle.Secondary)
        );
      });
      rows.push(row);
    }

    // Controls row: Prev / Next / Search
    const controls = new ActionRowBuilder();
    const token = query ? `_q_${Buffer.from(query).toString('base64url')}` : '';

    // Only include Prev/Next when there is more than one page to avoid duplicate IDs
    if (totalPages > 1) {
      controls.addComponents(
        new ButtonBuilder()
          .setCustomId(`editrsvp_users_${matchId}_p_${Math.max(0, current - 1)}${token}`)
          .setLabel('⬅️ Prev')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(current === 0),
        new ButtonBuilder()
          .setCustomId(`editrsvp_users_${matchId}_p_${Math.min(totalPages - 1, current + 1)}${token}`)
          .setLabel('Next ➡️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(current >= totalPages - 1)
      );
    }

    controls.addComponents(
      new ButtonBuilder()
        .setCustomId(`editrsvp_search_${matchId}${token}`)
        .setLabel('🔎 Search')
        .setStyle(ButtonStyle.Primary)
    );

    rows.push(controls);

    const respond = interaction.replied || interaction.deferred ? 'followUp' : 'reply';
    await interaction[respond]({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
  }

  async handleEditRsvpUsersPage(interaction) {
    try {
      // customId format: editrsvp_users_{matchId}_p_{page}[_q_{token}]
      const parts = interaction.customId.split('_');
      const matchId = parts[2];
      const pageIndex = parts.indexOf('p');
      const page = pageIndex >= 0 ? parseInt(parts[pageIndex + 1], 10) : 0;
      let query = '';
      const qIndex = parts.indexOf('q');
      if (qIndex >= 0 && parts[qIndex + 1]) {
        try { query = Buffer.from(parts[qIndex + 1], 'base64url').toString('utf8'); } catch {}
      }

      // Reload mappings and filter
      let userMappings = Object.values(this.db.userMappings || {});
      if (!userMappings || userMappings.length === 0) {
        userMappings = await this.db.getAllUserMappings();
      }
      const norm = s => (s || '').toString().toLowerCase();
      if (query) {
        userMappings = userMappings.filter(u =>
          norm(u.faceit_nickname).includes(norm(query)) ||
          norm(u.discord_username).includes(norm(query))
        );
      }
      if (userMappings.length === 0) {
        await interaction.reply({ content: '❌ No users match your search.', flags: MessageFlags.Ephemeral });
        return;
      }

      // Edit the existing message in place if possible
      await interaction.deferUpdate();

      const PAGE_SIZE = 25;
      const totalPages = Math.max(1, Math.ceil(userMappings.length / PAGE_SIZE));
      const current = Math.min(Math.max(0, page), totalPages - 1);
      const start = current * PAGE_SIZE;
      const pageItems = userMappings.slice(start, start + PAGE_SIZE);

      const embed = new EmbedBuilder()
        .setTitle('🛠️ Edit RSVP • Step 2: Select User')
        .setDescription('Choose a user to set their RSVP:')
        .setColor(0xff5500)
        .setTimestamp()
        .setFooter({ text: `Page ${current + 1}/${totalPages}${query ? ` • Filter: ${query}` : ''}` });

      const rows = [];
      for (let i = 0; i < pageItems.length; i += 5) {
        const row = new ActionRowBuilder();
        const slice = pageItems.slice(i, i + 5);
        slice.forEach(u => {
          const label = (u.faceit_nickname || u.discord_username || 'User').toString().slice(0, 80);
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`editrsvp_user_${matchId}_${u.discord_id}`)
              .setLabel(label)
              .setStyle(ButtonStyle.Secondary)
          );
        });
        rows.push(row);
      }

      const controls = new ActionRowBuilder();
      const token = query ? `_q_${Buffer.from(query).toString('base64url')}` : '';

      if (totalPages > 1) {
        controls.addComponents(
          new ButtonBuilder().setCustomId(`editrsvp_users_${matchId}_p_${Math.max(0, current - 1)}${token}`).setLabel('⬅️ Prev').setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
          new ButtonBuilder().setCustomId(`editrsvp_users_${matchId}_p_${Math.min(totalPages - 1, current + 1)}${token}`).setLabel('Next ➡️').setStyle(ButtonStyle.Secondary).setDisabled(current >= totalPages - 1)
        );
      }

      controls.addComponents(
        new ButtonBuilder().setCustomId(`editrsvp_search_${matchId}${token}`).setLabel('🔎 Search').setStyle(ButtonStyle.Primary)
      );

      rows.push(controls);

      await interaction.message.edit({ embeds: [embed], components: rows });
    } catch (err) {
      console.error(`Error in handleEditRsvpUsersPage: ${err.message}`);
      if (!interaction.replied) {
        await interaction.followUp({ content: '❌ Error changing page.', ephemeral: true });
      }
    }
  }

  async handleEditRsvpOpenSearch(interaction) {
    try {
      const parts = interaction.customId.split('_');
      const matchId = parts[2];
      const modal = new ModalBuilder()
        .setCustomId(`editrsvp_search_modal_${matchId}`)
        .setTitle('Search Users');

      const input = new TextInputBuilder()
        .setCustomId('query')
        .setLabel('Enter nickname or username')
        .setMaxLength(100)
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
    } catch (err) {
      console.error(`Error opening search modal: ${err.message}`);
    }
  }

  /**
   * Stage 3: After selecting a user, present Yes/No buttons
   */
  async handleEditRsvpSelectStatus(interaction) {
    try {
      const parts = interaction.customId.split('_');
      const matchId = parts[2];
      const targetUserId = parts[3];

      // Fetch mapping for label
      let mapping = this.db.userMappings?.[targetUserId];
      if (!mapping) {
        mapping = (await this.db.getUserMappingByDiscordIdFromDB(targetUserId)) || { faceit_nickname: 'Unknown' };
      }

      const embed = new EmbedBuilder()
        .setTitle('🛠️ Edit RSVP • Step 3: Set Status')
        .setDescription(`Match: \`${matchId}\`\nUser: **${mapping.faceit_nickname}** (<@${targetUserId}>)`)
        .setColor(0xff5500)
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`editrsvp_set_${matchId}_${targetUserId}_yes`).setLabel('✅ Yes').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`editrsvp_set_${matchId}_${targetUserId}_no`).setLabel('❌ No').setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    } catch (err) {
      console.error(`Error in handleEditRsvpSelectStatus: ${err.message}`);
      if (!interaction.replied) {
        await interaction.reply({ content: '❌ Error showing status options.', flags: MessageFlags.Ephemeral });
      }
    }
  }

  /**
   * Stage 4: Persist RSVP and update thread
   */
  async handleEditRsvpSet(interaction) {
    try {
      const parts = interaction.customId.split('_');
      const matchId = parts[2];
      const targetUserId = parts[3];
      const response = parts[4]; // yes | no

      // Permission check (defensive)
      if (!this.slashCommandHandler?.hasModeratorPrivileges?.(interaction)) {
        await interaction.reply({ content: '❌ You lack permission to edit RSVPs.', flags: MessageFlags.Ephemeral });
        return;
      }

      // Ensure user mapping exists
      const userMapping = await this.db.getUserMappingByDiscordIdFromDB(targetUserId);
      if (!userMapping) {
        await interaction.reply({ content: '❌ Selected user is not linked to a FACEIT account.', flags: MessageFlags.Ephemeral });
        return;
      }

      // Validate thread
      const threadId = this.db.matchThreads?.get(matchId);
      if (!threadId) {
        await interaction.reply({ content: `❌ No Discord thread found for match ${matchId}.`, flags: MessageFlags.Ephemeral });
        return;
      }

      let thread;
      try { thread = await this.client.channels.fetch(threadId); } catch {}
      if (!thread || !thread.name || !thread.name.startsWith('INCOMING:')) {
        await interaction.reply({ content: `❌ Thread for match ${matchId} is not an INCOMING thread.`, flags: MessageFlags.Ephemeral });
        return;
      }

      const existing = this.db.getUserRsvp(matchId, targetUserId);
      await this.db.addRsvp(matchId, targetUserId, response, userMapping.faceit_nickname);

      await this.discordService.updateThreadRsvpStatus(matchId, thread);

      const emoji = response === 'yes' ? '✅' : '❌';
      const action = existing ? 'updated' : 'recorded';
      await interaction.reply({
        content: `${emoji} RSVP ${action} for **${userMapping.faceit_nickname}** (<@${targetUserId}>) on match \`${matchId}\`: ${response.toUpperCase()}`,
        flags: MessageFlags.Ephemeral
      });
    } catch (err) {
      console.error(`Error in handleEditRsvpSet: ${err.message}`);
      if (!interaction.replied) {
        await interaction.reply({ content: '❌ Error setting RSVP.', flags: MessageFlags.Ephemeral });
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
  async handleEditRsvpSearchModal(interaction) {
    try {
      // customId: editrsvp_search_modal_{matchId}
      const parts = interaction.customId.split('_');
      const matchId = parts[3];
      const query = interaction.fields.getTextInputValue('query') || '';

      // Load mappings
      let userMappings = Object.values(this.db.userMappings || {});
      if (!userMappings || userMappings.length === 0) {
        userMappings = await this.db.getAllUserMappings();
      }

      const norm = s => (s || '').toString().toLowerCase();
      const filtered = query
        ? userMappings.filter(u =>
            norm(u.faceit_nickname).includes(norm(query)) ||
            norm(u.discord_username).includes(norm(query))
          )
        : userMappings;

      if (filtered.length === 0) {
        await interaction.reply({ content: '❌ No users match your search.', flags: MessageFlags.Ephemeral });
        return;
      }

      // Show first page with filter applied
      await this.renderEditRsvpUsers(interaction, matchId, filtered, 0, query);
    } catch (err) {
      console.error(`Error handling search modal submit: ${err.message}`);
      if (!interaction.replied) {
        await interaction.reply({ content: '❌ Error applying search.', flags: MessageFlags.Ephemeral });
      }
    }
  }

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
