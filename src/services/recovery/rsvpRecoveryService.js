/**
 * RSVP Recovery Service
 * 
 * Recovers RSVP data from Discord thread messages and embeds.
 * Parses bot messages to extract historical RSVP responses.
 */

class RsvpRecoveryService {
  constructor(client, databaseService) {
    this.client = client;
    this.db = databaseService;
  }

  /**
   * Recover RSVP data from Discord threads
   * @param {Object} options - Recovery options
   * @returns {Object} Recovery results
   */
  async recoverRsvpDataFromThreads(options = {}) {
    const { scanDepthDays = 30, dryRun = false } = options;
    const cutoffDate = new Date(Date.now() - (scanDepthDays * 24 * 60 * 60 * 1000));

    const results = {
      recovered: 0,
      errors: 0,
      details: []
    };

    try {
      // Get all match threads that exist in Discord
      const discordThreads = await this.findAllMatchThreads();
      console.log(`📋 Found ${discordThreads.length} match threads to scan for RSVP data`);

      for (const thread of discordThreads) {
        try {
          // Skip threads older than cutoff
          if (thread.createdAt < cutoffDate) {
            continue;
          }

          console.log(`🔍 Scanning thread: ${thread.name}`);
          const threadResults = await this.extractRsvpFromThread(thread, dryRun);
          
          results.recovered += threadResults.recovered;
          results.errors += threadResults.errors;
          results.details.push({
            threadId: thread.id,
            threadName: thread.name,
            ...threadResults
          });

        } catch (threadError) {
          console.error(`❌ Error processing thread ${thread.name}:`, threadError.message);
          results.errors++;
          results.details.push({
            threadId: thread.id,
            threadName: thread.name,
            error: threadError.message
          });
        }
      }

      return results;

    } catch (error) {
      console.error('❌ Error during RSVP recovery:', error.message);
      results.errors++;
      return results;
    }
  }

  /**
   * Extract RSVP data from a specific thread
   * @param {Object} thread - Discord thread object
   * @param {boolean} dryRun - Whether to actually save the data
   * @returns {Object} Extraction results
   */
  async extractRsvpFromThread(thread, dryRun = false) {
    const results = {
      recovered: 0,
      errors: 0,
      matchId: null,
      rsvpData: []
    };

    try {
      // Extract match ID from thread
      const matchId = await this.extractMatchIdFromThread(thread);
      if (!matchId) {
        results.errors++;
        return results;
      }
      results.matchId = matchId;

      // Fetch all messages from the thread
      const messages = await this.fetchAllThreadMessages(thread);
      console.log(`📨 Found ${messages.length} messages in thread`);

      // Look for RSVP embed messages from the bot
      const rsvpMessages = messages.filter(msg => 
        msg.author.id === this.client.user.id &&
        msg.embeds.length > 0 &&
        msg.embeds[0].description &&
        msg.embeds[0].description.includes('Current RSVPs')
      );

      console.log(`📊 Found ${rsvpMessages.length} RSVP status messages`);

      // Parse the most recent RSVP message for data
      if (rsvpMessages.length > 0) {
        const latestRsvpMessage = rsvpMessages[0]; // Most recent
        const extractedRsvp = this.parseRsvpFromEmbed(latestRsvpMessage.embeds[0]);
        
        if (extractedRsvp.length > 0) {
          results.rsvpData = extractedRsvp;
          
          if (!dryRun) {
            // Save extracted RSVP data to database
            for (const rsvp of extractedRsvp) {
              try {
                await this.db.addRsvp(matchId, rsvp.discordId, rsvp.response, rsvp.faceitNickname);
                results.recovered++;
              } catch (saveError) {
                console.error(`Failed to save RSVP for ${rsvp.faceitNickname}:`, saveError.message);
                results.errors++;
              }
            }
          } else {
            results.recovered = extractedRsvp.length;
          }
        }
      }

      // Also look for individual RSVP confirmation messages
      const confirmationRsvps = await this.extractRsvpFromConfirmationMessages(messages, matchId);
      if (confirmationRsvps.length > 0 && !dryRun) {
        for (const rsvp of confirmationRsvps) {
          try {
            await this.db.addRsvp(matchId, rsvp.discordId, rsvp.response, rsvp.faceitNickname);
            results.recovered++;
          } catch (saveError) {
            results.errors++;
          }
        }
      }

      return results;

    } catch (error) {
      console.error(`Error extracting RSVP from thread ${thread.name}:`, error.message);
      results.errors++;
      return results;
    }
  }

