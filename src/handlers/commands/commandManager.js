const RegisterCommand = require('./registerCommand');
const LinkCommand = require('./linkCommand');
const MatchesCommand = require('./matchesCommand');
const ProfileCommand = require('./profileCommand');
const HelpCommand = require('./helpCommand');
const NotifyCommand = require('./notifyCommand');
const LookupCommand = require('./lookupCommand');
const StatusCommand = require('./statusCommand');
const ListPlayersCommand = require('./listPlayersCommand');
const UnlinkCommand = require('./unlinkCommand');
const CleanUserMappingsCommand = require('./cleanUserMappingsCommand');
const CleanRsvpStatusCommand = require('./cleanRsvpStatusCommand');
const CleanupThreadsCommand = require('./cleanupThreadsCommand');
const FinishedMatchesCommand = require('./finishedMatchesCommand');
const faceitService = require('../../services/faceitService');

class CommandManager {
  constructor(databaseService, discordService) {
    this.db = databaseService;
    this.discordService = discordService;
    this.commands = new Map();
    
    this.initializeCommands();
  }

  initializeCommands() {
    // Initialize all command handlers
    const commandHandlers = [
      new RegisterCommand(this.db, this.discordService),
      new LinkCommand(this.db, this.discordService),
      new MatchesCommand(this.db, this.discordService),
      new ProfileCommand(this.db, this.discordService),
      new HelpCommand(this.db, this.discordService),
      new NotifyCommand(this.db, this.discordService),
      new LookupCommand(this.db, this.discordService),
      new StatusCommand(this.db, this.discordService),
      new ListPlayersCommand(this.db, this.discordService),
      new UnlinkCommand(this.db, this.discordService),
      new CleanUserMappingsCommand(this.db, this.discordService),
      new CleanRsvpStatusCommand(this.db, this.discordService),
      new CleanupThreadsCommand(this.db, this.discordService),
      new FinishedMatchesCommand(this.db, this.discordService, faceitService)
    ];

    // Register each command
    commandHandlers.forEach(handler => {
      this.commands.set(handler.command, handler);
    });

    console.log(`Initialized ${this.commands.size} command handlers`);
  }

  /**
   * Handle incoming messages and route to appropriate command handlers
   */
  async handleMessage(message) {
    if (message.author.bot) return;
    
    const content = message.content.toLowerCase();
    
    // Skip if message doesn't start with !
    if (!content.startsWith('!')) return;
    
    // Find the appropriate command handler
    for (const [command, handler] of this.commands.entries()) {
      if (content.startsWith(command)) {
        try {
          // Extract args from the message
          const args = message.content.slice(command.length).trim().split(/\s+/).filter(arg => arg.length > 0);
          await handler.handle(message, args);
          return;
        } catch (error) {
          console.error(`Error handling command ${command}: ${error.message}`);
          await message.reply('❌ Sorry, there was an error processing your command.');
        }
      }
    }
  }

  /**
   * Get list of all available commands
   */
  getAvailableCommands() {
    return Array.from(this.commands.keys());
  }

  /**
   * Get a specific command handler
   */
  getCommand(commandName) {
    return this.commands.get(commandName);
  }
}

module.exports = CommandManager;
