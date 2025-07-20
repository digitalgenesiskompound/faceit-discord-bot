const { EmbedBuilder } = require('discord.js');
const faceitService = require('../../services/faceitService');
const config = require('../../config/config');

class LookupCommand {
  constructor(databaseService, discordService) {
    this.db = databaseService;
    this.discordService = discordService;
    this.command = '!lookup';
    this.adminOnly = false; // Allow both admin and regular users
  }

  async handle(message) {
    const args = message.content.split(' ');
    const isAdmin = message.author.id === config.adminDiscordId;

    if (args.length < 2) {
      const usage = isAdmin 
        ? '❌ Please provide a search term. Usage: `!lookup <username|discord_id|faceit_nickname>` (Admin: searches database) or `!lookup faceit <nickname>` (searches FACEIT)'
        : '❌ Please provide a search term. Usage: `!lookup <faceit_nickname>` (searches FACEIT accounts)';
      await message.reply(usage);
      return;
    }

    const query = args.slice(1).join(' ');
    console.log(`${isAdmin ? 'Admin' : 'User'} ${message.author.tag} is searching for: ${query}`);

    try {
      // Check if this is a FACEIT search (for both users) or admin wants to search FACEIT specifically
      if (query.toLowerCase().startsWith('faceit ') || !isAdmin) {
        const faceitQuery = isAdmin && query.toLowerCase().startsWith('faceit ') 
          ? query.slice(7) // Remove 'faceit ' prefix
          : query;
        
        await this.handleFaceitSearch(message, faceitQuery);
        return;
      }

      // Admin-only database search functionality
      if (isAdmin) {
        await this.handleDatabaseSearch(message, query.toLowerCase());
      } else {
        await message.reply('❌ Database search is restricted to administrators. Use `!lookup <faceit_nickname>` to search FACEIT accounts.');
      }
    } catch (err) {
      console.error(`Error handling !lookup command: ${err.message}`);
      await message.reply('❌ Sorry, there was an error performing the lookup.');
    }
  }

  async handleDatabaseSearch(message, query) {
    const user = this.db.findUserByQuery(query);

    if (!user) {
      await message.reply(`❌ No database mappings found for "${query}". Please search by Discord username, Discord ID, or FACEIT nickname.`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('🔍 Database User Lookup Result')
      .setDescription(`**FACEIT Account:** [${user.faceit_nickname}](https://www.faceit.com/en/players/${user.faceit_nickname})`)
      .addFields(
        { name: 'Discord Username', value: user.discord_username, inline: true },
        { name: 'Discord ID', value: user.discord_id, inline: true },
        { name: '🏆 Skill Level', value: `${user.faceit_skill_level} (${user.faceit_elo} ELO)`, inline: true },
        { name: '🌍 Country', value: user.country, inline: true }
      )
      .setColor(0x00ff00)
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }

  async handleFaceitSearch(message, query) {
    const results = await faceitService.searchFaceitAccounts(query);
    
    if (results.length === 0) {
      await message.reply(`❌ No FACEIT accounts found for "${query}".`);
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

    await message.reply({ embeds: [embed] });
  }
}

module.exports = LookupCommand;
