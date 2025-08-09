require('dotenv').config();
const path = require('path');

const config = {
  // API Configuration
  faceit: {
    apiKey: process.env.FACEIT_API_KEY,
    teamId: process.env.TEAM_ID || 'cfbb8afd-6ab6-44a9-bf07-3de4f86889af',
    competitionId: 'f5aec3e5-57e5-4dde-a9d5-4e630766bc14'
  },
  
  // Discord Configuration
  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN,
    channelId: process.env.DISCORD_CHANNEL_ID
  },
  
  // Admin / Moderator Configuration
  adminDiscordId: process.env.ADMIN_DISCORD_ID,
  moderatorRoleName: process.env.MODERATOR_ROLE_NAME || 'Moderator',
  moderatorDiscordIds: (process.env.MODERATOR_DISCORD_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0),
  
  // File paths
  paths: {
    dataDir: path.join(__dirname, '../../data'),
    database: path.join(__dirname, '../../data/bot.db')
  },
  
  // Server Configuration
  server: {
    port: 8080
  },

  // Performance tuning
  tuning: {
    // If false, skip running recovery on startup
    startupRecovery: process.env.STARTUP_RECOVERY !== 'false',
    // Delay (ms) before running heavy validation tasks after ready
    startupValidationDelayMs: parseInt(process.env.STARTUP_VALIDATION_DELAY_MS || '30000', 10)
  }
};

module.exports = config;
