const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { formatMatchTime } = require('../utils/helpers');
const faceitService = require('../services/faceitService');
const config = require('../config/config');

class SlashCommandHandler {
  constructor(client, databaseService, discordService, backupService) {
    this.client = client;
    this.db = databaseService;
    this.discordService = discordService;
    this.backupService = backupService;
    this.commands = new Map();
    
    this.setupSlashCommands();
  }

  /**
   * Setup all slash commands
   */
  setupSlashCommands() {
    // Matches command
    const matchesCommand = new SlashCommandBuilder()
      .setName('matches')
      .setDescription('View upcoming FACEIT matches');

    // Profile command
    const profileCommand = new SlashCommandBuilder()
      .setName('profile')
      .setDescription('View your linked FACEIT profile');


    // Lookup command
    const lookupCommand = new SlashCommandBuilder()
      .setName('lookup')
      .setDescription('Search for FACEIT accounts')
      .addStringOption(option =>
        option.setName('query')
          .setDescription('FACEIT nickname to search for')
          .setRequired(true));

    // Status command
    const statusCommand = new SlashCommandBuilder()
      .setName('status')
      .setDescription('View RSVP status for a match')
      .addStringOption(option =>
        option.setName('match_id')
          .setDescription('Match ID to check status for')
          .setRequired(false));

    // Help command
    const helpCommand = new SlashCommandBuilder()
      .setName('help')
      .setDescription('Show available commands and usage');

    // Finished matches command
    const finishedMatchesCommand = new SlashCommandBuilder()
      .setName('finishedmatches')
      .setDescription('View recent finished matches')
      .addIntegerOption(option =>
        option.setName('limit')
          .setDescription('Number of matches to show (default: 10)')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(20));

    // Link command
    const linkCommand = new SlashCommandBuilder()
      .setName('link')
      .setDescription('Link your Discord account to a FACEIT account')
      .addStringOption(option =>
        option.setName('nickname')
          .setDescription('Your FACEIT nickname (case-sensitive)')
          .setRequired(true));

    // Register command
    const registerCommand = new SlashCommandBuilder()
      .setName('register')
      .setDescription('View available team players to link with');

    // Unlink command
    const unlinkCommand = new SlashCommandBuilder()
      .setName('unlink')
      .setDescription('Unlink your Discord account from FACEIT');

    // Notify command (admin only)
    const notifyCommand = new SlashCommandBuilder()
      .setName('notify')
      .setDescription('Send a test match notification (admin only)');

    // Clear cache command (admin only)
    const clearCacheCommand = new SlashCommandBuilder()
      .setName('clear-cache')
      .setDescription('Clear and reload in-memory caches (admin only)');

    // Restart bot command (admin only)
    const restartBotCommand = new SlashCommandBuilder()
      .setName('restart-bot')
      .setDescription('Restart the bot (admin only)');

    // Clean commands (admin only)
    const cleanUserMappingsCommand = new SlashCommandBuilder()
      .setName('clean-user-mappings')
      .setDescription('Clean all user mappings (admin only)');

    const cleanRsvpStatusCommand = new SlashCommandBuilder()
      .setName('clean-rsvp-status')
      .setDescription('Clean all RSVP status data (admin only)');

    const cleanupThreadsCommand = new SlashCommandBuilder()
      .setName('cleanup-threads')
      .setDescription('Clean up old match threads (admin only)');

    // Backup management commands (admin only)
    const backupCreateCommand = new SlashCommandBuilder()
      .setName('backup-create')
      .setDescription('Create a manual database backup (admin only)');

    const backupListCommand = new SlashCommandBuilder()
      .setName('backup-list')
      .setDescription('List all available database backups (admin only)');

    const backupStatusCommand = new SlashCommandBuilder()
      .setName('backup-status')
      .setDescription('Show backup service status and statistics (admin only)');

    // Store command definitions
    this.commands.set('matches', matchesCommand);
    this.commands.set('profile', profileCommand);
    this.commands.set('lookup', lookupCommand);
    this.commands.set('status', statusCommand);
    this.commands.set('help', helpCommand);
    this.commands.set('finishedmatches', finishedMatchesCommand);
    this.commands.set('link', linkCommand);
    this.commands.set('register', registerCommand);
    this.commands.set('unlink', unlinkCommand);
    this.commands.set('notify', notifyCommand);
    this.commands.set('clear-cache', clearCacheCommand);
    this.commands.set('restart-bot', restartBotCommand);
    this.commands.set('clean-user-mappings', cleanUserMappingsCommand);
    this.commands.set('clean-rsvp-status', cleanRsvpStatusCommand);
    this.commands.set('cleanup-threads', cleanupThreadsCommand);
    this.commands.set('backup-create', backupCreateCommand);
    this.commands.set('backup-list', backupListCommand);
    this.commands.set('backup-status', backupStatusCommand);
  }

  /**
   * Register slash commands with Discord
   */
  async registerSlashCommands() {
    try {
      console.log('🔄 Registering slash commands...');
      
      const commandData = Array.from(this.commands.values()).map(cmd => cmd.toJSON());
      
      // Register to guild for immediate testing (if DISCORD_GUILD_ID is set)
      // Otherwise register globally (takes up to 1 hour to propagate)
      if (process.env.DISCORD_GUILD_ID) {
        const guild = this.client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
        if (guild) {
          await guild.commands.set(commandData);
          console.log(`✅ Successfully registered ${commandData.length} slash commands to guild ${guild.name}`);
          
          // Clear any existing global commands to avoid duplicates
          await this.client.application.commands.set([]);
          console.log('🧹 Cleared global commands to prevent duplicates');
        } else {
          console.log(`⚠️ Guild ${process.env.DISCORD_GUILD_ID} not found in cache, falling back to global registration`);
          await this.client.application.commands.set(commandData);
          console.log(`✅ Successfully registered ${commandData.length} slash commands globally`);
        }
      } else {
        await this.client.application.commands.set(commandData);
        console.log(`✅ Successfully registered ${commandData.length} slash commands globally`);
        console.log('🕰️ Global registration may take up to 1 hour to propagate across all servers');
      }
      
    } catch (error) {
      console.error('❌ Failed to register slash commands:', error);
    }
  }

