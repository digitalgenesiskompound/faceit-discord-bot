/**
 * User Mapping Recovery Service
 * 
 * Recovers Discord-FACEIT user mappings from message history and interactions.
 * Analyzes bot responses and user interactions to rebuild user linking data.
 */

class UserMappingRecoveryService {
  constructor(client, databaseService) {
    this.client = client;
    this.db = databaseService;
  }

  /**
   * Recover user mappings from Discord interactions
   * @param {Object} options - Recovery options
   * @returns {Object} Recovery results
   */
  async recoverUserMappingsFromDiscord(options = {}) {
    const { scanDepthDays = 30, dryRun = false } = options;
    const cutoffDate = new Date(Date.now() - (scanDepthDays * 24 * 60 * 60 * 1000));

    const results = {
      recovered: 0,
      errors: 0,
      details: []
    };

    try {
      console.log('👥 Scanning Discord for user mapping clues...');
      
      // Strategy 1: Look for bot confirmation messages about linking/registration
      const linkingResults = await this.extractFromLinkingMessages(cutoffDate, dryRun);
      results.recovered += linkingResults.recovered;
      results.errors += linkingResults.errors;
      results.details.push(...linkingResults.details);

      // Strategy 2: Analyze RSVP confirmation messages for user-nickname pairs
      const rsvpResults = await this.extractFromRsvpMessages(cutoffDate, dryRun);
      results.recovered += rsvpResults.recovered;
      results.errors += rsvpResults.errors;
      results.details.push(...rsvpResults.details);

      // Strategy 3: Cross-reference current FACEIT team members with Discord activity
      const teamResults = await this.crossReferenceTeamMembers(cutoffDate, dryRun);
      results.recovered += teamResults.recovered;
      results.errors += teamResults.errors;
      results.details.push(...teamResults.details);

      console.log(`👥 User mapping recovery completed: ${results.recovered} recovered, ${results.errors} errors`);
      return results;

    } catch (error) {
      console.error('❌ Error during user mapping recovery:', error.message);
      results.errors++;
      return results;
    }
  }

  /**
   * Extract user mappings from bot's linking confirmation messages
   * @param {Date} cutoffDate - Only scan messages after this date
   * @param {boolean} dryRun - Whether to actually save the data
   * @returns {Object} Extraction results
   */
  async extractFromLinkingMessages(cutoffDate, dryRun = false) {
    const results = {
      recovered: 0,
      errors: 0,
      details: []
    };

    try {
      console.log('🔗 Scanning for account linking messages...');
      const config = require('../../config/config');
      const channel = this.client.channels.cache.get(config.discord.channelId);
      
      if (!channel) {
        results.errors++;
        return results;
      }

      // Search for bot messages about successful linking
      const messages = await this.fetchRecentMessages(channel, cutoffDate, 1000);
      
      const linkingMessages = messages.filter(msg => 
        msg.author.id === this.client.user.id &&
        (msg.content?.includes('Successfully linked') || 
         msg.content?.includes('linked to FACEIT account') ||
         (msg.embeds.length > 0 && msg.embeds[0].title?.includes('Successfully Linked')))
      );

      console.log(`🔗 Found ${linkingMessages.length} potential linking messages`);

      for (const message of linkingMessages) {
        try {
          const mapping = this.parseLinkingMessage(message);
          if (mapping && !dryRun) {
            // Check if mapping already exists
            const existing = await this.db.getUserMappingByDiscordIdFromDB(mapping.discordId);
            if (!existing) {
              await this.db.addUserMapping(mapping.discordId, mapping.discordUsername, {
                nickname: mapping.faceitNickname,
                player_id: mapping.faceitPlayerId || 'recovered',
                skill_level: mapping.skillLevel || 'Unknown',
                faceit_elo: mapping.elo || 'Unknown',
                country: mapping.country || 'Unknown'
              });
              results.recovered++;
              results.details.push({
                type: 'linking_message',
                discordId: mapping.discordId,
                faceitNickname: mapping.faceitNickname,
                source: 'bot_confirmation'
              });
            }
          } else if (mapping && dryRun) {
            results.recovered++;
            results.details.push({
              type: 'linking_message',
              discordId: mapping.discordId,
              faceitNickname: mapping.faceitNickname,
              source: 'bot_confirmation',
              dryRun: true
            });
          }
        } catch (parseError) {
          console.error('Error parsing linking message:', parseError.message);
          results.errors++;
        }
      }

      return results;

    } catch (error) {
      console.error('Error extracting from linking messages:', error.message);
      results.errors++;
      return results;
    }
  }

