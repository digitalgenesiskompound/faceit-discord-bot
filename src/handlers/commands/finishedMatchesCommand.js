const { EmbedBuilder } = require('discord.js');
const config = require('../../config/config');

class FinishedMatchesCommand {
  constructor(databaseService, discordService, faceitService) {
    this.db = databaseService;
    this.discordService = discordService;
    this.faceitService = faceitService;
    this.command = '!finishedmatches';
  }

  async handle(message, args) {
    // Admin-only command
    if (message.author.id !== config.adminDiscordId) {
      await message.reply('❌ This command is only available to administrators.');
      return;
    }

    try {
      // Send initial response
      const initialMessage = await message.reply('🔄 Checking for finished matches and creating threads...');

      // Get finished matches
      const limit = args && args[0] ? parseInt(args[0]) : 10;
      const finishedMatches = await this.faceitService.getFinishedMatches(limit);

      if (finishedMatches.length === 0) {
        await initialMessage.edit('❌ No finished matches found.');
        return;
      }

      let createdThreads = 0;
      let skippedThreads = 0;

      // Process each finished match
      for (const match of finishedMatches) {
        try {
          // Check if thread already exists
          const hasThread = await this.db.hasFinishedMatchThread(match.match_id);
          
          if (hasThread) {
            skippedThreads++;
            console.log(`Finished match thread already exists for match ${match.match_id}`);
            continue;
          }

          // Create finished match thread
          const thread = await this.discordService.createFinishedMatchThread(match, message.channel);
          
          if (thread) {
            createdThreads++;
            console.log(`Created finished match thread for: ${match.teams.faction1.name} vs ${match.teams.faction2.name}`);
          }

          // Add small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (matchErr) {
          console.error(`Error processing finished match ${match.match_id}: ${matchErr.message}`);
        }
      }

      // Create summary embed
      const summaryEmbed = new EmbedBuilder()
        .setTitle('📊 Finished Matches Processing Complete')
        .setDescription(`Processed ${finishedMatches.length} finished matches`)
        .addFields(
          {
            name: '✅ New Threads Created',
            value: createdThreads.toString(),
            inline: true
          },
          {
            name: '⏭️ Skipped (Already Exist)',
            value: skippedThreads.toString(),
            inline: true
          },
          {
            name: '🎯 Total Matches Found',
            value: finishedMatches.length.toString(),
            inline: true
          }
        )
        .setColor(createdThreads > 0 ? 0x00ff00 : 0x808080)
        .setTimestamp();

      await initialMessage.edit({ 
        content: '', 
        embeds: [summaryEmbed] 
      });

      console.log(`Finished matches processing complete: ${createdThreads} created, ${skippedThreads} skipped`);

    } catch (err) {
      console.error(`Error in finished matches command: ${err.message}`);
      await message.reply('❌ Error processing finished matches. Check console for details.');
    }
  }
}

module.exports = FinishedMatchesCommand;
