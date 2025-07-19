require('dotenv').config();
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const http = require('http');

// Configuration
const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const TEAM_ID = process.env.TEAM_ID || 'cfbb8afd-6ab6-44a9-bf07-3de4f86889af';
const COMPETITION_ID = 'f5aec3e5-57e5-4dde-a9d5-4e630766bc14';

// File paths
const DATA_DIR = '/app/data';
const PROCESSED_MATCHES_FILE = `${DATA_DIR}/processed_matches.json`;

// Create data directory if it doesn't exist
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error(`Error creating data directory: ${err.message}`);
  }
}

// Load processed matches
let processedMatches = [];
try {
  if (fs.existsSync(PROCESSED_MATCHES_FILE)) {
    processedMatches = JSON.parse(fs.readFileSync(PROCESSED_MATCHES_FILE, 'utf8'));
  }
} catch (err) {
  console.error(`Error loading processed matches: ${err.message}`);
}

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

// API request function
async function makeApiRequest(url, options = {}) {
  try {
    const headers = {
      'Authorization': `Bearer ${FACEIT_API_KEY}`,
      'Accept': 'application/json',
      ...options.headers
    };
    
    const response = await axios.get(url, { ...options, headers });
    return response.data;
  } catch (error) {
    console.error(`API Error (${url}): ${error.message}`);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
    }
    return null;
  }
}

// Save processed matches
function saveProcessedMatches() {
  try {
    fs.writeFileSync(PROCESSED_MATCHES_FILE, JSON.stringify(processedMatches));
  } catch (err) {
    console.error(`Error saving processed matches: ${err.message}`);
  }
}

// Mark a match as processed
function markMatchAsProcessed(matchId) {
  if (!processedMatches.includes(matchId)) {
    processedMatches.push(matchId);
    saveProcessedMatches();
  }
}

// Send notification for a match
async function sendMatchNotification(match) {
  try {
    if (!match || !match.teams || !match.teams.faction1 || !match.teams.faction2) {
      console.error('Invalid match data for notification');
      return;
    }
    
    const faction1 = match.teams.faction1.name;
    const faction2 = match.teams.faction2.name;
    const matchTimes = formatMatchTime(match.scheduled_at);
    const matchUrl = `https://www.faceit.com/en/cs2/room/${match.match_id}`;
    
    const embed = {
      title: `🎮 Upcoming FACEIT Match: ${faction1} vs ${faction2}`,
      description: `**Times:**\n${matchTimes.pacific}\n${matchTimes.mountain}\n\n**Competition:** ${match.competition_name || 'ESEA Season'}`,
      color: 0x00ff00,
      fields: [
        {
          name: 'Match Details',
          value: `[Click here to view match](${matchUrl})`
        }
      ],
      timestamp: new Date()
    };
    
    console.log(`Sending notification for match: ${match.match_id} (${faction1} vs ${faction2})`);
    
    await axios.post(DISCORD_WEBHOOK_URL, {
      username: 'FACEIT Match Notifier (BETA)',
      embeds: [embed],
      content: "New match scheduled!" // Adding content but not using @everyone since webhooks can't use it
    });
    
    console.log('Notification sent successfully!');
    markMatchAsProcessed(match.match_id);
    
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

// Main check function
async function checkMatches() {
  try {
    console.log('Checking for upcoming matches...');
    
    // Get all upcoming matches
    const matches = await getUpcomingMatches();
    
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

// Health check server
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
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
  checkMatches();
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.close();
  process.exit(0);
});

// Initial check on startup
console.log('FACEIT Match Notifier (BETA) starting...');
checkMatches();