  /**
   * Extract user mappings from RSVP confirmation messages
   * @param {Date} cutoffDate - Only scan messages after this date
   * @param {boolean} dryRun - Whether to actually save the data
   * @returns {Object} Extraction results
   */
  async extractFromRsvpMessages(cutoffDate, dryRun = false) {
    const results = {
      recovered: 0,
      errors: 0,
      details: []
    };

    try {
      console.log('📋 Scanning RSVP messages for user mappings...');
      
      // Get all match threads
      const threads = await this.findAllMatchThreads();
      
      for (const thread of threads) {
        if (thread.createdAt < cutoffDate) continue;

        try {
          const messages = await this.fetchAllThreadMessages(thread);
          
          // Look for RSVP confirmation messages that include user mentions
          const rsvpMessages = messages.filter(msg => 
            msg.author.id === this.client.user.id &&
            msg.content &&
            msg.content.includes('Your RSVP has been') &&
            msg.content.includes('**') // Contains formatted nickname
          );

          for (const message of rsvpMessages) {
            try {
              const mapping = await this.parseRsvpMessage(message);
              if (mapping && !dryRun) {
                const existing = await this.db.getUserMappingByDiscordIdFromDB(mapping.discordId);
                if (!existing) {
                  await this.db.addUserMapping(mapping.discordId, mapping.discordUsername, {
                    nickname: mapping.faceitNickname,
                    player_id: 'recovered_from_rsvp',
                    skill_level: 'Unknown',
                    faceit_elo: 'Unknown',
                    country: 'Unknown'
                  });
                  results.recovered++;
                  results.details.push({
                    type: 'rsvp_message',
                    discordId: mapping.discordId,
                    faceitNickname: mapping.faceitNickname,
                    source: 'rsvp_confirmation',
                    threadName: thread.name
                  });
                }
              } else if (mapping && dryRun) {
                results.recovered++;
                results.details.push({
                  type: 'rsvp_message',
                  discordId: mapping.discordId,
                  faceitNickname: mapping.faceitNickname,
                  source: 'rsvp_confirmation',
                  threadName: thread.name,
                  dryRun: true
                });
              }
            } catch (parseError) {
              results.errors++;
            }
          }
        } catch (threadError) {
          console.error(`Error processing thread ${thread.name}:`, threadError.message);
          results.errors++;
        }
      }

      return results;

    } catch (error) {
      console.error('Error extracting from RSVP messages:', error.message);
      results.errors++;
      return results;
    }
  }

  /**
   * Cross-reference current FACEIT team members with Discord activity
   * @param {Date} cutoffDate - Only consider recent activity
   * @param {boolean} dryRun - Whether to actually save the data
   * @returns {Object} Cross-reference results
   */
  async crossReferenceTeamMembers(cutoffDate, dryRun = false) {
    const results = {
      recovered: 0,
      errors: 0,
      details: []
    };

    try {
      console.log('🔍 Cross-referencing FACEIT team members with Discord activity...');
      
      // Get current team members from FACEIT
      const faceitService = require('../faceitService');
      const teamMembers = await faceitService.listTeamPlayers();
      
      if (teamMembers.length === 0) {
        console.log('No team members found from FACEIT API');
        return results;
      }

      console.log(`Found ${teamMembers.length} team members to cross-reference`);

      // For each team member, look for Discord activity patterns
      for (const member of teamMembers) {
        try {
          const discordMatch = await this.findDiscordUserForFaceitPlayer(member, cutoffDate);
          
          if (discordMatch && !dryRun) {
            const existing = await this.db.getUserMappingByDiscordIdFromDB(discordMatch.discordId);
            if (!existing) {
              await this.db.addUserMapping(discordMatch.discordId, discordMatch.discordUsername, {
                nickname: member.nickname,
                player_id: member.user_id,
                skill_level: member.skill_level || 'Unknown',
                faceit_elo: member.faceit_elo || 'Unknown',
                country: member.country || 'Unknown'
              });
              results.recovered++;
              results.details.push({
                type: 'cross_reference',
                discordId: discordMatch.discordId,
                faceitNickname: member.nickname,
                source: 'activity_pattern',
                confidence: discordMatch.confidence
              });
            }
          } else if (discordMatch && dryRun) {
            results.recovered++;
            results.details.push({
              type: 'cross_reference',
              discordId: discordMatch.discordId,
              faceitNickname: member.nickname,
              source: 'activity_pattern',
              confidence: discordMatch.confidence,
              dryRun: true
            });
          }
        } catch (memberError) {
          console.error(`Error processing team member ${member.nickname}:`, memberError.message);
          results.errors++;
        }
      }

      return results;

    } catch (error) {
      console.error('Error during cross-referencing:', error.message);
      results.errors++;
      return results;
    }
  }

