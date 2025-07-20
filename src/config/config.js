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
  
  // Admin Configuration
  adminDiscordId: process.env.ADMIN_DISCORD_ID,
  
  // File paths
  paths: {
    dataDir: path.join(__dirname, '../../data'),
    database: path.join(__dirname, '../../data/bot.db')
  },
  
  // Server Configuration
  server: {
    port: 8080
  }
};

module.exports = config;