  /**
   * Handle slash command interactions
   */
  async handleSlashCommand(interaction) {
    const { commandName } = interaction;

    try {
      switch (commandName) {
        case 'matches':
          await this.handleMatchesCommand(interaction);
          break;
        case 'profile':
          await this.handleProfileCommand(interaction);
          break;
        case 'lookup':
          await this.handleLookupCommand(interaction);
          break;
        case 'status':
          await this.handleStatusCommand(interaction);
          break;
        case 'help':
          await this.handleHelpCommand(interaction);
          break;
        case 'finishedmatches':
          await this.handleFinishedMatchesCommand(interaction);
          break;
        case 'link':
          await this.handleLinkCommand(interaction);
          break;
        case 'register':
          await this.handleRegisterCommand(interaction);
          break;
        case 'unlink':
          await this.handleUnlinkCommand(interaction);
          break;
        case 'notify':
          await this.handleNotifyCommand(interaction);
          break;
        case 'clear-cache':
          await this.handleClearCacheCommand(interaction);
          break;
        case 'restart-bot':
          await this.handleRestartBotCommand(interaction);
          break;
        case 'clean-user-mappings':
          await this.handleCleanUserMappingsCommand(interaction);
          break;
        case 'clean-rsvp-status':
          await this.handleCleanRsvpStatusCommand(interaction);
          break;
        case 'cleanup-threads':
          await this.handleCleanupThreadsCommand(interaction);
          break;
        case 'backup-create':
          await this.handleBackupCreateCommand(interaction);
          break;
        case 'backup-list':
          await this.handleBackupListCommand(interaction);
          break;
        case 'backup-status':
          await this.handleBackupStatusCommand(interaction);
          break;
        default:
          await interaction.reply({ 
            content: '❌ Unknown command', 
            flags: MessageFlags.Ephemeral 
          });
      }
    } catch (error) {
      console.error(`Error handling slash command ${commandName}:`, error);
      const errorMessage = '❌ Sorry, there was an error processing your command.';
      
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ content: errorMessage });
      } else {
        await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
      }
    }
  }

  /**
   * Handle /matches command
   */
  async handleMatchesCommand(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      console.log(`User ${interaction.user.tag} requested matches list via slash command`);
      
      const matches = await faceitService.getUpcomingMatches();
      
      if (matches.length === 0) {
        await interaction.editReply('No upcoming matches found for your team.');
        return;
      }
      
      const guildId = interaction.guild?.id;
      
      // Send each match as a separate message for perfect pairing
      for (let index = 0; index < Math.min(matches.length, 3); index++) { // Limit to 3 matches for clean output
        const match = matches[index];
        const faction1 = match.teams.faction1?.name || 'TBD';
        const faction2 = match.teams.faction2?.name || 'TBD';
        const matchTimes = formatMatchTime(match.scheduled_at);
        const matchUrl = `https://www.faceit.com/en/cs2/room/${match.match_id}`;
        
        // Create simple, clean embed for this match
        const matchEmbed = new EmbedBuilder()
          .setTitle(`${faction1} vs ${faction2}`)
          .setDescription(`⏰ ${matchTimes.pacific}\n⏰ ${matchTimes.mountain}`)
          .setColor(0xff5500); // Orange color like FACEIT
        
        // Create action buttons for this match
        const buttons = [];
        
        // Match Room button (always available)
        buttons.push(
          new ButtonBuilder()
            .setLabel('🔗 Join Match Room')
            .setStyle(ButtonStyle.Link)
            .setURL(matchUrl)
        );
        
        // Discord Thread button (if thread exists)
        const threadId = this.db.matchThreads.get(match.match_id);
        if (threadId && guildId) {
          const threadUrl = `https://discord.com/channels/${guildId}/${threadId}`;
          buttons.push(
            new ButtonBuilder()
              .setLabel('💬 Go to Thread')
              .setStyle(ButtonStyle.Link)
              .setURL(threadUrl)
          );
        }
        
        // Send this match as a message
        const messageData = {
          embeds: [matchEmbed],
          flags: MessageFlags.Ephemeral
        };
        
        if (buttons.length > 0) {
          messageData.components = [new ActionRowBuilder().addComponents(buttons)];
        }
        
        // Use editReply for the first message, followUp for subsequent ones
        if (index === 0) {
          await interaction.editReply(messageData);
        } else {
          await interaction.followUp(messageData);
        }
      }
      
      // Add footer message if there are more matches
      if (matches.length > 3) {
        await interaction.followUp({
          content: `*Showing ${Math.min(matches.length, 3)} of ${matches.length} upcoming matches. Use match threads for additional matches.*`,
          flags: MessageFlags.Ephemeral
        });
      }
      
    } catch (err) {
      console.error(`Error handling /matches command: ${err.message}`);
      await interaction.editReply('Sorry, there was an error fetching match information.');
    }
  }

  /**
   * Handle /profile command
   */
  async handleProfileCommand(interaction) {
    const userId = interaction.user.id;
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    try {
      const mapping = await this.db.getUserMappingByDiscordId(userId);
      if (!mapping) {
        await interaction.editReply({
          content: 'You don\'t have a linked FACEIT account. Use `/register` to link your account with one click, or `/link \<nickname\>` if needed.'
        });
        return;
      }
      
      console.log(`Fetching FACEIT profile for: ${mapping.faceit_nickname}`);
      
      // Fetch real FACEIT data
      const faceitService = require('../services/faceitService');
      const faceitData = await faceitService.getPlayerByNickname(mapping.faceit_nickname);
      
      if (!faceitData) {
        // Fallback to stored data if API fails
        const embed = new EmbedBuilder()
          .setTitle('🎮 Your Linked FACEIT Account')
          .setDescription(`**[${mapping.faceit_nickname}](https://www.faceit.com/en/players/${mapping.faceit_nickname})**\n\n⚠️ Unable to fetch current stats from FACEIT API`)
          .addFields(
            { name: '🏆 Skill Level', value: mapping.faceit_skill_level || 'Unknown', inline: true },
            { name: '🌍 Country', value: mapping.country || 'Unknown', inline: true },
            { name: '📅 Linked On', value: new Date(mapping.registered_at).toLocaleDateString() || 'Invalid Date', inline: true }
          )
          .setColor(0xff5500)
          .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
        return;
      }
      
      // Extract CS2 game stats (preferred) or CS:GO as fallback
      const cs2Stats = faceitData.games?.cs2;
      const csgoStats = faceitData.games?.csgo;
      const gameStats = cs2Stats || csgoStats;
      
      // Determine skill level and ELO
      const skillLevel = gameStats?.skill_level || 'Unranked';
      const elo = gameStats?.faceit_elo || 'N/A';
      const currentGame = cs2Stats ? 'CS2' : csgoStats ? 'CS:GO' : 'Unknown';
      
      // Get additional stats
      const totalMatches = gameStats?.matches_played || 0;
      const winRate = gameStats?.wins && totalMatches ? Math.round((gameStats.wins / totalMatches) * 100) : 'N/A';
      const avgKD = gameStats?.average_kd_ratio ? parseFloat(gameStats.average_kd_ratio).toFixed(2) : 'N/A';
      const avgHS = gameStats?.average_hs_percentage ? Math.round(gameStats.average_hs_percentage) : 'N/A';
      
      // Build profile embed with only meaningful data
      const embed = new EmbedBuilder()
        .setTitle('🎮 Your FACEIT Profile')
        .setDescription(`**[${faceitData.nickname}](https://www.faceit.com/en/players/${faceitData.nickname})**`)
        .setColor(0xff5500)
        .setTimestamp();
      
      // Only add fields that have meaningful values
      const fields = [];
      
      // Always show skill level and ELO if they have real values
      if (skillLevel && skillLevel !== 'Unranked' && skillLevel !== 'Unknown') {
        fields.push({ name: '🏆 Skill Level', value: `Level ${skillLevel}`, inline: true });
      }
      if (elo && elo !== 'N/A' && elo !== 'Unknown') {
        fields.push({ name: '📊 ELO', value: `${elo}`, inline: true });
      }
      if (currentGame && currentGame !== 'Unknown') {
        fields.push({ name: '🎯 Game', value: currentGame, inline: true });
      }
      
      // Only show match stats if the player has actually played matches
      if (totalMatches > 0) {
        fields.push({ name: '🏅 Matches Played', value: `${totalMatches}`, inline: true });
        
        // Only show win rate if it's not N/A and not 0
        if (winRate !== 'N/A' && winRate > 0) {
          fields.push({ name: '📈 Win Rate', value: `${winRate}%`, inline: true });
        }
        // Only show K/D if it's not N/A and not 0
        if (avgKD !== 'N/A' && parseFloat(avgKD) > 0) {
          fields.push({ name: '💀 Avg K/D', value: avgKD, inline: true });
        }
        // Only show HS% if it's not N/A and not 0
        if (avgHS !== 'N/A' && avgHS > 0) {
          fields.push({ name: '🎯 Avg HS%', value: `${avgHS}%`, inline: true });
        }
      }
      
      // Add country if available
      if (faceitData.country && faceitData.country !== 'Unknown') {
        fields.push({ name: '🌍 Country', value: faceitData.country.toUpperCase(), inline: true });
      }
      
      // Add linked date only if it's valid
      if (mapping.registered_at) {
        const linkedDate = new Date(mapping.registered_at);
        if (!isNaN(linkedDate.getTime())) {
          fields.push({ name: '📅 Linked On', value: linkedDate.toLocaleDateString(), inline: true });
        }
      }
      
      embed.addFields(fields);
        
      // Add avatar if available
      if (faceitData.avatar) {
        embed.setThumbnail(faceitData.avatar);
      }
      
      // Add special badge for high skill levels
      if (skillLevel && skillLevel !== 'Unranked' && parseInt(skillLevel) >= 8) {
        embed.setColor(0x00ff00); // Green for high levels
        embed.setFooter({ text: '🌟 Elite Player!' });
      } else if (skillLevel && parseInt(skillLevel) >= 5) {
        embed.setColor(0xffd700); // Gold for intermediate levels
      }
      
      // Update stored data with fresh info if we got valid data
      if (gameStats) {
        try {
          await this.db.updateUserMappingStats(userId, {
            faceit_skill_level: skillLevel,
            faceit_elo: elo,
            country: faceitData.country
          });
        } catch (updateErr) {
          console.error(`Error updating stored user stats: ${updateErr.message}`);
        }
      }
      
      await interaction.editReply({ embeds: [embed] });
      
    } catch (err) {
      console.error(`Error handling /profile command: ${err.message}`);
      await interaction.editReply({
        content: 'Sorry, there was an error retrieving your profile. Please try again later.'
      });
    }
  }


  /**
   * Handle /lookup command
   */
  async handleLookupCommand(interaction) {
    const query = interaction.options.getString('query');
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      console.log(`User ${interaction.user.tag} is searching for: ${query}`);
      
      const results = await faceitService.searchFaceitAccounts(query);
      
      if (results.length === 0) {
        await interaction.editReply(`No FACEIT accounts found for "${query}".`);
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`🔍 FACEIT Search Results for "${query}"`)
        .setColor(0x0099ff)
        .setTimestamp();

      results.slice(0, 5).forEach((account, index) => {
        const skillLevel = account.games?.cs2?.skill_level || account.games?.csgo?.skill_level || 'Unknown';
        const elo = account.games?.cs2?.faceit_elo || account.games?.csgo?.faceit_elo || 'Unknown';
        
        embed.addFields({
          name: `${index + 1}. ${account.nickname}`,
          value: `**Level:** ${skillLevel} | **ELO:** ${elo}\n**Country:** ${account.country || 'Unknown'}\n[Profile](${account.faceit_url})`,
          inline: false
        });
      });

      if (results.length > 5) {
        embed.setFooter({ text: `Showing first 5 of ${results.length} results` });
      }

      await interaction.editReply({ embeds: [embed] });
      
    } catch (err) {
      console.error(`Error handling /lookup command: ${err.message}`);
        await interaction.editReply('Sorry, there was an error performing the lookup.');
    }
  }

  /**
   * Handle /status command
   */
  async handleStatusCommand(interaction) {
    const matchId = interaction.options.getString('match_id');
    
    // Implementation similar to the button status handler
    // For now, provide a simple response
    await interaction.reply({
      content: matchId 
        ? `📝 Status for match ${matchId} - Feature coming soon!`
        : '📝 Status command - Please specify a match ID',
      flags: MessageFlags.Ephemeral
    });
  }

  /**
   * Handle /help command
   */
  async handleHelpCommand(interaction) {
    const isAdmin = interaction.member?.permissions.has(PermissionFlagsBits.Administrator);
    const canManageChannels = interaction.member?.permissions.has(PermissionFlagsBits.ManageChannels);
    const isConfiguredAdmin = config.adminDiscordId && interaction.user.id === config.adminDiscordId;

    const embed = new EmbedBuilder()
      .setTitle('🤖 FACEIT Bot Commands')
      .setDescription('Here are the available slash commands:')
      .addFields(
        { name: '🎮 Match Commands', value: '`/matches` - View upcoming matches\n`/finishedmatches [limit]` - View recent results', inline: false },
        { name: '👤 Profile Commands', value: '`/profile` - View your linked FACEIT profile\n`/register` - Link your account with one click\n`/link <nickname>` - Link manually (if needed)\n`/unlink` - Unlink your FACEIT account', inline: false },
        { name: '👥 Team Commands', value: '`/lookup <query>` - Search FACEIT accounts\n`/status [match_id]` - View RSVP status', inline: false },
        { name: '❓ Other Commands', value: '`/help` - Show this help message', inline: false },
        { name: '💡 Tips', value: '• All responses are private (only you can see them)\n• To clear old messages, refresh Discord or restart the app\n• Use `/register` for the easiest account linking', inline: false }
      )
      .setColor(0x7289da)
      .setTimestamp()
      .setFooter({ text: 'All responses are private (only you can see them) • Use RSVP buttons on match threads' });

    // Add admin commands if user has permissions or is configured admin
    if (isAdmin || canManageChannels || isConfiguredAdmin) {
      const adminCommands = [];
      
      if (isAdmin || isConfiguredAdmin) {
        adminCommands.push('`/notify` - Send test notification');
        adminCommands.push('`/restart-bot` - Restart the bot');
      }
      
      if (canManageChannels || isConfiguredAdmin) {
        adminCommands.push('`/clear-cache` - Conservative cache cleanup (preserves user data)');
        adminCommands.push('`/clean-user-mappings` - Clean user data');
        adminCommands.push('`/clean-rsvp-status` - Clean RSVP data');
        adminCommands.push('`/cleanup-threads` - Clean old threads');
        adminCommands.push('`/backup-create` - Create manual backup');
        adminCommands.push('`/backup-list` - List all backups');
        adminCommands.push('`/backup-status` - Show backup status');
      }
      
      if (adminCommands.length > 0) {
        embed.addFields({
          name: '🔧 Admin Commands', 
          value: adminCommands.join('\n'),
          inline: false
        });
      }
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  /**
   * Handle /finishedmatches command
   */
  async handleFinishedMatchesCommand(interaction) {
    const limit = interaction.options.getInteger('limit') || 10;
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const matches = await faceitService.getFinishedMatches(limit);
      
      if (matches.length === 0) {
        await interaction.editReply('No finished matches found.');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🏁 Recent Finished Matches')
        .setColor(0x00ff00)
        .setTimestamp();

      let description = '';
      matches.forEach((match, index) => {
        const faction1 = match.teams?.faction1?.name || 'TBD';
        const faction2 = match.teams?.faction2?.name || 'TBD';
        const result = match.results?.score ? 
          `${match.results.score.faction1} - ${match.results.score.faction2}` : 
          'Score not available';
        
        description += `**${index + 1}.** ${faction1} vs ${faction2}\n`;
        description += `📊 Result: ${result}\n`;
        description += `📅 ${new Date(match.finished_at * 1000).toLocaleDateString()}\n\n`;
      });

      embed.setDescription(description);
      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error(`Error handling /finishedmatches command: ${err.message}`);
      await interaction.editReply('❌ Sorry, there was an error fetching finished matches.');
    }
  }

  /**
   * Handle /link command
   */
  async handleLinkCommand(interaction) {
    const nickname = interaction.options.getString('nickname');
    const userId = interaction.user.id;
    const username = interaction.user.username;

    try {
      console.log(`User ${interaction.user.tag} wants to link to FACEIT account: ${nickname}`);

      // Check if user is already linked
      const existingMapping = await this.db.getUserMappingByDiscordId(userId);
      if (existingMapping) {
        await interaction.reply({
          content: `❌ You are already linked to FACEIT account **${existingMapping.faceit_nickname}**. Use \`/unlink\` first if you want to link a different account.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      // Search for the FACEIT account
      const results = await faceitService.searchFaceitAccounts(nickname);
      const exactMatch = results.find(player => player.nickname.toLowerCase() === nickname.toLowerCase());

      if (!exactMatch) {
        await interaction.reply({
          content: `❌ No FACEIT account found with nickname "${nickname}". Please check the spelling (it's case-sensitive) and try again.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      // Check if this FACEIT account is already linked to someone else
      const existingUser = await this.db.getUserMappingByFaceitId(exactMatch.player_id);
      if (existingUser) {
        await interaction.reply({
          content: `❌ FACEIT account **${nickname}** is already linked to another Discord user.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      // Link the account
      await this.db.addUserMapping(userId, username, {
        nickname: exactMatch.nickname,
        player_id: exactMatch.player_id,
        skill_level: exactMatch.games?.cs2?.skill_level || exactMatch.games?.csgo?.skill_level || 'Unknown',
        faceit_elo: exactMatch.games?.cs2?.faceit_elo || exactMatch.games?.csgo?.faceit_elo || 'Unknown',
        country: exactMatch.country || 'Unknown'
      });

      const embed = new EmbedBuilder()
        .setTitle('✅ Successfully Linked!')
        .setDescription(`Your Discord account has been linked to FACEIT account **[${exactMatch.nickname}](https://www.faceit.com/en/players/${exactMatch.nickname})**`)
        .addFields(
          { name: '🏆 Skill Level', value: `${exactMatch.games?.cs2?.skill_level || exactMatch.games?.csgo?.skill_level || 'Unknown'}`, inline: true },
          { name: '🏅 ELO', value: `${exactMatch.games?.cs2?.faceit_elo || exactMatch.games?.csgo?.faceit_elo || 'Unknown'}`, inline: true },
          { name: '🌍 Country', value: exactMatch.country || 'Unknown', inline: true }
        )
        .setColor(0x00ff00)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      console.log(`Successfully linked ${interaction.user.tag} to FACEIT account ${exactMatch.nickname}`);

    } catch (err) {
      console.error(`Error handling /link command: ${err.message}`);
      await interaction.reply({
        content: '❌ Sorry, there was an error linking your account. Please try again later.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  /**
   * Handle /register command
   */
  async handleRegisterCommand(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      console.log(`User ${interaction.user.tag} requested team registration info`);
      
      // Check if user is already linked
      const existingMapping = await this.db.getUserMappingByDiscordId(interaction.user.id);
      if (existingMapping) {
        await interaction.editReply({
          content: `❌ You are already linked to FACEIT account **${existingMapping.faceit_nickname}**. Use \`/unlink\` first if you want to link a different account.`
        });
        return;
      }
      
      const players = await faceitService.listTeamPlayers();

      if (players.length === 0) {
        await interaction.editReply('No players found for your team.');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('📝 Link Your FACEIT Account')
        .setDescription('Click on your FACEIT nickname below to link your Discord account:')
        .setColor(0xff5500)
        .setTimestamp();

      // Create buttons for each player (max 5 per row, 5 rows max = 25 players)
      const components = [];
      const maxButtons = Math.min(players.length, 25); // Discord limit
      
      for (let i = 0; i < maxButtons; i += 5) {
        const rowButtons = [];
        const rowPlayers = players.slice(i, i + 5);
        
        for (const player of rowPlayers) {
          rowButtons.push(
            new ButtonBuilder()
              .setCustomId(`register_${player.user_id}_${player.nickname}`)
              .setLabel(player.nickname)
              .setStyle(ButtonStyle.Primary)
          );
        }
        
        components.push(new ActionRowBuilder().addComponents(rowButtons));
      }
      
      if (players.length > 25) {
        embed.setFooter({ text: `Showing first 25 of ${players.length} players. Use /link <nickname> for others.` });
      }

      await interaction.editReply({ 
        embeds: [embed],
        components: components
      });
      
      console.log(`Sent registration buttons with ${Math.min(players.length, 25)} team players to ${interaction.user.tag}`);

    } catch (err) {
      console.error(`Error handling /register command: ${err.message}`);
      await interaction.editReply('❌ Sorry, there was an error fetching registration information.');
    }
  }

  /**
   * Handle /unlink command
   */
  async handleUnlinkCommand(interaction) {
    const userId = interaction.user.id;

    try {
      const existingMapping = await this.db.getUserMappingByDiscordId(userId);
      if (!existingMapping) {
        await interaction.reply({
          content: '❌ You don\'t have a linked FACEIT account.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await this.db.removeUserMapping(userId);

      const embed = new EmbedBuilder()
        .setTitle('✅ Successfully Unlinked!')
        .setDescription(`Your Discord account has been unlinked from FACEIT account **${existingMapping.faceit_nickname}**.`)
        .setColor(0x00ff00)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      console.log(`Successfully unlinked ${interaction.user.tag} from FACEIT account ${existingMapping.faceit_nickname}`);

    } catch (err) {
      console.error(`Error handling /unlink command: ${err.message}`);
      await interaction.reply({
        content: '❌ Sorry, there was an error unlinking your account.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  /**
   * Handle /notify command (admin only)
   */
  async handleNotifyCommand(interaction) {
    // Check if user is the configured admin or has admin permissions
    const isConfiguredAdmin = config.adminDiscordId && interaction.user.id === config.adminDiscordId;
    const hasAdminPerms = interaction.member?.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!isConfiguredAdmin && !hasAdminPerms) {
      await interaction.reply({
        content: '❌ This command requires administrator permissions or being the configured admin.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const matches = await faceitService.getUpcomingMatches();
      console.log(`getUpcomingMatches() returned ${matches.length} matches`);
      
      if (matches.length > 0) {
        // Check if thread already exists for this match
        const existingThread = await this.db.getMatchThread(matches[0].match_id);
        if (existingThread) {
          await interaction.editReply(`Test notification skipped - thread already exists for match ${matches[0].match_id}`);
          return;
        }
        
        await this.discordService.sendMatchNotification(matches[0]);
        await interaction.editReply('✅ Test notification sent!');
      } else {
        await interaction.editReply('❌ No matches available for test notification.');
      }
    } catch (err) {
      console.error(`Error handling /notify command: ${err.message}`);
      await interaction.editReply('❌ Sorry, there was an error sending the test notification.');
    }
  }

  /**
   * Handle admin commands with permission check
   */
  checkAdminPermissions(interaction) {
    // Check if user is the configured admin
    if (config.adminDiscordId && interaction.user.id === config.adminDiscordId) {
      return true;
    }
    
    // Fall back to Discord permissions
    if (!interaction.member?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      interaction.reply({
        content: '❌ You need "Manage Channels" permission or be the configured admin to use this command.',
        flags: MessageFlags.Ephemeral
      });
      return false;
    }
    return true;
  }

  /**
   * Handle /clear-cache command (admin only)
   */
  async handleClearCacheCommand(interaction) {
    if (!this.checkAdminPermissions(interaction)) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      console.log(`User ${interaction.user.tag} requested cache clear`);

      // Get cache sizes before clearing
      const beforeStats = {
        processedMatches: this.db.processedMatches?.length || 0,
        userMappings: Object.keys(this.db.userMappings || {}).length,
        rsvpStatus: Object.keys(this.db.rsvpStatus || {}).length,
        matchThreads: this.db.matchThreads?.size || 0,
        upcomingMatches: this.db.upcomingMatches?.size || 0,
        userSearchResults: this.db.userSearchResults?.size || 0
      };

      // Conservative cache clearing - only clear volatile caches
      // DO NOT clear userMappings or rsvpStatus - these are critical for functionality
      if (this.db.upcomingMatches) this.db.upcomingMatches = new Map();
      if (this.db.userSearchResults) this.db.userSearchResults = new Map();
      
      // Clear match threads temporarily and reload from database to ensure consistency
      if (this.db.matchThreads) this.db.matchThreads = new Map();
      await this.db.reloadMatchThreads();

      // Only clean up expired entries from database caches, don't delete everything
      const expiredApiCacheCleared = await this.db.cleanupExpiredApiCache();
      const expiredMatchesCacheCleared = await this.db.cleanupExpiredCache();
      const expiredTeamDataCacheCleared = await this.db.cleanupExpiredTeamDataCache();

      const embed = new EmbedBuilder()
        .setTitle('🔄 Cache Management Complete')
        .setDescription('Conservative cache management completed - critical data preserved.')
        .setColor(0x00ff00)
        .addFields(
          {
            name: '💾 Cache Stats Before',
            value: `Processed Matches: ${beforeStats.processedMatches}\nUser Mappings: ${beforeStats.userMappings}\nRSVP Status: ${beforeStats.rsvpStatus}`,
            inline: false
          },
          {
            name: '🔄 Actions Taken',
            value: `Cleared volatile caches (upcoming matches, search results)\nReloaded match threads from database\nCleaned expired database entries only`,
            inline: false
          },
          {
            name: '🛡️ Data Preserved',
            value: `User Mappings: ${Object.keys(this.db.userMappings || {}).length}\nRSVP Data: ${Object.keys(this.db.rsvpStatus || {}).length}\nMatch Threads: ${this.db.matchThreads?.size || 0}`,
            inline: false
          }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      console.log(`Cache cleared successfully by ${interaction.user.tag}`);

    } catch (err) {
      console.error(`Error handling /clear-cache command: ${err.message}`);
      await interaction.editReply('❌ Sorry, there was an error clearing the cache.');
    }
  }

  /**
   * Handle /restart-bot command (admin only)
   */
  async handleRestartBotCommand(interaction) {
    // Check if user is the configured admin or has admin permissions
    const isConfiguredAdmin = config.adminDiscordId && interaction.user.id === config.adminDiscordId;
    const hasAdminPerms = interaction.member?.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!isConfiguredAdmin && !hasAdminPerms) {
      await interaction.reply({
        content: '❌ You need administrator permissions or be the configured admin to use this command.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    try {
      console.log(`User ${interaction.user.tag} requested bot restart`);

      await interaction.reply({
        content: '🔄 Restarting bot... The bot will be back online shortly.',
        flags: MessageFlags.Ephemeral
      });

      console.log(`Bot restart initiated by ${interaction.user.tag} (${interaction.user.id})`);

      setTimeout(() => {
        console.log('Graceful bot restart - exiting process...');
        process.exit(0);
      }, 2000);

    } catch (err) {
      console.error(`Error handling /restart-bot command: ${err.message}`);
      await interaction.reply({
        content: '❌ Sorry, there was an error trying to restart the bot.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  /**
   * Handle /clean-user-mappings command (admin only)
   */
  async handleCleanUserMappingsCommand(interaction) {
    if (!this.checkAdminPermissions(interaction)) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const beforeCount = await this.db.getAllUserMappings();
      await this.db.clearAllUserMappings();
      
      const embed = new EmbedBuilder()
        .setTitle('✅ User Mappings Cleaned')
        .setDescription(`Successfully cleaned ${beforeCount.length} user mappings from the database.`)
        .setColor(0x00ff00)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      console.log(`Cleaned ${beforeCount.length} user mappings by ${interaction.user.tag}`);

    } catch (err) {
      console.error(`Error handling /clean-user-mappings command: ${err.message}`);
      await interaction.editReply('❌ Sorry, there was an error cleaning user mappings.');
    }
  }

  /**
   * Handle /clean-rsvp-status command (admin only)
   */
  async handleCleanRsvpStatusCommand(interaction) {
    if (!this.checkAdminPermissions(interaction)) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      console.log(`User ${interaction.user.tag} requested RSVP status cleanup and refresh`);
      
      // Step 1: Clean RSVP database entries
      const beforeCount = await this.db.getAllRsvpData();
      await this.db.clearAllRsvpData();
      console.log(`Cleaned ${beforeCount.length} RSVP entries from database`);
      
      // Step 2: Refresh all RSVP statuses in threads
      console.log('🔄 Refreshing all RSVP statuses in threads...');
      const refreshResults = await this.discordService.refreshAllRsvpStatuses(true); // Silent mode
      
      const embed = new EmbedBuilder()
        .setTitle('✅ RSVP Status Cleaned and Refreshed')
        .setDescription(`Successfully cleaned ${beforeCount.length} RSVP entries from the database and refreshed all thread RSVP displays.`)
        .addFields(
          { name: '🗑️ Database Cleanup', value: `Removed ${beforeCount.length} RSVP entries`, inline: true },
          { name: '🔄 Thread Refresh', value: `Processed ${refreshResults.processed} threads\nUpdated ${refreshResults.updated} displays`, inline: true },
          { name: '📊 Sync Status', value: `Synchronized: ${refreshResults.synchronized}\nErrors: ${refreshResults.errors}`, inline: true }
        )
        .setColor(0x00ff00)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      console.log(`RSVP cleanup and refresh completed by ${interaction.user.tag}: cleaned ${beforeCount.length} entries, processed ${refreshResults.processed} threads`);

    } catch (err) {
      console.error(`Error handling /clean-rsvp-status command: ${err.message}`);
      await interaction.editReply('❌ Sorry, there was an error cleaning RSVP status and refreshing threads.');
    }
  }

  /**
   * Handle /cleanup-threads command (admin only)
   */
  async handleCleanupThreadsCommand(interaction) {
    if (!this.checkAdminPermissions(interaction)) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      await this.discordService.cleanupStaleThreads();
      
      const embed = new EmbedBuilder()
        .setTitle('✅ Thread Cleanup Complete')
        .setDescription('Successfully cleaned up stale match threads.')
        .setColor(0x00ff00)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      console.log(`Thread cleanup completed by ${interaction.user.tag}`);

    } catch (err) {
      console.error(`Error handling /cleanup-threads command: ${err.message}`);
      await interaction.editReply('❌ Sorry, there was an error cleaning up threads.');
    }
  }

  /**
   * Handle /backup-create command (admin only)
   */
  async handleBackupCreateCommand(interaction) {
    if (!this.checkAdminPermissions(interaction)) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      console.log(`User ${interaction.user.tag} requested manual backup creation`);

      const result = await this.backupService.performBackup('manual');
      
      if (result.success) {
        const embed = new EmbedBuilder()
          .setTitle('💾 Database Backup Created Successfully')
          .setDescription('Manual database backup completed successfully!')
          .addFields(
            { name: '📁 Backup Location', value: `\`${result.backupPath.split('\\').pop()}\``, inline: false },
            { name: '📊 File Size', value: `${(result.size / 1024 / 1024).toFixed(2)} MB`, inline: true },
            { name: '⏱️ Duration', value: `${result.duration}ms`, inline: true },
            { name: '🔐 Method', value: 'SQLite VACUUM INTO', inline: true }
          )
          .setColor(0x00ff00)
          .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
        console.log(`Manual backup created successfully by ${interaction.user.tag}`);
      } else {
        await interaction.editReply(`❌ Backup failed: ${result.error}`);
      }
    } catch (err) {
      console.error(`Error handling /backup-create command: ${err.message}`);
      await interaction.editReply('❌ Sorry, there was an error creating the backup.');
    }
  }

  /**
   * Handle /backup-list command (admin only)
   */
  async handleBackupListCommand(interaction) {
    if (!this.checkAdminPermissions(interaction)) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      console.log(`User ${interaction.user.tag} requested backup list`);

      const backups = await this.backupService.listBackups();
      const status = await this.backupService.getStatus();
      
      if (backups.length === 0) {
        await interaction.editReply('📂 No database backups found.');
        return;
      }

      const totalSize = backups.reduce((sum, backup) => sum + backup.size, 0);
      const embed = new EmbedBuilder()
        .setTitle('📋 Database Backup List')
        .setDescription(`Found ${backups.length} backup(s) totaling ${(totalSize / 1024 / 1024).toFixed(2)} MB`)
        .setColor(0x0099ff)
        .setTimestamp();

      // Show up to 10 most recent backups
      const recentBackups = backups.slice(0, 10);
      let backupList = '';
      
      recentBackups.forEach((backup, index) => {
        const created = new Date(backup.created).toLocaleString();
        backupList += `**${index + 1}.** \`${backup.name}\`\n`;
        backupList += `   📅 ${created}\n`;
        backupList += `   📊 ${backup.sizeFormatted}\n\n`;
      });

      if (backupList.length > 4000) {
        backupList = backupList.substring(0, 3900) + '...\n\n*List truncated*';
      }

      embed.addFields({
        name: '🗂️ Recent Backups',
        value: backupList || 'No backups to display',
        inline: false
      });

      if (status.latestBackup) {
        embed.addFields({
          name: '✨ Latest Backup',
          value: `${status.latestBackup.name}\n📅 ${new Date(status.latestBackup.created).toLocaleString()}\n📊 ${status.latestBackup.sizeFormatted}`,
          inline: false
        });
      }

      if (backups.length > 10) {
        embed.setFooter({ text: `Showing 10 of ${backups.length} total backups` });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(`Error handling /backup-list command: ${err.message}`);
      await interaction.editReply('❌ Sorry, there was an error listing backups.');
    }
  }

  /**
   * Handle /backup-status command (admin only)
   */
  async handleBackupStatusCommand(interaction) {
    if (!this.checkAdminPermissions(interaction)) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      console.log(`User ${interaction.user.tag} requested backup status`);

      const status = await this.backupService.getStatus();
      
      const embed = new EmbedBuilder()
        .setTitle('💾 Backup Service Status')
        .setColor(status.isRunning ? 0xff9500 : 0x00ff00)
        .setTimestamp();

      const serviceStatus = status.isRunning ? '🟡 Backup in progress...' : '🟢 Ready';
      const periodicStatus = status.periodicBackupsEnabled ? '✅ Enabled (every 6 hours)' : '❌ Disabled';
      
      embed.addFields(
        { name: '🔧 Service Status', value: serviceStatus, inline: true },
        { name: '⏰ Periodic Backups', value: periodicStatus, inline: true },
        { name: '📂 Backup Directory', value: `\`${status.backupDirectory}\``, inline: false }
      );

      if (!status.error) {
        const totalSizeMB = (status.totalBackupSize / 1024 / 1024).toFixed(2);
        
        embed.addFields(
          { name: '📊 Statistics', value: `**Total Backups:** ${status.totalBackups}\n**Total Size:** ${totalSizeMB} MB`, inline: true }
        );

        if (status.latestBackup) {
          const latestDate = new Date(status.latestBackup.created).toLocaleString();
          embed.addFields({
            name: '✨ Latest Backup',
            value: `**File:** ${status.latestBackup.name}\n**Size:** ${status.latestBackup.sizeFormatted}\n**Created:** ${latestDate}`,
            inline: true
          });
        }

        if (status.oldestBackup && status.totalBackups > 1) {
          const oldestDate = new Date(status.oldestBackup.created).toLocaleString();
          embed.addFields({
            name: '📅 Oldest Backup',
            value: `**File:** ${status.oldestBackup.name}\n**Created:** ${oldestDate}`,
            inline: true
          });
        }
      } else {
        embed.addFields({
          name: '❌ Error',
          value: status.error,
          inline: false
        });
        embed.setColor(0xff0000);
      }

      embed.addFields({
        name: '💡 Tips',
        value: '• Use `/backup-create` for manual backups\n• Use `/backup-list` to view all backups\n• Backups are stored with SQLite VACUUM for data integrity',
        inline: false
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(`Error handling /backup-status command: ${err.message}`);
      await interaction.editReply('❌ Sorry, there was an error getting backup status.');
    }
  }

  /**
   * Handle registration button clicks
   * This should be called from your main button handler
   */
  async handleRegistrationButton(interaction) {
    // Parse the custom ID: register_{player_id}_{nickname}
    const customIdParts = interaction.customId.split('_');
    if (customIdParts.length < 3 || customIdParts[0] !== 'register') {
      await interaction.reply({
        content: '❌ Invalid registration button.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // Defer reply immediately to avoid timeout
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const playerId = customIdParts[1];
    const nickname = customIdParts.slice(2).join('_'); // In case nickname has underscores
    const userId = interaction.user.id;
    const username = interaction.user.username;

    try {
      console.log(`User ${interaction.user.tag} clicked registration button for ${nickname}`);

      // Check if user is already linked - query database directly to avoid cache issues
      const existingMapping = await this.db.getUserMappingByDiscordIdFromDB(userId);
      console.log(`🔍 Check user already linked (from DB): ${userId} -> ${existingMapping ? existingMapping.faceit_nickname : 'none'}`);
      if (existingMapping) {
        console.log(`❌ User ${interaction.user.tag} already linked to ${existingMapping.faceit_nickname}`);
        await interaction.editReply({
          content: `❌ You are already linked to FACEIT account **${existingMapping.faceit_nickname}**. Use \`/unlink\` first if you want to link a different account.`
        });
        return;
      }

      // Check if this FACEIT account is already linked to someone else - query database directly
      console.log(`🔍 Checking if FACEIT ID ${playerId} is already linked to another user (from DB)...`);
      const existingUser = await this.db.getUserMappingByFaceitIdFromDB(playerId);
      console.log(`🔍 FACEIT ID ${playerId} existing user check result (from DB):`, existingUser ? { discord_id: existingUser.discord_id, faceit_nickname: existingUser.faceit_nickname } : 'none');
      if (existingUser) {
        console.log(`❌ FACEIT account ${nickname} (${playerId}) already linked to Discord user ${existingUser.discord_id}`);
        await interaction.editReply({
          content: `❌ FACEIT account **${nickname}** is already linked to another Discord user.`
        });
        return;
      }

      // Get player details from FACEIT API to ensure we have complete info
      const playerDetails = await faceitService.searchFaceitAccounts(nickname);
      const exactMatch = playerDetails.find(player => player.player_id === playerId);

      if (!exactMatch) {
        await interaction.editReply({
          content: `❌ Could not find player details for **${nickname}**. Please try again or use \`/link ${nickname}\` manually.`
        });
        return;
      }

      // Link the account
      await this.db.addUserMapping(userId, username, {
        nickname: exactMatch.nickname,
        player_id: exactMatch.player_id,
        skill_level: exactMatch.games?.cs2?.skill_level || exactMatch.games?.csgo?.skill_level || 'Unknown',
        faceit_elo: exactMatch.games?.cs2?.faceit_elo || exactMatch.games?.csgo?.faceit_elo || 'Unknown',
        country: exactMatch.country || 'Unknown'
      });

      const embed = new EmbedBuilder()
        .setTitle('✅ Successfully Linked!')
        .setDescription(`Your Discord account has been linked to FACEIT account **[${exactMatch.nickname}](https://www.faceit.com/en/players/${exactMatch.nickname})**`)
        .setColor(0x00ff00)
        .setTimestamp();
      
      // Only add fields that have meaningful values (same logic as profile command)
      const fields = [];
      
      const skillLevel = exactMatch.games?.cs2?.skill_level || exactMatch.games?.csgo?.skill_level;
      const elo = exactMatch.games?.cs2?.faceit_elo || exactMatch.games?.csgo?.faceit_elo;
      const currentGame = exactMatch.games?.cs2 ? 'CS2' : exactMatch.games?.csgo ? 'CS:GO' : null;
      
      // Only show skill level if it has a real value
      if (skillLevel && skillLevel !== 'Unknown') {
        fields.push({ name: '🏆 Skill Level', value: `Level ${skillLevel}`, inline: true });
      }
      // Only show ELO if it has a real value
      if (elo && elo !== 'Unknown') {
        fields.push({ name: '📊 ELO', value: `${elo}`, inline: true });
      }
      // Only show game if detected
      if (currentGame) {
        fields.push({ name: '🎯 Game', value: currentGame, inline: true });
      }
      // Only show country if available
      if (exactMatch.country && exactMatch.country !== 'Unknown') {
        fields.push({ name: '🌍 Country', value: exactMatch.country.toUpperCase(), inline: true });
      }
      
      if (fields.length > 0) {
        embed.addFields(fields);
      }

      await interaction.editReply({ embeds: [embed] });
      console.log(`Successfully linked ${interaction.user.tag} to FACEIT account ${exactMatch.nickname} via button`);

    } catch (err) {
      console.error(`Error handling registration button: ${err.message}`);
      
      // Use editReply since we already deferred
      if (!interaction.replied) {
        try {
          await interaction.editReply({
            content: '❌ Sorry, there was an error linking your account. Please try again later.'
          });
        } catch (replyError) {
          console.error(`Failed to edit reply for registration button interaction: ${replyError.message}`);
        }
      }
    }
  }
}

module.exports = SlashCommandHandler;