  /**
   * Parse a linking confirmation message for user mapping data
   * @param {Object} message - Discord message
   * @returns {Object|null} Parsed mapping data
   */
  parseLinkingMessage(message) {
    try {
      // Look for embed with linking info
      if (message.embeds.length > 0) {
        const embed = message.embeds[0];
        if (embed.title?.includes('Successfully Linked')) {
          // Parse embed description for FACEIT nickname
          const description = embed.description || '';
          const nicknameMatch = description.match(/\*\*\[(.+?)\]/);
          
          if (nicknameMatch) {
            return {
              discordId: message.interaction?.user?.id || null,
              discordUsername: message.interaction?.user?.username || null,
              faceitNickname: nicknameMatch[1],
              skillLevel: this.extractFieldValue(embed, 'Skill Level'),
              elo: this.extractFieldValue(embed, 'ELO'),
              country: this.extractFieldValue(embed, 'Country')
            };
          }
        }
      }

      // Look for content-based linking messages
      if (message.content) {
        const contentMatch = message.content.match(/linked to FACEIT account \*\*(.+?)\*\*/);
        if (contentMatch) {
          return {
            discordId: message.interaction?.user?.id || null,
            discordUsername: message.interaction?.user?.username || null,
            faceitNickname: contentMatch[1]
          };
        }
      }

      return null;
    } catch (error) {
      console.error('Error parsing linking message:', error.message);
      return null;
    }
  }

  /**
   * Parse an RSVP confirmation message for user mapping data
   * @param {Object} message - Discord message
   * @returns {Object|null} Parsed mapping data
   */
  async parseRsvpMessage(message) {
    try {
      // Parse RSVP confirmation message
      // Format: "✅ Your RSVP has been recorded! **PlayerName** - YES"
      const rsvpMatch = message.content.match(/\*\*(.+?)\*\*.*?-\s*(YES|NO)/i);
      if (!rsvpMatch) return null;

      const faceitNickname = rsvpMatch[1];
      
      // Try to find the Discord user who triggered this message
      let discordId = null;
      let discordUsername = null;

      // Method 1: Check for user mentions in the message
      if (message.mentions?.users.size > 0) {
        const mentionedUser = message.mentions.users.first();
        discordId = mentionedUser.id;
        discordUsername = mentionedUser.username;
      }

      // Method 2: Check interaction data if available
      if (!discordId && message.interaction?.user) {
        discordId = message.interaction.user.id;
        discordUsername = message.interaction.user.username;
      }

      // Method 3: Look for recent button interactions in the same thread
      if (!discordId) {
        const recentActivity = await this.findRecentUserActivity(message.channel, faceitNickname);
        if (recentActivity) {
          discordId = recentActivity.discordId;
          discordUsername = recentActivity.discordUsername;
        }
      }

      if (discordId && faceitNickname) {
        return {
          discordId,
          discordUsername,
          faceitNickname
        };
      }

      return null;
    } catch (error) {
      console.error('Error parsing RSVP message:', error.message);
      return null;
    }
  }

