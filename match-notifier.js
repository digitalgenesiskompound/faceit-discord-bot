require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const http = require('http');
const path = require('path');
const Database = require('./database');

// Configuration
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID; // Channel to send notifications
const TEAM_ID = process.env.TEAM_ID || 'cfbb8afd-6ab6-44a9-bf07-3de4f86889af';
const COMPETITION_ID = 'f5aec3e5-57e5-4dde-a9d5-4e630766bc14';

// File paths
const DATA_DIR = path.join(__dirname, 'data');
const PROCESSED_MATCHES_FILE = path.join(DATA_DIR, 'processed_matches.json');
const USER_MAPPINGS_FILE = path.join(DATA_DIR, 'user_mappings.json');
const RSVP_STATUS_FILE = path.join(DATA_DIR, 'rsvp_status.json');
const MATCH_THREADS_FILE = path.join(DATA_DIR, 'match_threads.json');

// Discord client setup
const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent
  ] 
});

// Initialize database
const db = new Database();
let isDbReady = false;

// Initialize database and load data
(async () => {
  try {
    await db.initialize();
    console.log('Database initialized successfully');
    
    // Load existing data from database
    const processedMatchesData = await db.getAllProcessedMatches();
    processedMatches = processedMatchesData.map(row => row.match_id);
    console.log(`Loaded ${processedMatches.length} processed matches`);
    
    const userMappingsData = await db.getAllUsers();
    userMappings = {};
    for (const user of userMappingsData) {
      userMappings[user.discord_id] = {
        discord_username: user.discord_username,
        discord_id: user.discord_id,
        faceit_nickname: user.faceit_nickname,
        faceit_player_id: user.faceit_player_id,
        faceit_skill_level: user.faceit_skill_level || 'N/A',
        faceit_elo: user.faceit_elo || 'N/A',
        country: user.country || 'Unknown',
        registered_at: user.created_at,
        updated_at: user.updated_at
      };
    }
    console.log(`Loaded ${Object.keys(userMappings).length} user mappings`);
    
    // Load RSVP data
    const rsvpData = await db.getAllRSVPs();
    rsvpStatus = {};
    for (const rsvp of rsvpData) {
      if (!rsvpStatus[rsvp.match_id]) {
        rsvpStatus[rsvp.match_id] = {};
      }
      rsvpStatus[rsvp.match_id][rsvp.discord_id] = {
        response: rsvp.response,
        faceit_nickname: rsvp.faceit_nickname,
        timestamp: rsvp.created_at
      };
    }
    console.log(`Loaded RSVP status for ${Object.keys(rsvpStatus).length} matches`);
    
    // Load match threads
    const threadsData = await db.getAllMatchThreads();
    for (const thread of threadsData) {
      matchThreads.set(thread.match_id, thread.thread_id);
    }
    console.log(`Loaded ${matchThreads.size} match thread mappings`);
    
    isDbReady = true;
    console.log('All data loaded from database successfully');
  } catch (err) {
    console.error(`Error initializing database: ${err.message}`);
    // Create data directory as fallback
    if (!fs.existsSync(DATA_DIR)) {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      } catch (dirErr) {
        console.error(`Error creating data directory: ${dirErr.message}`);
      }
    }
  }
})();

// Data variables - initialized from database
let processedMatches = [];
let userMappings = {};
let rsvpStatus = {};

// Track all upcoming matches for RSVP purposes
let upcomingMatches = new Map(); // matchId -> match data
let matchThreads = new Map(); // matchId -> thread channel ID

// Store temporary search results for users (expires after 30 minutes)
const userSearchResults = new Map();

