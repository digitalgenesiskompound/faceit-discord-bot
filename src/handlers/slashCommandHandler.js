const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
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

    // List players command
    const listPlayersCommand = new SlashCommandBuilder()
      .setName('listplayers')
      .setDescription('List all team players');

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
    this.commands.set('listplayers', listPlayersCommand);
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
        case 'listplayers':
          await this.handleListPlayersCommand(interaction);
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
            ephemeral: true 
          });
      }
    } catch (error) {
      console.error(`Error handling slash command ${commandName}:`, error);
      const errorMessage = '❌ Sorry, there was an error processing your command.';
      
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ content: errorMessage });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
  }

  /**
   * Handle /matches command
   */
  async handleMatchesCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      console.log(`User ${interaction.user.tag} requested matches list via slash command`);
      
      const matches = await faceitService.getUpcomingMatches();
      
      if (matches.length === 0) {
        await interaction.editReply('No upcoming matches found for your team.');
        return;
      }
      
      const embed = new EmbedBuilder()
        .setTitle('🎮 Upcoming FACEIT Matches')
        .setColor(0x0099ff)
        .setTimestamp();
      
      let description = '';
      
      // Process matches sequentially to handle async RSVP calls
      for (let index = 0; index < matches.length; index++) {
        const match = matches[index];
        const faction1 = match.teams.faction1?.name || 'TBD';
        const faction2 = match.teams.faction2?.name || 'TBD';
        const matchTimes = formatMatchTime(match.scheduled_at);
        const matchUrl = `https://www.faceit.com/en/cs2/room/${match.match_id}`;
        
        // Check if this match has any RSVPs
        try {
          const matchRsvps = this.db.getRsvpForMatch(match.match_id);
          const rsvpCount = Object.keys(matchRsvps).length;
          const rsvpIndicator = rsvpCount > 0 ? ` (${rsvpCount} RSVPs)` : '';
          
        description += `**${index + 1}.** ${faction1} vs ${faction2}${rsvpIndicator}\n`;
        } catch (rsvpError) {
          // If RSVP check fails, continue without RSVP count
          description += `**${index + 1}.** ${faction1} vs ${faction2}\n`;
        }
        
        description += `📅 ${matchTimes.pacific} / ${matchTimes.mountain}\n`;
        description += `🔗 [View Match](${matchUrl})\n`;
        description += `🆔 Match ID: \`${match.match_id}\`\n\n`;
      }
      
      embed.setDescription(description);
      
      await interaction.editReply({ embeds: [embed] });
      
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
    
    try {
      const mapping = await this.db.getUserMappingByDiscordId(userId);
      if (!mapping) {
        await interaction.reply({
          content: 'You don\'t have a linked FACEIT account. Use `/register` to see available players, then `/link <nickname>` to link your account.',
          ephemeral: true
        });
        return;
      }
      
      const embed = new EmbedBuilder()
        .setTitle('🎮 Your Linked FACEIT Account')
        .setDescription(`**[${mapping.faceit_nickname}](https://www.faceit.com/en/players/${mapping.faceit_nickname})**`)
        .addFields(
          { name: '🏆 Skill Level', value: `${mapping.faceit_skill_level} (${mapping.faceit_elo} ELO)`, inline: true },
          { name: '🌍 Country', value: mapping.country, inline: true },
          { name: '📅 Linked On', value: new Date(mapping.registered_at).toLocaleDateString(), inline: true }
        )
        .setColor(0xff5500)
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
      
    } catch (err) {
      console.error(`Error handling /profile command: ${err.message}`);
        await interaction.reply({
          content: 'Sorry, there was an error retrieving your profile.',
          ephemeral: true
        });
    }
  }

  /**
   * Handle /listplayers command
   */
  async handleListPlayersCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      console.log(`User ${interaction.user.tag} requested team players list via slash command`);
      const players = await faceitService.listTeamPlayers();

      if (players.length === 0) {
        await interaction.editReply('No players found for your team.');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🎮 Team Players')
        .setColor(0x0099ff)
        .setTimestamp();

      players.forEach((player, index) => {
        embed.addFields({ name: `${index + 1}. ${player.nickname}`, value: `Player ID: ${player.user_id}`, inline: false });
      });

      await interaction.editReply({ embeds: [embed] });
      console.log(`Sent ${players.length} team players via slash command to user ${interaction.user.tag}`);

    } catch (err) {
      console.error(`Error handling /listplayers command: ${err.message}`);
        await interaction.editReply('Sorry, there was an error fetching the player list.');
    }
  }

  /**
   * Handle /lookup command
   */
  async handleLookupCommand(interaction) {
    const query = interaction.options.getString('query');
    
    await interaction.deferReply({ ephemeral: true });

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
      ephemeral: true
    });
  }

  /**
   * Handle /help command
   */
  async handleHelpCommand(interaction) {
    const isAdmin = interaction.member?.permissions.has('ADMINISTRATOR');
    const canManageChannels = interaction.member?.permissions.has('MANAGE_CHANNELS');
    const isConfiguredAdmin = config.adminDiscordId && interaction.user.id === config.adminDiscordId;

    const embed = new EmbedBuilder()
      .setTitle('🤖 FACEIT Bot Commands')
      .setDescription('Here are the available slash commands:')
      .addFields(
        { name: '🎮 Match Commands', value: '`/matches` - View upcoming matches\n`/finishedmatches [limit]` - View recent results', inline: false },
        { name: '👤 Profile Commands', value: '`/profile` - View your linked FACEIT profile\n`/register` - See available team players\n`/link <nickname>` - Link your FACEIT account\n`/unlink` - Unlink your FACEIT account', inline: false },
        { name: '👥 Team Commands', value: '`/listplayers` - List all team players\n`/lookup <query>` - Search FACEIT accounts\n`/status [match_id]` - View RSVP status', inline: false },
        { name: '❓ Other Commands', value: '`/help` - Show this help message', inline: false }
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
        adminCommands.push('`/clear-cache` - Clear memory caches');
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

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  /**
   * Handle /finishedmatches command
   */
  async handleFinishedMatchesCommand(interaction) {
    const limit = interaction.options.getInteger('limit') || 10;
    
    await interaction.deferReply({ ephemeral: true });

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
          ephemeral: true
        });
        return;
      }

      // Search for the FACEIT account
      const results = await faceitService.searchFaceitAccounts(nickname);
      const exactMatch = results.find(player => player.nickname.toLowerCase() === nickname.toLowerCase());

      if (!exactMatch) {
        await interaction.reply({
          content: `❌ No FACEIT account found with nickname "${nickname}". Please check the spelling (it's case-sensitive) and try again.`,
          ephemeral: true
        });
        return;
      }

      // Check if this FACEIT account is already linked to someone else
      const existingUser = await this.db.getUserMappingByFaceitId(exactMatch.player_id);
      if (existingUser) {
        await interaction.reply({
          content: `❌ FACEIT account **${nickname}** is already linked to another Discord user.`,
          ephemeral: true
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

      await interaction.reply({ embeds: [embed], ephemeral: true });
      console.log(`Successfully linked ${interaction.user.tag} to FACEIT account ${exactMatch.nickname}`);

    } catch (err) {
      console.error(`Error handling /link command: ${err.message}`);
      await interaction.reply({
        content: '❌ Sorry, there was an error linking your account. Please try again later.',
        ephemeral: true
      });
    }
  }

  /**
   * Handle /register command
   */
  async handleRegisterCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      console.log(`User ${interaction.user.tag} requested team registration info`);
      const players = await faceitService.listTeamPlayers();

      if (players.length === 0) {
        await interaction.editReply('No players found for your team.');
        return;
      }

      // Create a simple, clean list of player names
      const playerList = players.map((player, index) => `${index + 1}. **${player.nickname}**`).join('\n');
      
      const embed = new EmbedBuilder()
        .setTitle('📝 Available Team Players')
        .setDescription(`Here are the team players you can link to:\n\n${playerList}`)
        .setColor(0xff5500)
        .setTimestamp()
        .setFooter({ text: 'Use /link <nickname> to link your account (case-sensitive)' });

      await interaction.editReply({ embeds: [embed] });
      console.log(`Sent registration info with ${players.length} team players to ${interaction.user.tag}`);

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
          ephemeral: true
        });
        return;
      }

      await this.db.removeUserMapping(userId);

      const embed = new EmbedBuilder()
        .setTitle('✅ Successfully Unlinked!')
        .setDescription(`Your Discord account has been unlinked from FACEIT account **${existingMapping.faceit_nickname}**.`)
        .setColor(0x00ff00)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      console.log(`Successfully unlinked ${interaction.user.tag} from FACEIT account ${existingMapping.faceit_nickname}`);

    } catch (err) {
      console.error(`Error handling /unlink command: ${err.message}`);
      await interaction.reply({
        content: '❌ Sorry, there was an error unlinking your account.',
        ephemeral: true
      });
    }
  }

  /**
   * Handle /notify command (admin only)
   */
  async handleNotifyCommand(interaction) {
    // Check if user is the configured admin or has admin permissions
    const isConfiguredAdmin = config.adminDiscordId && interaction.user.id === config.adminDiscordId;
    const hasAdminPerms = interaction.member?.permissions.has('ADMINISTRATOR');
    
    if (!isConfiguredAdmin && !hasAdminPerms) {
      await interaction.reply({
        content: '❌ This command requires administrator permissions or being the configured admin.',
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

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
    if (!interaction.member?.permissions.has('MANAGE_CHANNELS')) {
      interaction.reply({
        content: '❌ You need "Manage Channels" permission or be the configured admin to use this command.',
        ephemeral: true
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

    await interaction.deferReply({ ephemeral: true });

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

      // Clear all in-memory caches
      if (this.db.processedMatches) this.db.processedMatches = [];
      if (this.db.userMappings) this.db.userMappings = {};
      if (this.db.rsvpStatus) this.db.rsvpStatus = {};
      if (this.db.matchThreads) this.db.matchThreads = new Map();
      if (this.db.upcomingMatches) this.db.upcomingMatches = new Map();
      if (this.db.userSearchResults) this.db.userSearchResults = new Map();

      const embed = new EmbedBuilder()
        .setTitle('🔄 Cache Cleared Successfully')
        .setDescription('All in-memory caches have been cleared.')
        .setColor(0x00ff00)
        .addFields({
          name: 'Cache Stats Before Clear',
          value: `Processed Matches: ${beforeStats.processedMatches}\nUser Mappings: ${beforeStats.userMappings}\nRSVP Status: ${beforeStats.rsvpStatus}`,
          inline: false
        })
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
    const hasAdminPerms = interaction.member?.permissions.has('ADMINISTRATOR');
    
    if (!isConfiguredAdmin && !hasAdminPerms) {
      await interaction.reply({
        content: '❌ You need administrator permissions or be the configured admin to use this command.',
        ephemeral: true
      });
      return;
    }

    try {
      console.log(`User ${interaction.user.tag} requested bot restart`);

      await interaction.reply({
        content: '🔄 Restarting bot... The bot will be back online shortly.',
        ephemeral: true
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
        ephemeral: true
      });
    }
  }

  /**
   * Handle /clean-user-mappings command (admin only)
   */
  async handleCleanUserMappingsCommand(interaction) {
    if (!this.checkAdminPermissions(interaction)) return;

    await interaction.deferReply({ ephemeral: true });

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

    await interaction.deferReply({ ephemeral: true });

    try {
      const beforeCount = await this.db.getAllRsvpData();
      await this.db.clearAllRsvpData();
      
      const embed = new EmbedBuilder()
        .setTitle('✅ RSVP Status Cleaned')
        .setDescription(`Successfully cleaned ${beforeCount.length} RSVP entries from the database.`)
        .setColor(0x00ff00)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      console.log(`Cleaned ${beforeCount.length} RSVP entries by ${interaction.user.tag}`);

    } catch (err) {
      console.error(`Error handling /clean-rsvp-status command: ${err.message}`);
      await interaction.editReply('❌ Sorry, there was an error cleaning RSVP status.');
    }
  }

  /**
   * Handle /cleanup-threads command (admin only)
   */
  async handleCleanupThreadsCommand(interaction) {
    if (!this.checkAdminPermissions(interaction)) return;

    await interaction.deferReply({ ephemeral: true });

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

    await interaction.deferReply({ ephemeral: true });

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

    await interaction.deferReply({ ephemeral: true });

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

    await interaction.deferReply({ ephemeral: true });

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
}

module.exports = SlashCommandHandler;
