// Export all command handlers for easier management
module.exports = {
  RegisterCommand: require('./registerCommand'),
  LinkCommand: require('./linkCommand'),
  MatchesCommand: require('./matchesCommand'),
  ProfileCommand: require('./profileCommand'),
  HelpCommand: require('./helpCommand'),
  NotifyCommand: require('./notifyCommand'),
  LookupCommand: require('./lookupCommand'),
  StatusCommand: require('./statusCommand'),
  ListPlayersCommand: require('./listPlayersCommand'),
  UnlinkCommand: require('./unlinkCommand'),
  CleanUserMappingsCommand: require('./cleanUserMappingsCommand'),
  CleanRsvpStatusCommand: require('./cleanRsvpStatusCommand'),
  CommandManager: require('./commandManager')
};