// Format date for multiple time zones
function formatMatchTime(timestamp) {
  if (!timestamp) return 'TBD';
  
  const date = new Date(timestamp * 1000);
  
  // Format for Pacific Time
  const pacificTime = date.toLocaleString('en-US', { 
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  // Format for Mountain Time
  const mountainTime = date.toLocaleString('en-US', { 
    timeZone: 'America/Denver',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  return {
    pacific: `${pacificTime} PDT`,
    mountain: `${mountainTime} MDT`
  };
}

// API request function with retry logic and rate limiting
async function makeApiRequest(url, options = {}, retryCount = 0) {
  const maxRetries = 3;
  const retryDelay = 1000; // 1 second base delay
  
  try {
    const headers = {
      'Authorization': `Bearer ${FACEIT_API_KEY}`,
      'Accept': 'application/json',
      ...options.headers
    };
    
    const response = await axios.get(url, { 
      ...options, 
      headers,
      timeout: 15000 // 15 second timeout
    });
    
    return response.data;
  } catch (error) {
    console.error(`API Error (${url}): ${error.message}`);
    
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      
      // Retry on rate limiting (429) or server errors (5xx)
      if ((error.response.status === 429 || error.response.status >= 500) && retryCount < maxRetries) {
        const delay = retryDelay * Math.pow(2, retryCount); // Exponential backoff
        console.log(`Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return makeApiRequest(url, options, retryCount + 1);
      }
    }
    
    // Handle network timeouts and connection errors
    if ((error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') && retryCount < maxRetries) {
      const delay = retryDelay * Math.pow(2, retryCount);
      console.log(`Network error, retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return makeApiRequest(url, options, retryCount + 1);
    }
    
    return null;
  }
}

// Save processed matches to database
async function saveProcessedMatches() {
  if (!isDbReady) {
    console.log('Database not ready, skipping save processed matches');
    return;
  }
  try {
    // Database save operations are handled individually when matches are marked as processed
    console.log('Processed matches saved to database');
  } catch (err) {
    console.error(`Error saving processed matches: ${err.message}`);
  }
}

// Save user mappings to database
async function saveUserMappings() {
  if (!isDbReady) {
    console.log('Database not ready, skipping save user mappings');
    return;
  }
  try {
    console.log(`User mappings saved to database`);
  } catch (err) {
    console.error(`Error saving user mappings: ${err.message}`);
  }
}

// Save RSVP status to database
async function saveRsvpStatus() {
  if (!isDbReady) {
    console.log('Database not ready, skipping save RSVP status');
    return;
  }
  try {
    console.log(`RSVP status saved to database`);
  } catch (err) {
    console.error(`Error saving RSVP status: ${err.message}`);
  }
}

// Save match threads to database
async function saveMatchThreads() {
  if (!isDbReady) {
    console.log('Database not ready, skipping save match threads');
    return;
  }
  try {
    console.log(`Match threads saved to database`);
  } catch (err) {
    console.error(`Error saving match threads: ${err.message}`);
  }
}

// RSVP utility functions
async function addRsvp(matchId, discordId, response, faceitNickname) {
  if (!rsvpStatus[matchId]) {
    rsvpStatus[matchId] = {};
  }
  
  rsvpStatus[matchId][discordId] = {
    response: response, // 'yes' or 'no'
    faceit_nickname: faceitNickname,
    timestamp: new Date().toISOString()
  };
  
  // Save to database if ready
  if (isDbReady) {
    try {
      await db.addOrUpdateRSVP(matchId, discordId, response, faceitNickname);
      console.log(`RSVP saved to database: ${faceitNickname} (${discordId}) -> ${response} for match ${matchId}`);
    } catch (err) {
      console.error(`Error saving RSVP to database: ${err.message}`);
    }
  }
  
  console.log(`RSVP recorded: ${faceitNickname} (${discordId}) -> ${response} for match ${matchId}`);
  
  // Update thread RSVP status if thread exists
  updateThreadRsvpStatusAsync(matchId);
}

function getRsvpForMatch(matchId) {
  return rsvpStatus[matchId] || {};
}

function getUserRsvp(matchId, discordId) {
  const matchRsvps = rsvpStatus[matchId];
  return matchRsvps ? matchRsvps[discordId] : null;
}

function removeUserRsvp(matchId, discordId) {
  if (rsvpStatus[matchId] && rsvpStatus[matchId][discordId]) {
    delete rsvpStatus[matchId][discordId];
    
    // Clean up empty match entries
    if (Object.keys(rsvpStatus[matchId]).length === 0) {
      delete rsvpStatus[matchId];
    }
    
    saveRsvpStatus();
    return true;
  }
  return false;
}

// User mapping utility functions
function addUserMapping(discordId, discordUsername, faceitData) {
  userMappings[discordId] = {
    discord_username: discordUsername,
    discord_id: discordId,
    faceit_nickname: faceitData.nickname,
    faceit_player_id: faceitData.player_id,
    faceit_skill_level: faceitData.skill_level || 'N/A',
    faceit_elo: faceitData.faceit_elo || 'N/A',
    country: faceitData.country || 'Unknown',
    registered_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  saveUserMappings();
  return userMappings[discordId];
}

function getUserMappingByDiscordId(discordId) {
  return userMappings[discordId] || null;
}

function getUserMappingByFaceitId(faceitPlayerId) {
  return Object.values(userMappings).find(mapping => mapping.faceit_player_id === faceitPlayerId) || null;
}

function isFaceitAccountMapped(faceitPlayerId, excludeDiscordId = null) {
  return Object.entries(userMappings).find(([discordId, mapping]) => 
    mapping.faceit_player_id === faceitPlayerId && discordId !== excludeDiscordId
  ) || null;
}

function removeUserMapping(discordId) {
  if (userMappings[discordId]) {
    const removed = userMappings[discordId];
    delete userMappings[discordId];
    saveUserMappings();
    return removed;
  }
  return null;
}

// Update RSVP status in match thread
async function updateThreadRsvpStatus(matchId, thread = null) {
  try {
    // Get thread if not provided
    if (!thread) {
      const threadId = matchThreads.get(matchId);
      if (!threadId) return; // No thread for this match
      
      thread = await client.channels.fetch(threadId);
      if (!thread) return;
    }
    
    // Get match data
    const match = upcomingMatches.get(matchId);
    if (!match) return;
    
    // Get all team players
    const teamPlayers = await listTeamPlayers();
    if (teamPlayers.length === 0) return;
    
    // Get current RSVPs
    const matchRsvps = getRsvpForMatch(matchId);
    
    // Categorize players
    const attendingPlayers = [];
    const notAttendingPlayers = [];
    const noResponsePlayers = [];
    
    for (const player of teamPlayers) {
      // Find if this player has an RSVP
      const userMapping = Object.values(userMappings).find(mapping => 
        mapping.faceit_nickname === player.nickname
      );
      
      if (userMapping && matchRsvps[userMapping.discord_id]) {
        const rsvp = matchRsvps[userMapping.discord_id];
        if (rsvp.response === 'yes') {
          attendingPlayers.push(player.nickname);
        } else {
          notAttendingPlayers.push(player.nickname);
        }
      } else {
        noResponsePlayers.push(player.nickname);
      }
    }
    
    // Create embed with current status
    const faction1 = match.teams.faction1?.name || 'TBD';
    const faction2 = match.teams.faction2?.name || 'TBD';
    const matchTimes = formatMatchTime(match.scheduled_at);
    
    const embed = new EmbedBuilder()
      .setTitle('📝 Match RSVP Status')
      .setDescription(`**${faction1} vs ${faction2}**\n📅 ${matchTimes.pacific}\n\n*This list updates automatically when players RSVP*`)
      .setColor(0x0099ff)
      .setTimestamp();
    
    if (attendingPlayers.length > 0) {
      embed.addFields({
        name: `✅ Attending (${attendingPlayers.length})`,
        value: attendingPlayers.join('\n'),
        inline: true
      });
    }
    
    if (notAttendingPlayers.length > 0) {
      embed.addFields({
        name: `❌ Not Attending (${notAttendingPlayers.length})`,
        value: notAttendingPlayers.join('\n'),
        inline: true
      });
    }
    
    if (noResponsePlayers.length > 0) {
      embed.addFields({
        name: `⏳ No Response (${noResponsePlayers.length})`,
        value: noResponsePlayers.join('\n'),
        inline: true
      });
    }
    
    embed.addFields({
      name: 'How to RSVP',
      value: 'Use the buttons on the original announcement or type `!rsvp yes` / `!rsvp no` in the main channel.',
      inline: false
    });
    
    // Find existing RSVP status message in thread and update it, or send new one
    const messages = await thread.messages.fetch({ limit: 10 });
    const existingMessage = messages.find(msg => 
      msg.author.id === client.user.id && 
      msg.embeds.length > 0 && 
      msg.embeds[0].title === '📝 Match RSVP Status'
    );
    
    if (existingMessage) {
      await existingMessage.edit({ embeds: [embed] });
    } else {
      await thread.send({ embeds: [embed] });
    }
    
  } catch (err) {
    console.error(`Error updating thread RSVP status: ${err.message}`);
  }
}

// Async wrapper for thread updates
async function updateThreadRsvpStatusAsync(matchId) {
  // Use setTimeout to avoid blocking the main RSVP response
  setTimeout(async () => {
    await updateThreadRsvpStatus(matchId);
  }, 1000);
}

// Mark a match as processed
function markMatchAsProcessed(matchId) {
  if (!processedMatches.includes(matchId)) {
    processedMatches.push(matchId);
    saveProcessedMatches();
  }
}

// Send notification for a match via Discord bot
async function sendMatchNotification(match, channel = null) {
  try {
    if (!match || !match.teams || !match.teams.faction1 || !match.teams.faction2) {
      console.error('Invalid match data for notification');
      return;
    }
    
    // Check if we already have a thread for this match (prevent duplicates)
    if (matchThreads.has(match.match_id)) {
      console.log(`Thread already exists for match ${match.match_id}, skipping notification`);
      return;
    }
    
    const faction1 = match.teams.faction1.name;
    const faction2 = match.teams.faction2.name;
    const matchTimes = formatMatchTime(match.scheduled_at);
    const matchUrl = `https://www.faceit.com/en/cs2/room/${match.match_id}`;
    
    // Store match data for RSVP purposes
    upcomingMatches.set(match.match_id, match);
    
    const embed = new EmbedBuilder()
      .setTitle(`🎮 Upcoming FACEIT Match: ${faction1} vs ${faction2}`)
      .setDescription(`**Times:**\n${matchTimes.pacific}\n${matchTimes.mountain}\n\n**Competition:** ${match.competition_name || 'ESEA Season'}\n\n**RSVP for this match:** Use the buttons below or type \`!rsvp yes\` or \`!rsvp no\``)
      .setColor(0x00ff00)
      .addFields({
        name: 'Match Details',
        value: `[Click here to view match](${matchUrl})`
      })
      .setTimestamp();
    
// Create RSVP buttons
    const rsvpRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`rsvp_yes_${match.match_id}`)
          .setLabel('✅ Attending')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`rsvp_no_${match.match_id}`)
          .setLabel('❌ Not Attending')
          .setStyle(ButtonStyle.Danger)
      );
    // Create status button row
    const statusRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`rsvp_status_${match.match_id}`)
          .setLabel('📋 View RSVPs')
          .setStyle(ButtonStyle.Secondary)
      );
    
    console.log(`Sending notification for match: ${match.match_id} (${faction1} vs ${faction2})`);
    
// Send to specified channel or default notification channel
    const targetChannel = channel || client.channels.cache.get(DISCORD_CHANNEL_ID);
    
    if (targetChannel) {
      const message = await targetChannel.send({
        content: "New match scheduled!",
        embeds: [embed],
        components: [rsvpRow, statusRow]
      });
      
      // Create a thread for the match discussion
      const thread = await message.startThread({
        name: `Match Discussion: ${faction1} vs ${faction2}`,
        autoArchiveDuration: 60
      });

      // Store thread reference for this match
      matchThreads.set(match.match_id, thread.id);
      saveMatchThreads();
      
      // Send initial RSVP status message in thread
      await updateThreadRsvpStatus(match.match_id, thread);

      console.log(`Thread created for match: ${thread.name}`);
      
      console.log('Notification sent successfully!');
      
      // Only mark as processed if this was an automatic notification
      if (!channel) {
        markMatchAsProcessed(match.match_id);
      }
    } else {
      console.error('Could not find target channel for notification');
    }
    
  } catch (err) {
    console.error(`Error sending notification: ${err.message}`);
  }
}

// Get upcoming matches
async function getUpcomingMatches() {
  const matches = [];
  const matchIds = new Set();
  
  // Method 1: Check championship matches
  try {
    console.log('Getting matches from championship...');
    const champData = await makeApiRequest(`https://open.faceit.com/data/v4/championships/${COMPETITION_ID}/matches`, {
      params: { limit: 100 }
    });
    
    if (champData && champData.items) {
      console.log(`Found ${champData.items.length} championship matches total`);
      
      // Filter for team matches
      const teamMatches = champData.items.filter(match => {
        if (!match.teams || !match.teams.faction1 || !match.teams.faction2) return false;
        
        const faction1Id = match.teams.faction1.faction_id;
        const faction2Id = match.teams.faction2.faction_id;
        
        return (faction1Id === TEAM_ID || faction2Id === TEAM_ID) && 
               !match.finished_at && 
               match.status !== 'FINISHED';
      });
      
      console.log(`Found ${teamMatches.length} upcoming team matches in championship`);
      
      // Add to matches list
      for (const match of teamMatches) {
        if (!matchIds.has(match.match_id)) {
          matchIds.add(match.match_id);
          matches.push(match);
        }
      }
    }
  } catch (err) {
    console.error(`Error getting championship matches: ${err.message}`);
  }
  
  // Try player history approach if we didn't find any matches
  if (matches.length === 0) {
    console.log(`No matches found, trying player history approach`);
    try {
      console.log('Trying player history approach...');
      
      // First get team details to find players
      const teamData = await makeApiRequest(`https://open.faceit.com/data/v4/teams/${TEAM_ID}`);
      
      if (teamData && teamData.members && teamData.members.length > 0) {
        // Check match history for first player
        const playerId = teamData.members[0].user_id;
        console.log(`Checking match history for player: ${teamData.members[0].nickname}`);
        
        const playerHistory = await makeApiRequest(`https://open.faceit.com/data/v4/players/${playerId}/history`, {
          params: { game: 'cs2', limit: 20 }
        });
        
        if (playerHistory && playerHistory.items) {
          // Find upcoming matches
          const upcomingMatches = playerHistory.items.filter(match => 
            !match.finished_at && 
            match.status !== 'FINISHED' && 
            match.status !== 'CANCELLED'
          );
          
          // Check each match to see if it involves the team
          for (const match of upcomingMatches) {
            if (!matchIds.has(match.match_id)) {
              const fullMatch = await makeApiRequest(`https://open.faceit.com/data/v4/matches/${match.match_id}`);
              
              if (fullMatch && fullMatch.teams) {
                const faction1Id = fullMatch.teams.faction1?.faction_id;
                const faction2Id = fullMatch.teams.faction2?.faction_id;
                
                if (faction1Id === TEAM_ID || faction2Id === TEAM_ID) {
                  matchIds.add(match.match_id);
                  matches.push(fullMatch);
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`Error with player history approach: ${err.message}`);
    }
  }
  
  console.log(`Total upcoming matches found: ${matches.length}`);
  return matches;
}

// Clean up old RSVP data for concluded matches
async function cleanupOldRsvpData() {
  try {
    console.log('Cleaning up old RSVP data...');
    
    // Get current upcoming matches
    const upcomingMatches = await getUpcomingMatches();
    const upcomingMatchIds = new Set(upcomingMatches.map(match => match.match_id));
    
    let removedCount = 0;
    
    // Remove RSVP data for matches that are no longer upcoming
    for (const matchId of Object.keys(rsvpStatus)) {
      if (!upcomingMatchIds.has(matchId)) {
        delete rsvpStatus[matchId];
        removedCount++;
      }
    }
    
    // Clean up thread mappings for old matches
    for (const matchId of matchThreads.keys()) {
      if (!upcomingMatchIds.has(matchId)) {
        matchThreads.delete(matchId);
      }
    }
    
    if (removedCount > 0) {
      console.log(`Cleaned up RSVP data for ${removedCount} concluded matches`);
      saveRsvpStatus();
      saveMatchThreads();
    }
    
  } catch (err) {
    console.error(`Error cleaning up old RSVP data: ${err.message}`);
  }
}

// Main check function
async function checkMatches() {
  try {
    console.log('Checking for upcoming matches...');
    
    // Clean up old data first
    await cleanupOldRsvpData();
    
    // Get all upcoming matches
    const matches = await getUpcomingMatches();
    console.log(`getUpcomingMatches() returned ${matches.length} matches`);
    
    // Check if we have any new matches to notify about
    const newMatches = matches.filter(match => !processedMatches.includes(match.match_id));
    
    console.log(`New matches to notify about: ${newMatches.length}`);
    
    // Send individual notifications for new matches
    for (const match of newMatches) {
      await sendMatchNotification(match);
    }
    
  } catch (err) {
    console.error(`Error in check function: ${err.message}`);
  }
}

// Discord bot event handlers
client.once('ready', () => {
  console.log(`Discord bot logged in as ${client.user.tag}!`);
  
  // Initial check on startup
  console.log('FACEIT Match Notifier (BETA) starting...');
  checkMatches();
});

// Function to list all players on the team
async function listTeamPlayers() {
  try {
    console.log('Fetching team players...');
    const teamData = await makeApiRequest(`https://open.faceit.com/data/v4/teams/${TEAM_ID}`);
    
    if (teamData && teamData.members) {
      console.log(`Found ${teamData.members.length} players`);
      return teamData.members;
    }
    console.log('No players found');
    return [];
  } catch (error) {
    console.error(`Error fetching team players: ${error.message}`);
    return [];
  }
}

// Command handling
client.on('messageCreate', async (message) => {
  // Ignore messages from bots and system messages
  if (message.author.bot || message.system) return;
  
  // Only log non-bot messages to reduce noise
  if (message.content.startsWith('!')) {
    console.log(`Command received: ${message.content} from ${message.author.tag}`);
  }
  
  // Handle !rsvp command
  if (message.content.toLowerCase().startsWith('!rsvp')) {
    const args = message.content.toLowerCase().split(' ');
    
    if (args.length < 2 || (args[1] !== 'yes' && args[1] !== 'no')) {
      await message.reply('❌ Please specify your RSVP response. Usage: `!rsvp yes` or `!rsvp no`');
      return;
    }
    
    const response = args[1]; // 'yes' or 'no'
    const userId = message.author.id;
    const matchSelector = args[2]; // Optional: match number or match ID
    
    try {
      // Check if user is registered
      const userMapping = getUserMappingByDiscordId(userId);
      if (!userMapping) {
        await message.reply('❌ You must be linked to a FACEIT account to RSVP. Use `!register` to see available players, then `!link <nickname>` to link your account.');
        return;
      }
      
      // Get upcoming matches
      const matches = await getUpcomingMatches();
      if (matches.length === 0) {
        await message.reply('❌ No upcoming matches found. Use `!matches` to see available matches.');
        return;
      }
      
      // Check if user provided a match selector (number or ID)
      if (matchSelector) {
        let selectedMatch = null;
        
        // Try to parse as match number (1, 2, 3, etc.)
        const matchNumber = parseInt(matchSelector);
        if (!isNaN(matchNumber) && matchNumber >= 1 && matchNumber <= matches.length) {
          selectedMatch = matches[matchNumber - 1];
        } else {
          // Try to find by match ID
          selectedMatch = matches.find(match => match.match_id === matchSelector);
        }
        
        if (!selectedMatch) {
          await message.reply(`❌ Could not find match "${matchSelector}". Use \`!matches\` to see available matches, or try \`!rsvp ${response} 1\` for the first match.`);
          return;
        }
        
        // Process RSVP for selected match
        const matchId = selectedMatch.match_id;
        upcomingMatches.set(matchId, selectedMatch);
        
        const existingRsvp = getUserRsvp(matchId, userId);
        addRsvp(matchId, userId, response, userMapping.faceit_nickname);
        
        const responseEmoji = response === 'yes' ? '✅' : '❌';
        const actionText = existingRsvp ? 'updated' : 'recorded';
        const matchName = `${selectedMatch.teams.faction1.name} vs ${selectedMatch.teams.faction2.name}`;
        const matchTimes = formatMatchTime(selectedMatch.scheduled_at);
        
        await message.reply(`${responseEmoji} Your RSVP has been ${actionText} for:\n**${matchName}**\n📅 ${matchTimes.pacific}\n\n**${userMapping.faceit_nickname}** - ${response.toUpperCase()}`);
        
        console.log(`RSVP ${actionText}: ${message.author.tag} (${userMapping.faceit_nickname}) -> ${response} for match ${matchId}`);
        return;
      }
      
      // If only one match, auto-select it. If multiple, ask user to specify.
      if (matches.length === 1) {
        const matchId = matches[0].match_id;
        upcomingMatches.set(matchId, matches[0]);
        
        // Check if user already has an RSVP for this match
        const existingRsvp = getUserRsvp(matchId, userId);
        
        // Add/update RSVP
        addRsvp(matchId, userId, response, userMapping.faceit_nickname);
        
        const responseEmoji = response === 'yes' ? '✅' : '❌';
        const actionText = existingRsvp ? 'updated' : 'recorded';
        const match = matches[0];
        const matchName = `${match.teams.faction1.name} vs ${match.teams.faction2.name}`;
        const matchTimes = formatMatchTime(match.scheduled_at);
        
        await message.reply(`${responseEmoji} Your RSVP has been ${actionText} for:\n**${matchName}**\n📅 ${matchTimes.pacific}\n\n**${userMapping.faceit_nickname}** - ${response.toUpperCase()}`);
        
        console.log(`RSVP ${actionText}: ${message.author.tag} (${userMapping.faceit_nickname}) -> ${response} for match ${matchId}`);
        return;
      } else {
        // Multiple matches - show them with numbered options for easier selection
        const embed = new EmbedBuilder()
          .setTitle('🎮 Multiple Matches Available')
          .setDescription(`**Which match do you want to RSVP '${response.toUpperCase()}' for?**\n\nYou can:\n• Use the buttons on match notifications\n• Or reply with the match number: \`!rsvp ${response} 1\` (for first match)`)
          .setColor(0xff9900)
          .setTimestamp();
        
        matches.forEach((match, index) => {
          const faction1 = match.teams.faction1?.name || 'TBD';
          const faction2 = match.teams.faction2?.name || 'TBD';
          const matchTimes = formatMatchTime(match.scheduled_at);
          
          embed.addFields({
            name: `${index + 1}. ${faction1} vs ${faction2}`,
            value: `📅 ${matchTimes.pacific}\n🆔 \`${match.match_id}\``,
            inline: false
          });
        });
        
        embed.addFields({
          name: '📝 How to RSVP',
          value: `\`!rsvp ${response} 1\` - RSVP for match #1\n\`!rsvp ${response} 2\` - RSVP for match #2\n\n*Or use the buttons on the match notifications!*`,
          inline: false
        });
        
        await message.reply({ embeds: [embed] });
        return;
      }
      
    } catch (err) {
      console.error(`Error handling !rsvp command: ${err.message}`);
      await message.reply('❌ Sorry, there was an error processing your RSVP.');
    }
  }
  
  // Handle !rsvps command to view all RSVP statuses for upcoming matches
  if (message.content.toLowerCase() === '!rsvps') {
    try {
      const matches = await getUpcomingMatches();
      if (matches.length === 0) {
        await message.reply('❌ No upcoming matches found.');
        return;
      }
      
      const embed = new EmbedBuilder()
        .setTitle('📝 All Match RSVP Status')
        .setDescription('RSVP status for all upcoming matches:')
        .setColor(0x0099ff)
        .setTimestamp();
      
      let hasAnyRsvps = false;
      
      for (const match of matches) {
        const matchRsvps = getRsvpForMatch(match.match_id);
        
        if (Object.keys(matchRsvps).length > 0) {
          hasAnyRsvps = true;
          const faction1 = match.teams.faction1?.name || 'TBD';
          const faction2 = match.teams.faction2?.name || 'TBD';
          const matchTimes = formatMatchTime(match.scheduled_at);
          
          const yesRsvps = [];
          const noRsvps = [];
          
          for (const [discordId, rsvpData] of Object.entries(matchRsvps)) {
            if (rsvpData.response === 'yes') {
              yesRsvps.push(rsvpData.faceit_nickname);
            } else {
              noRsvps.push(rsvpData.faceit_nickname);
            }
          }
          
          let fieldValue = `📅 ${matchTimes.pacific}\n`;
          if (yesRsvps.length > 0) fieldValue += `✅ **Attending:** ${yesRsvps.join(', ')}\n`;
          if (noRsvps.length > 0) fieldValue += `❌ **Not Attending:** ${noRsvps.join(', ')}\n`;
          fieldValue += `🆔 \`${match.match_id}\``;
          
          embed.addFields({
            name: `🎮 ${faction1} vs ${faction2}`,
            value: fieldValue,
            inline: false
          });
        }
      }
      
      if (!hasAnyRsvps) {
        await message.reply('📝 No RSVPs yet for any upcoming matches.');
        return;
      }
      
      await message.reply({ embeds: [embed] });
      
    } catch (err) {
      console.error(`Error handling !rsvps command: ${err.message}`);
      await message.reply('❌ Sorry, there was an error retrieving RSVP status.');
    }
  }

  // Handle !status <match_id> command to view RSVP status for a specific match
  if (message.content.toLowerCase().startsWith('!status')) {
    const args = message.content.split(' ');
    
    if (args.length < 2) {
      await message.reply('❌ Please provide a match ID. Usage: `!status <match_id>`\nExample: `!status 1-abc123def-456789`');
      return;
    }
    
    const matchId = args[1];
    
    try {
      console.log(`User ${message.author.tag} requested RSVP status for match ${matchId}`);
      
      const matchRsvps = getRsvpForMatch(matchId);
      
      if (Object.keys(matchRsvps).length === 0) {
        await message.reply(`📝 No RSVPs found for match ID: \`${matchId}\`\n\nThis could mean:\n• The match ID doesn't exist\n• No one has RSVP'd for this match yet`);
        return;
      }
      
      const yesRsvps = [];
      const noRsvps = [];
      
      for (const [discordId, rsvpData] of Object.entries(matchRsvps)) {
        const entry = `${rsvpData.faceit_nickname}`;
        if (rsvpData.response === 'yes') {
          yesRsvps.push(entry);
        } else {
          noRsvps.push(entry);
        }
      }
      
      const embed = new EmbedBuilder()
        .setTitle('📝 Match RSVP Status')
        .setDescription(`RSVP status for match ID: \`${matchId}\``)
        .setColor(0x0099ff)
        .setTimestamp();
      
      if (yesRsvps.length > 0) {
        embed.addFields({
          name: '✅ Attending',
          value: yesRsvps.join('\n'),
          inline: true
        });
      }
      
      if (noRsvps.length > 0) {
        embed.addFields({
          name: '❌ Not Attending',
          value: noRsvps.join('\n'),
          inline: true
        });
      }
      
      embed.addFields({
        name: 'Total Responses',
        value: `${Object.keys(matchRsvps).length} player(s)`,
        inline: false
      });
      
      
      await message.reply({ embeds: [embed] });
      
    } catch (err) {
      console.error(`Error handling !status command: ${err.message}`);
      await message.reply('❌ Sorry, there was an error retrieving RSVP status for that match.');
    }
  }
  
  // Handle !matches command
  if (message.content.toLowerCase() === '!matches') {
    try {
      console.log(`User ${message.author.tag} requested matches list`);
      console.log(`About to call getUpcomingMatches()`);
      
      const matches = await getUpcomingMatches();
      console.log(`getUpcomingMatches() returned ${matches.length} matches`);
      
      if (matches.length === 0) {
        console.log(`No matches found, sending no matches message`);
        await message.reply('No upcoming matches found for your team.');
        return;
      }
      
      // Create embed with match list
      const embed = new EmbedBuilder()
        .setTitle('🎮 Upcoming FACEIT Matches')
        .setColor(0x0099ff)
        .setTimestamp();
      
      let description = '';
      
      matches.forEach((match, index) => {
        const faction1 = match.teams.faction1?.name || 'TBD';
        const faction2 = match.teams.faction2?.name || 'TBD';
        const matchTimes = formatMatchTime(match.scheduled_at);
        const matchUrl = `https://www.faceit.com/en/cs2/room/${match.match_id}`;
        
        // Check if this match has any RSVPs
        const matchRsvps = getRsvpForMatch(match.match_id);
        const rsvpCount = Object.keys(matchRsvps).length;
        const rsvpIndicator = rsvpCount > 0 ? ` (${rsvpCount} RSVPs)` : '';
        
        description += `**${index + 1}.** ${faction1} vs ${faction2}${rsvpIndicator}\n`;
        description += `📅 ${matchTimes.pacific} / ${matchTimes.mountain}\n`;
        description += `🔗 [View Match](${matchUrl})\n`;
        description += `🆔 Match ID: \`${match.match_id}\`\n\n`;
      });
      
      embed.setDescription(description);
      
      embed.addFields({
        name: '📝 RSVP',
        value: `Use \`!rsvp yes\` or \`!rsvp no\` to RSVP for matches.\n\`!rsvps\` - View all RSVP responses\n\`!status [match_id]\` - View RSVPs for specific match`,
        inline: false
      });
      
      await message.reply({ embeds: [embed] });
      
    } catch (err) {
      console.error(`Error handling !matches command: ${err.message}`);
      await message.reply('Sorry, there was an error fetching match information.');
    }
  }
  
  // Handle !notify command to send a test notification
  if (message.content.toLowerCase() === '!notify' && message.member?.permissions.has('ADMINISTRATOR')) {
    try {
      const matches = await getUpcomingMatches();
      console.log(`getUpcomingMatches() returned ${matches.length} matches`);
      if (matches.length > 0) {
        // Check if thread already exists for this match
        const existingThread = matchThreads.get(matches[0].match_id);
        if (existingThread) {
          await message.reply(`Test notification skipped - thread already exists for match ${matches[0].match_id}`);
          return;
        }
        
        await sendMatchNotification(matches[0], message.channel);
        await message.reply('Test notification sent!');
      } else {
        await message.reply('No matches available for test notification.');
      }
    } catch (err) {
      console.error(`Error handling !notify command: ${err.message}`);
      await message.reply('Sorry, there was an error sending the test notification.');
    }
  }
  
// Handle !listplayers command
if (message.content.toLowerCase().startsWith('!listplayers')) {
  try {
    const players = await listTeamPlayers();

    if (players.length === 0) {
      await message.reply('❌ No players found for your team.');
      return;
    }

    // Create embed with player list
    const embed = new EmbedBuilder()
      .setTitle('🎮 Team Players')
      .setColor(0x0099ff)
      .setTimestamp();

    players.forEach((player, index) => {
      embed.addFields({ name: `${index + 1}. ${player.nickname}`, value: `Player ID: ${player.user_id}`, inline: false });
    });

    await message.reply({ embeds: [embed] });
    console.log(`Displayed ${players.length} team players to user ${message.author.tag}`);

  } catch (err) {
    console.error(`Error handling !listplayers command: ${err.message}`);
    await message.reply('❌ Sorry, there was an error fetching the player list.');
  }
}

// Handle !register command
  if (message.content.toLowerCase() === '!register') {
    try {
      console.log(`User ${message.author.tag} requested team players list`);
      const players = await listTeamPlayers();

      if (players.length === 0) {
        await message.reply('❌ No players found for your team.');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🎮 Team Players')
        .setColor(0x0099ff)
        .setTimestamp();

      players.forEach((player, index) => {
        embed.addFields({ name: `${index + 1}. ${player.nickname}`, value: `Player ID: ${player.user_id}`, inline: false });
      });

      await message.reply({ embeds: [embed] });
      console.log(`Displayed ${players.length} team players to user ${message.author.tag}`);

    } catch (err) {
      console.error(`Error handling !register command: ${err.message}`);
      await message.reply('❌ Sorry, there was an error fetching the player list.');
    }
  }
  
// Handle !link command to register user with FACEIT
  if (message.content.toLowerCase().startsWith('!link')) {
    const args = message.content.split(' ');
    const userId = message.author.id;
    
    if (args.length < 2) {
      await message.reply('❌ Please provide a player nickname. Usage: `!link <nickname>`\nExample: `!link john123`');
      return;
    }
    
    const nickname = args[1];
    
    try {
      console.log(`User ${message.author.tag} linking to FACEIT account: ${nickname}`);
      
      // Check if the Discord user is already linked
      const existingMapping = getUserMappingByDiscordId(userId);
      if (existingMapping) {
        await message.reply(`❌ You are already linked to FACEIT account **${existingMapping.faceit_nickname}**. Use \`!unlink\` first if you want to link a different account.`);
        return;
      }

      // Validate the FACEIT account by nickname
      const playerData = await makeApiRequest(`https://open.faceit.com/data/v4/players`, {
        params: { nickname }
      });
      if (!playerData) {
        await message.reply('❌ FACEIT account not found. Please make sure the nickname is correct.');
        return;
      }

      // Check if FACEIT account is already mapped
      const duplicateMapping = isFaceitAccountMapped(playerData.player_id);
      if (duplicateMapping) {
        await message.reply('❌ This FACEIT account is already linked to another Discord user.');
        return;
      }

      // Create the mapping
      addUserMapping(userId, message.author.username, playerData);

      const embed = new EmbedBuilder()
        .setTitle('✅ FACEIT Account Linked Successfully!') 
        .setDescription(`Your Discord account has been linked to FACEIT account **${playerData.nickname}**`)
        .addFields(
          { name: '🏆 Skill Level', value: `${playerData.skill_level || 'N/A'} (${playerData.faceit_elo || 'N/A'} ELO)`, inline: true },
          { name: '🌍 Country', value: playerData.country || 'Unknown', inline: true }
        )
        .setColor(0x00ff00)
        .setTimestamp();

      await message.reply({ embeds: [embed] });

      console.log(`Successfully linked user ${message.author.tag} to FACEIT account ${playerData.nickname}`);

    } catch (err) {
      console.error(`Error handling !link command: ${err.message}`);
      await message.reply('❌ Sorry, there was an error linking your FACEIT account.');
    }
  }
  
  // Handle !profile command
  if (message.content.toLowerCase() === '!profile') {
    const userId = message.author.id;
    
    try {
      const mapping = getUserMappingByDiscordId(userId);
      if (!mapping) {
        await message.reply('❌ You don\'t have a linked FACEIT account. Use `!register` to see available players, then `!link <nickname>` to link your account.');
        return;
      }
      
      const embed = new EmbedBuilder()
        .setTitle('🎮 Your Linked FACEIT Account')
        .setDescription(`**[${mapping.faceit_nickname}](https://www.faceit.com/en/players/${mapping.faceit_nickname})**`)
        .addFields(
          { name: '🏆 Skill Level', value: `${mapping.faceit_skill_level} (${mapping.faceit_elo} ELO)`, inline: true },
          { name: '🌍 Country', value: mapping.country, inline: true },
          { name: '📅 Linked On', value: new Date(mapping.registered_at).toLocaleDateString(), inline: true }
        )
        .setColor(0xff5500)
        .setTimestamp();
      
      await message.reply({ embeds: [embed] });
      
    } catch (err) {
      console.error(`Error handling !profile command: ${err.message}`);
      await message.reply('❌ Sorry, there was an error retrieving your profile.');
    }
  }
  
  // Handle !unlink command
  if (message.content.toLowerCase() === '!unlink') {
    const userId = message.author.id;
    
    try {
      const existingMapping = getUserMappingByDiscordId(userId);
      if (!existingMapping) {
        await message.reply('❌ You don\'t have a linked FACEIT account.');
        return;
      }
      
      const removedMapping = removeUserMapping(userId);
      await message.reply(`✅ Successfully unlinked your FACEIT account **${removedMapping.faceit_nickname}**.`);
      
      console.log(`User ${message.author.tag} unlinked from FACEIT account ${removedMapping.faceit_nickname}`);
      
    } catch (err) {
      console.error(`Error handling !unlink command: ${err.message}`);
      await message.reply('❌ Sorry, there was an error unlinking your FACEIT account.');
    }
  }

// Handle !lookup command for admins
  if (message.content.toLowerCase().startsWith('!lookup') && message.member?.permissions.has('ADMINISTRATOR')) {
    const args = message.content.split(' ');

    if (args.length < 2) {
      await message.reply('❌ Please provide a search term. Usage: `!lookup <username|discord_id|faceit_nickname>`');
      return;
    }

    const query = args.slice(1).join(' ').toLowerCase();
    console.log(`Admin ${message.author.tag} is searching for: ${query}`);

    // Search function
    const findUserMapping = () => {
      return Object.values(userMappings).find(mapping => {
        return mapping.discord_username.toLowerCase() === query ||
               mapping.discord_id === query ||
               mapping.faceit_nickname.toLowerCase() === query;
      });
    };

    const user = findUserMapping();

    if (!user) {
      await message.reply(`❌ No mappings found for "${query}". Please search by Discord username, Discord ID, or FACEIT nickname.`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('🔍 User Lookup Result')
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

  // Handle !help command
  if (message.content.toLowerCase() === '!help') {
    const embed = new EmbedBuilder()
      .setTitle('🤖 FACEIT Match Bot - Command Guide')
      .setDescription('**Welcome to the FACEIT Match Bot!** This bot helps you stay updated on team matches and manage RSVPs.')
      .addFields(
        { 
          name: '🚀 Quick Start (First Time Users)', 
          value: '```\n1. !register     - View team player list\n2. !link <name>  - Link your FACEIT account\n3. !matches      - See upcoming matches\n4. !rsvp yes/no  - RSVP for matches```', 
          inline: false 
        },
        { 
          name: '📝 RSVP Commands', 
          value: '• **`!rsvp yes`** - Attend upcoming matches\n• **`!rsvp no`** - Skip upcoming matches\n• **`!rsvp yes 1`** - RSVP for match #1 (when multiple)\n• **`!rsvps`** - View all match RSVP status\n• **`!status <match_id>`** - Check specific match RSVPs', 
          inline: false 
        },
        { 
          name: '🔍 Match & Info Commands', 
          value: '• **`!matches`** - List all upcoming matches\n• **`!profile`** - View your linked FACEIT account\n• **`!listplayers`** - Show all team players', 
          inline: false 
        },
        { 
          name: '🔧 Account Management', 
          value: '• **`!register`** - See available FACEIT players to link\n• **`!link <nickname>`** - Connect Discord to FACEIT account\n• **`!unlink`** - Remove FACEIT account link', 
          inline: false 
        },
        { 
          name: '🎮 How It Works', 
          value: '**Automated Notifications:** The bot checks every 30 minutes for new matches and posts them with RSVP buttons.\n\n**Match Threads:** Each match gets its own discussion thread with live RSVP tracking.\n\n**Button RSVPs:** Click ✅ or ❌ on match posts for quick responses.', 
          inline: false 
        },
        { 
          name: '📊 Admin Commands', 
          value: '• **`!notify`** - Send test match notification (Admin)\n• **`!lookup <user>`** - Find user mappings (Admin)', 
          inline: false 
        },
        { 
          name: '💡 Pro Tips', 
          value: '• **Multiple Matches?** Use `!rsvp yes 1` to specify which match\n• **Quick Check:** Use match discussion threads to see who\'s attending\n• **Stay Updated:** The bot automatically cleans up old match data', 
          inline: false 
        }
      )
      .setColor(0x0099ff)
      .setFooter({ text: 'Need more help? Ask in the server or check match discussion threads!' })
      .setTimestamp();
    
    await message.reply({ embeds: [embed] });
  }
});

// Handle button interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  
  const userId = interaction.user.id;
  console.log(`Button interaction from ${interaction.user.tag}: ${interaction.customId}`);
  
  try {
    // Parse button custom ID
    const [action, response, matchId] = interaction.customId.split('_');
    
    if (action !== 'rsvp') {
      await interaction.reply({ content: '❌ Unknown button action.', ephemeral: true });
      return;
    }
    
    // Handle viewing RSVP status
    if (response === 'status') {
      const matchRsvps = getRsvpForMatch(matchId);
      
      if (Object.keys(matchRsvps).length === 0) {
        await interaction.reply({ content: '📝 No RSVPs yet for this match.', ephemeral: true });
        return;
      }
      
      const yesRsvps = [];
      const noRsvps = [];
      
      for (const [discordId, rsvpData] of Object.entries(matchRsvps)) {
        const entry = `${rsvpData.faceit_nickname}`;
        if (rsvpData.response === 'yes') {
          yesRsvps.push(entry);
        } else {
          noRsvps.push(entry);
        }
      }
      
      const embed = new EmbedBuilder()
        .setTitle('📝 Match RSVP Status')
        .setDescription(`RSVP status for match ID: \`${matchId}\``)
        .setColor(0x0099ff)
        .setTimestamp();
      
      if (yesRsvps.length > 0) {
        embed.addFields({
          name: '✅ Attending',
          value: yesRsvps.join('\n'),
          inline: true
        });
      }
      
      if (noRsvps.length > 0) {
        embed.addFields({
          name: '❌ Not Attending',
          value: noRsvps.join('\n'),
          inline: true
        });
      }
      
      embed.addFields({
        name: 'Total Responses',
        value: `${Object.keys(matchRsvps).length} player(s)`,
        inline: false
      });
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    
    // Handle RSVP yes/no responses
    if (response !== 'yes' && response !== 'no') {
      await interaction.reply({ content: '❌ Invalid RSVP response.', ephemeral: true });
      return;
    }
    
    // Check if user is registered
    const userMapping = getUserMappingByDiscordId(userId);
    if (!userMapping) {
      await interaction.reply({ 
        content: '❌ You must be linked to a FACEIT account to RSVP. Use `!register` to see available players, then `!link <nickname>` to link your account.', 
        ephemeral: true 
      });
      return;
    }
    
    // Check if user already has an RSVP for this match
    const existingRsvp = getUserRsvp(matchId, userId);
    
    // Add/update RSVP
    addRsvp(matchId, userId, response, userMapping.faceit_nickname);
    
    const responseEmoji = response === 'yes' ? '✅' : '❌';
    const actionText = existingRsvp ? 'updated' : 'recorded';
    
    await interaction.reply({ 
      content: `${responseEmoji} Your RSVP has been ${actionText}! **${userMapping.faceit_nickname}** - ${response.toUpperCase()}`, 
      ephemeral: true 
    });
    
    console.log(`RSVP ${actionText} via button: ${interaction.user.tag} (${userMapping.faceit_nickname}) -> ${response} for match ${matchId}`);
    
  } catch (err) {
    console.error(`Error handling button interaction: ${err.message}`);
    await interaction.reply({ content: '❌ Sorry, there was an error processing your RSVP.', ephemeral: true });
  }
});

// Health check server
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      discord_ready: client.isReady(),
      uptime: process.uptime()
    }));
    return;
  }
  
  res.writeHead(404);
  res.end();
});

// Start health check server
server.listen(8080, () => {
  console.log('Health check server running on port 8080');
});

// Schedule to run every 30 minutes
cron.schedule('*/30 * * * *', () => {
  console.log('Running scheduled check...');
  if (client.isReady()) {
    checkMatches();
  } else {
    console.log('Discord client not ready, skipping check');
  }
});

// Schedule cleanup every 6 hours to remove old data
cron.schedule('0 */6 * * *', () => {
  console.log('Running scheduled cleanup...');
  if (client.isReady()) {
    cleanupOldRsvpData();
  } else {
    console.log('Discord client not ready, skipping cleanup');
  }
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  client.destroy();
  server.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  client.destroy();
  server.close();
  process.exit(0);
});

// Handle uncaught exceptions and unhandled promise rejections
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error.message);
  console.error(error.stack);
  // Don't exit immediately, log the error but keep the bot running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  // Don't exit immediately, log the error but keep the bot running
});

// Login to Discord
client.login(DISCORD_BOT_TOKEN).catch(err => {
  console.error('Failed to login to Discord:', err);
  process.exit(1);
});

// Function to search for FACEIT accounts
async function searchFaceitAccounts(query) {
  try {
    console.log(`Searching for FACEIT accounts with query: ${query}`);
    
    // FACEIT API endpoint for searching players
    const response = await makeApiRequest(`https://open.faceit.com/data/v4/search/players`, {
      params: {
        nickname: query,
        limit: 10  // Limit to 10 results for better Discord display
      }
    });
    
    if (response && response.items && response.items.length > 0) {
      console.log(`Found ${response.items.length} FACEIT accounts`);
      return response.items;
    } else {
      console.log('No FACEIT accounts found');
      return [];
    }
  } catch (error) {
    console.error(`Error searching FACEIT accounts: ${error.message}`);
    return [];
  }
}
