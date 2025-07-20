const faceitService = require('../../services/faceitService');

class NotifyCommand {
  constructor(databaseService, discordService) {
    this.db = databaseService;
    this.discordService = discordService;
    this.command = '!notify';
    this.adminOnly = true;
  }

  async handle(message) {
    if (!message.member?.permissions.has('ADMINISTRATOR')) {
      await message.reply('❌ This command requires administrator permissions.');
      return;
    }

    try {
      const matches = await faceitService.getUpcomingMatches();
      console.log(`getUpcomingMatches() returned ${matches.length} matches`);
      if (matches.length > 0) {
        // Check if thread already exists for this match
        const existingThread = this.db.matchThreads.get(matches[0].match_id);
        if (existingThread) {
          await message.reply(`Test notification skipped - thread already exists for match ${matches[0].match_id}`);
          return;
        }
        
        await this.discordService.sendMatchNotification(matches[0], message.channel);
        await message.reply('Test notification sent!');
      } else {
        await message.reply('No matches available for test notification.');
      }
    } catch (err) {
      console.error(`Error handling !notify command: ${err.message}`);
      await message.reply('Sorry, there was an error sending the test notification.');
    }
  }
}

module.exports = NotifyCommand;
