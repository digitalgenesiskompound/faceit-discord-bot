class UnlinkCommand {
  constructor(databaseService, discordService) {
    this.db = databaseService;
    this.discordService = discordService;
    this.command = '!unlink';
  }

  async handle(message) {
    const userId = message.author.id;
    
    try {
      const existingMapping = this.db.getUserMappingByDiscordId(userId);
      if (!existingMapping) {
        await message.reply('❌ You are not currently linked to any FACEIT account.');
        return;
      }

      await this.db.removeUserMapping(userId);
      
      await message.reply(`✅ Successfully unlinked your Discord account from FACEIT account **${existingMapping.faceit_nickname}**.`);
      console.log(`User ${message.author.tag} unlinked from FACEIT account ${existingMapping.faceit_nickname}`);
      
    } catch (err) {
      console.error(`Error handling !unlink command: ${err.message}`);
      await message.reply('❌ Sorry, there was an error unlinking your account.');
    }
  }
}

module.exports = UnlinkCommand;