  /**
   * Find Discord user for a FACEIT player based on activity patterns
   * @param {Object} faceitPlayer - FACEIT player data
   * @param {Date} cutoffDate - Activity cutoff date
   * @returns {Object|null} Discord user match with confidence score
   */
  async findDiscordUserForFaceitPlayer(faceitPlayer, cutoffDate) {
    try {
      // This is a basic implementation - could be enhanced with more sophisticated matching
      // For now, we'll look for exact nickname matches in recent messages
      
      const config = require('../../config/config');
      const channel = this.client.channels.cache.get(config.discord.channelId);
      if (!channel) return null;

      // Look for messages containing the FACEIT nickname
      const messages = await this.fetchRecentMessages(channel, cutoffDate);
      const relevantMessages = messages.filter(msg => 
        msg.content?.includes(faceitPlayer.nickname) && 
        !msg.author.bot
      );

      if (relevantMessages.length > 0) {
        // Use the most recent message author as a potential match
        const message = relevantMessages[0];
        return {
          discordId: message.author.id,
          discordUsername: message.author.username,
          confidence: relevantMessages.length > 1 ? 'high' : 'medium'
        };
      }

      return null;
    } catch (error) {
      console.error(`Error finding Discord user for ${faceitPlayer.nickname}:`, error.message);
      return null;
    }
  }

  /**
   * Extract field value from Discord embed
   * @param {Object} embed - Discord embed
   * @param {string} fieldName - Field name to look for
   * @returns {string|null} Field value if found
   */
  extractFieldValue(embed, fieldName) {
    if (!embed.fields) return null;
    
    const field = embed.fields.find(f => f.name?.includes(fieldName));
    return field ? field.value : null;
  }

  /**
   * Find recent user activity in a channel/thread
   * @param {Object} channel - Discord channel or thread
   * @param {string} faceitNickname - FACEIT nickname to look for
   * @returns {Object|null} User activity data
   */
  async findRecentUserActivity(channel, faceitNickname) {
    try {
      const messages = await channel.messages.fetch({ limit: 50 });
      
      // Look for recent messages that mention this nickname
      const relevantMessage = messages.find(msg => 
        !msg.author.bot &&
        msg.content?.includes(faceitNickname)
      );

      if (relevantMessage) {
        return {
          discordId: relevantMessage.author.id,
          discordUsername: relevantMessage.author.username
        };
      }

      return null;
    } catch (error) {
      console.error('Error finding recent user activity:', error.message);
      return null;
    }
  }

  /**
   * Fetch recent messages from a channel
   * @param {Object} channel - Discord channel
   * @param {Date} cutoffDate - Only fetch messages after this date
   * @param {number} limit - Maximum messages to fetch
   * @returns {Array} Array of messages
   */
  async fetchRecentMessages(channel, cutoffDate, limit = 500) {
    const messages = [];
    let lastMessageId;

    try {
      while (messages.length < limit) {
        const options = { limit: Math.min(100, limit - messages.length) };
        if (lastMessageId) {
          options.before = lastMessageId;
        }

        const batch = await channel.messages.fetch(options);
        if (batch.size === 0) break;

        const messageArray = Array.from(batch.values());
        
        // Filter by date
        const recentMessages = messageArray.filter(msg => msg.createdAt >= cutoffDate);
        messages.push(...recentMessages);
        
        // If we hit the date cutoff, stop fetching
        if (recentMessages.length < messageArray.length) break;
        
        lastMessageId = messageArray[messageArray.length - 1].id;
        if (batch.size < 100) break;
      }
    } catch (error) {
      console.error('Error fetching recent messages:', error.message);
    }

    return messages;
  }

  /**
   * Fetch all messages from a thread (with pagination)
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
      if (!channel?.threads) return threads;

      // Get active threads
      const activeThreads = await channel.threads.fetchActive();
      threads.push(...activeThreads.threads.values());

      // Get archived threads
      let hasMore = true;
      let before = null;

      while (hasMore) {
        const archivedBatch = await channel.threads.fetchArchived({ before, limit: 100 });
        threads.push(...archivedBatch.threads.values());
        
        hasMore = archivedBatch.hasMore;
        if (hasMore && archivedBatch.threads.size > 0) {
          const threadsArray = Array.from(archivedBatch.threads.values());
          before = threadsArray[threadsArray.length - 1].id;
        } else {
          hasMore = false;
        }
      }

      return threads.filter(thread => 
        thread.name?.startsWith('INCOMING:') || thread.name?.startsWith('RESULT:')
      );

    } catch (error) {
      console.error('Error finding match threads:', error.message);
      return threads;
    }
  }
}

module.exports = UserMappingRecoveryService;