  /**
   * Parse RSVP data from a bot's embed message
   * @param {Object} embed - Discord embed object
   * @returns {Array} Array of RSVP objects
   */
  parseRsvpFromEmbed(embed) {
    const rsvpData = [];
    
    try {
      const description = embed.description || '';
      
      // Look for the RSVP section in the description
      const rsvpMatch = description.match(/\*\*Current RSVPs:\*\*\n([\s\S]*?)(?:\n\n|$)/);
      if (!rsvpMatch) {
        return rsvpData;
      }

      const rsvpSection = rsvpMatch[1];
      const lines = rsvpSection.split('\n').filter(line => line.trim());

      for (const line of lines) {
        // Parse attending players
        const attendingMatch = line.match(/✅.*?Attending.*?:\s*(.+)/i);
        if (attendingMatch) {
          const players = this.parsePlayersList(attendingMatch[1]);
          for (const player of players) {
            rsvpData.push({
              faceitNickname: player,
              response: 'yes',
              discordId: null // Will need to be resolved
            });
          }
          continue;
        }

        // Parse not attending players
        const notAttendingMatch = line.match(/❌.*?Not Attending.*?:\s*(.+)/i);
        if (notAttendingMatch) {
          const players = this.parsePlayersList(notAttendingMatch[1]);
          for (const player of players) {
            rsvpData.push({
              faceitNickname: player,
              response: 'no',
              discordId: null // Will need to be resolved
            });
          }
          continue;
        }
      }

      // Resolve Discord IDs from FACEIT nicknames
      return this.resolveDiscordIds(rsvpData);

    } catch (error) {
      console.error('Error parsing RSVP from embed:', error.message);
      return rsvpData;
    }
  }

  /**
   * Extract RSVP data from confirmation messages
   * @param {Array} messages - Array of Discord messages
   * @param {string} matchId - Match ID
   * @returns {Array} Array of RSVP objects
   */
  async extractRsvpFromConfirmationMessages(messages, matchId) {
    const rsvpData = [];

    // Look for bot messages that mention RSVP confirmations
    const confirmationMessages = messages.filter(msg => 
      msg.author.id === this.client.user.id &&
      msg.content &&
      (msg.content.includes('Your RSVP has been') || msg.content.includes('RSVP recorded'))
    );

    for (const msg of confirmationMessages) {
      try {
        // Parse RSVP confirmation message
        // Format: "✅ Your RSVP has been recorded! **PlayerName** - YES"
        const rsvpMatch = msg.content.match(/\*\*(.+?)\*\*.*?-\s*(YES|NO)/i);
        if (rsvpMatch) {
          const faceitNickname = rsvpMatch[1];
          const response = rsvpMatch[2].toLowerCase();
          
          // Try to get Discord ID from message mentions or context
          const discordId = await this.resolveDiscordIdFromContext(msg, faceitNickname);
          
          if (discordId) {
            rsvpData.push({
              faceitNickname,
              response,
              discordId
            });
          }
        }
      } catch (error) {
        console.error('Error parsing confirmation message:', error.message);
      }
    }

    return rsvpData;
  }

  /**
   * Parse comma-separated list of player names
   * @param {string} playersList - Raw players string
   * @returns {Array} Array of player names
   */
  parsePlayersList(playersList) {
    return playersList
      .split(',')
      .map(name => name.trim().replace(/\*\*/g, ''))
      .filter(name => name && name.length > 0);
  }

