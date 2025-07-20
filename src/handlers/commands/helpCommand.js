const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../config/config');

class HelpCommand {
  constructor(databaseService, discordService) {
    this.db = databaseService;
    this.discordService = discordService;
    this.command = '!help';
  }

  async handle(message, args) {
    // Check if user wants admin help specifically
    const topic = args && args[0] ? args[0].toLowerCase() : null;
    
    if (topic === 'admin' || topic === 'administrator') {
      // Check if user has admin permissions
      if (message.author.id !== config.adminDiscordId) {
        await message.reply('❌ You do not have permission to view admin commands.');
        return;
      }
      const embed = this.createAdminHelpEmbed();
      await message.reply({ embeds: [embed] });
      return;
    }

    // Main help embed with all commands
    const embed = new EmbedBuilder()
      .setTitle('🎮 FACEIT Match Bot - Help')
      .setDescription('**Welcome to the FACEIT Match Bot!** This bot automatically notifies you about upcoming team matches and helps manage RSVPs.\n\n**🚀 Getting Started:** Link your FACEIT account using `!register` to see team players, then `!link <your_faceit_name>` to connect your account.')
      .addFields(
        { 
          name: '🔗 Account Commands', 
          value: '`!register` - View all team players available to link\n`!link <name>` - Link your Discord to FACEIT account\n`!unlink` - Remove your account link\n`!profile` - View your current linked profile\n`!listplayers` - See all registered team members', 
          inline: false 
        },
        { 
          name: '🎮 Match Commands', 
          value: '`!matches` - Show all upcoming matches\n`!status <match_id>` - Check RSVP status for specific match\n`!lookup <name>` - Search for FACEIT player profiles', 
          inline: false 
        },
        { 
          name: '📋 RSVP System', 
          value: '• Click ✅ for "Attending" or ❌ for "Not Attending" on notifications\n• Click 📋 to view current RSVP status\n• Each match gets its own discussion thread\n• RSVP status updates automatically in real-time', 
          inline: false 
        }
      )
      .setColor(0x0099ff)
      .setFooter({ text: 'You must link your FACEIT account to receive match notifications and RSVP' })
      .setTimestamp();
    
    // Create admin button (only show if user has admin permissions)
    const components = [];
    if (message.author.id === config.adminDiscordId) {
      const adminButton = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('help_admin')
            .setLabel('👑 Admin Commands')
            .setStyle(ButtonStyle.Danger)
        );
      components.push(adminButton);
    }
    
    await message.reply({ embeds: [embed], components });
  }




  createAdminHelpEmbed() {
    return new EmbedBuilder()
      .setTitle('👑 Administrator Commands')
      .setDescription('**Admin-only commands for bot management and troubleshooting.**')
      .addFields(
        { 
          name: '🔧 Testing & Debugging', 
          value: '`!notify` - Send a test match notification\n`!listplayers` - View all registered players\n`!status <match_id>` - Check match RSVP status\n`!finishedmatches [limit]` - Create threads for finished matches', 
          inline: false 
        },
        { 
          name: '🧹 Cleanup Commands', 
          value: '`!cleanup-threads` - Remove stale/archived threads\n`!clean user_mappings` - Clear all user account links\n`!clean rsvp_status` - Clear all RSVP responses', 
          inline: false 
        },
        { 
          name: '📊 Monitoring', 
          value: '• Bot automatically checks matches every 30 minutes\n• Health monitoring tracks API connectivity\n• Error notifications sent for critical issues\n• Match threads auto-cleanup after expiration', 
          inline: false 
        },
        { 
          name: '⚠️ Admin Responsibilities', 
          value: '• Monitor bot logs for errors\n• Respond to user linking issues\n• Verify match notifications are working\n• Clean up old data when necessary\n• Update team roster as needed', 
          inline: false 
        },
        { 
          name: '🔐 Security Notes', 
          value: '• Clean commands permanently delete data\n• Test notifications don\'t affect match tracking\n• Only run cleanup when necessary\n• Monitor for spam or abuse', 
          inline: false 
        }
      )
      .setColor(0xff0000)
      .setFooter({ text: 'Admin commands require appropriate Discord permissions' })
      .setTimestamp();
  }

}

module.exports = HelpCommand;
