const CommandManager = require('./commands/commandManager');

class MessageHandler {
  constructor(client, databaseService, discordService) {
    this.client = client;
    this.db = databaseService;
    this.discordService = discordService;
    this.commandManager = new CommandManager(databaseService, discordService);
  }

  /**
   * Handle all message commands using modular command architecture
   */
  async handleMessage(message) {
    // Delegate to command manager for modular handling
    await this.commandManager.handleMessage(message);
  }

}

module.exports = MessageHandler;