  /**
   * Resolve Discord IDs from FACEIT nicknames using current user mappings
   * @param {Array} rsvpData - Array of RSVP objects
   * @returns {Array} Array of RSVP objects with resolved Discord IDs
   */
  resolveDiscordIds(rsvpData) {
    return rsvpData.map(rsvp => {
      // Look up Discord ID from current user mappings
      const userMapping = Object.values(this.db.userMappings || {})
        .find(user => user.faceit_nickname === rsvp.faceitNickname);
      
      if (userMapping) {
        rsvp.discordId = userMapping.discord_id;
      }
      
      return rsvp;
    }).filter(rsvp => rsvp.discordId); // Only keep RSVPs with resolved Discord IDs
  }

  /**
   * Resolve Discord ID from message context
   * @param {Object} message - Discord message
   * @param {string} faceitNickname - FACEIT nickname
   * @returns {string|null} Discord ID if found
   */
  async resolveDiscordIdFromContext(message, faceitNickname) {
    // Check if message mentions a user
    if (message.mentions && message.mentions.users.size > 0) {
      const mentionedUser = message.mentions.users.first();
      return mentionedUser.id;
    }

    // Look up from current user mappings
    const userMapping = Object.values(this.db.userMappings || {})
      .find(user => user.faceit_nickname === faceitNickname);
    
    return userMapping ? userMapping.discord_id : null;
  }

  /**
   * Extract match ID from thread messages
   * @param {Object} thread - Discord thread
   * @returns {string|null} Match ID if found
   */
  async extractMatchIdFromThread(thread) {
    try {
      // Fetch first few messages to look for match ID
      const messages = await thread.messages.fetch({ limit: 5 });
      
      for (const message of messages.values()) {
        // Look for Match ID in embed footer
        if (message.embeds && message.embeds.length > 0) {
          const embed = message.embeds[0];
          if (embed.footer && embed.footer.text && embed.footer.text.includes('Match ID:')) {
            return embed.footer.text.replace('Match ID: ', '').trim();
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error extracting match ID from thread:', error.message);
      return null;
    }
  }

  /**
   * Fetch all messages from a thread (handling pagination)
   * @param {Object} thread - Discord thread
   * @returns {Array} Array of messages
   */
  async fetchAllThreadMessages(thread) {
    const allMessages = [];
    let lastMessageId;

    try {
      while (true) {
        const options = { limit: 100 };
        if (lastMessageId) {
          options.before = lastMessageId;
        }

        const messages = await thread.messages.fetch(options);
        if (messages.size === 0) break;

        const messageArray = Array.from(messages.values());
        allMessages.push(...messageArray);
        
        lastMessageId = messageArray[messageArray.length - 1].id;
        
        // Prevent infinite loops
        if (messages.size < 100) break;
      }
    } catch (error) {
      console.error('Error fetching thread messages:', error.message);
    }

    return allMessages;
  }

  /**
   * Find all match threads in Discord
   * @returns {Array} Array of thread objects
   */
  async findAllMatchThreads() {
    const config = require('../../config/config');
    const threads = [];

    try {
      const channel = this.client.channels.cache.get(config.discord.channelId);
      if (!channel || !channel.threads) {
        return threads;
      }

      // Fetch active threads
      const activeThreads = await channel.threads.fetchActive();
      threads.push(...activeThreads.threads.values());

      // Fetch archived threads (with pagination)
      let hasMore = true;
      let before = null;

      while (hasMore) {
        const archivedBatch = await channel.threads.fetchArchived({ 
          before,
          limit: 100 
        });
        
        threads.push(...archivedBatch.threads.values());
        
        hasMore = archivedBatch.hasMore;
        if (hasMore && archivedBatch.threads.size > 0) {
          const threadsArray = Array.from(archivedBatch.threads.values());
          before = threadsArray[threadsArray.length - 1].id;
        } else {
          hasMore = false;
        }
      }

      // Filter to only match threads
      return threads.filter(thread => 
        thread.name && 
        (thread.name.startsWith('INCOMING:') || thread.name.startsWith('RESULT:'))
      );

    } catch (error) {
      console.error('Error finding match threads:', error.message);
      return threads;
    }
  }
}

module.exports = RsvpRecoveryService;
