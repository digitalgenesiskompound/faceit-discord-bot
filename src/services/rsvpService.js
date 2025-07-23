/**
 * RSVP Service
 * 
 * Handles all RSVP-related operations including:
 * - Comparing RSVP states between database and Discord messages
 * - Detecting and correcting RSVP mismatches
 * - Batch processing RSVP synchronization
 */

class RsvpService {
  constructor(databaseService, client) {
    this.db = databaseService;
    this.client = client;
    
    // Cache for RSVP comparison results to avoid redundant processing
    this.rsvpComparisonCache = new Map();
    this.cacheExpiryTime = 5 * 60 * 1000; // 5 minutes cache
  }
  
  /**
   * Clear the RSVP comparison cache
   */
  clearRsvpCache() {
    this.rsvpComparisonCache.clear();
    console.log('🧹 Cleared RSVP comparison cache');
  }
  
  /**
   * Get cached comparison result if valid, otherwise return null
   */
  getCachedComparison(matchId) {
    const cached = this.rsvpComparisonCache.get(matchId);
    if (cached && (Date.now() - cached.timestamp) < this.cacheExpiryTime) {
      console.log(`💾 Using cached RSVP comparison for match ${matchId} (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
      return cached.result;
    }
    return null;
  }
  
  /**
   * Cache comparison result
   */
  setCachedComparison(matchId, result) {
    this.rsvpComparisonCache.set(matchId, {
      result: result,
      timestamp: Date.now()
    });
  }

  /**
   * Compare RSVP state between database and Discord message
   * @param {string} matchId - The match ID to check
   * @returns {Object} Comparison results
   */
  async compareRsvpStates(matchId) {
    try {
      console.log(`🔍 Starting RSVP state comparison for match ${matchId}`);
      
      // Step 1: Fetch current RSVP database state
      const databaseRsvps = this.db.getRsvpForMatch(matchId);
      console.log(`📊 Database RSVP state:`, databaseRsvps);
      
      // Step 2: Find the thread for this match
      const threadId = this.db.matchThreads.get(matchId);
      if (!threadId) {
        throw new Error(`No thread found for match ${matchId}`);
      }
      
      const thread = await this.client.channels.fetch(threadId);
      if (!thread) {
        throw new Error(`Could not fetch thread ${threadId} for match ${matchId}`);
      }
      
      // Step 3: Check for any RSVP-related activity in the thread
      console.log(`🔍 Analyzing thread activity for RSVP evidence`);
      const messages = await thread.messages.fetch({ limit: 50 });
      
      // Check if this is a result thread that shouldn't have RSVP sync
      const isResultThread = thread.name && thread.name.startsWith('RESULT:');
      if (isResultThread) {
        console.log(`⚠️ Skipping RSVP sync for RESULT thread ${threadId} (match ${matchId}) - RSVP not applicable`);
        return {
          matchId,
          threadId,
          skipReason: 'RESULT_THREAD_NO_RSVP',
          message: 'Result threads do not need RSVP synchronization'
        };
      }
      
      // Look for evidence of RSVP activity in the thread
      const rsvpEvidence = await this.analyzeThreadRsvpActivity(messages, matchId);
      console.log(`📋 Thread RSVP activity analysis:`, rsvpEvidence);
      
      // If no RSVP activity found in thread, database is the source of truth
      if (!rsvpEvidence.hasRsvpActivity) {
        console.log(`✅ No RSVP activity detected in thread - database is authoritative for match ${matchId}`);
        return {
          matchId,
          threadId,
          databaseState: databaseRsvps,
          displayedState: { attending: [], notAttending: [], noResponse: [] },
          comparison: {
            isMatching: true, // Consider it matching since thread has no RSVP data to conflict with
            differences: {},
            summary: { threadHasNoRsvpActivity: true }
          },
          noThreadActivity: true
        };
      }
      
      console.log(`💬 Found RSVP activity in thread for match ${matchId}`);
      
      // Step 4: Extract RSVP data from the thread activity
      const displayedRsvps = rsvpEvidence.extractedRsvps;
      console.log(`🖥️ Thread RSVP state:`, displayedRsvps);
      
      // Step 5: Compare the states
      const comparison = this.compareStates(databaseRsvps, displayedRsvps, this.db.userMappings);
      
      console.log(`✅ RSVP state comparison completed for match ${matchId}`);
      return {
        matchId,
        threadId,
        databaseState: databaseRsvps,
        displayedState: displayedRsvps,
        comparison,
        activitySource: rsvpEvidence.activitySource || 'thread_analysis'
      };
      
    } catch (error) {
      console.error(`❌ Error comparing RSVP states for match ${matchId}:`, error.message);
      throw error;
    }
  }

  /**
   * Analyze thread messages for RSVP activity evidence
   * @param {Collection} messages - Discord messages from the thread
   * @param {string} matchId - The match ID being analyzed
   * @returns {Object} Analysis results
   */
  async analyzeThreadRsvpActivity(messages, matchId) {
    const evidence = {
      hasRsvpActivity: false,
      extractedRsvps: { attending: [], notAttending: [], noResponse: [] },
      activitySource: null,
      foundMessages: []
    };
    
    console.log(`🔍 Analyzing ${messages.size} messages for RSVP activity...`);
    
    for (const [messageId, message] of messages) {
      // Look for RSVP Status messages (bot-authored embeds)
      if (message.author.id === this.client.user.id && 
          message.embeds.length > 0 && 
          message.embeds[0].title && 
          message.embeds[0].title.includes('RSVP Status')) {
        
        console.log(`💬 Found RSVP Status embed: "${message.embeds[0].title}"`);
        evidence.hasRsvpActivity = true;
        evidence.activitySource = 'rsvp_status_embed';
        evidence.foundMessages.push({
          id: messageId,
          type: 'rsvp_status_embed',
          content: message.embeds[0].title
        });
        
        // Extract RSVP data from this message
        const extractedData = this.extractRsvpFromMessage(message);
        evidence.extractedRsvps = extractedData;
        break; // Use the first RSVP Status message found
      }
      
      // Look for messages with RSVP buttons (bot-authored with components)
      if (message.author.id === this.client.user.id && 
          message.components && 
          message.components.length > 0) {
        
        const hasRsvpButtons = message.components.some(row => 
          row.components && row.components.some(button => 
            button.customId && button.customId.includes(`rsvp_`) && button.customId.includes(matchId)
          )
        );
        
        if (hasRsvpButtons) {
          console.log(`🔘 Found message with RSVP buttons for match ${matchId}`);
          evidence.hasRsvpActivity = true;
          if (!evidence.activitySource) {
            evidence.activitySource = 'rsvp_buttons';
            evidence.foundMessages.push({
              id: messageId,
              type: 'rsvp_buttons',
              content: 'Message with RSVP buttons'
            });
          }
        }
      }
      
      // Look for messages mentioning RSVP or attendance keywords
      const messageContent = message.content?.toLowerCase() || '';
      const rsvpKeywords = ['rsvp', 'attending', 'not attending', 'can\'t make it', 'will be there'];
      
      if (rsvpKeywords.some(keyword => messageContent.includes(keyword))) {
        console.log(`💬 Found message with RSVP keywords: "${message.content?.substring(0, 50)}..."`);
        evidence.hasRsvpActivity = true;
        if (!evidence.activitySource) {
          evidence.activitySource = 'keyword_mentions';
          evidence.foundMessages.push({
            id: messageId,
            type: 'keyword_mentions',
            content: message.content?.substring(0, 100) || 'No content'
          });
        }
      }
    }
    
    console.log(`📋 Analysis complete: ${evidence.hasRsvpActivity ? 'RSVP activity detected' : 'No RSVP activity found'}`);
    if (evidence.hasRsvpActivity) {
      console.log(`🔍 Activity source: ${evidence.activitySource}`);
      console.log(`📋 Found messages:`, evidence.foundMessages.map(m => `${m.type}: ${m.content}`));
    }
    
    return evidence;
  }

  /**
   * Extract RSVP information from a Discord message embed
   * @param {Object} message - Discord message with RSVP embed
   * @returns {Object} Extracted RSVP data
   */
  extractRsvpFromMessage(message) {
    const embed = message.embeds[0];
    const description = embed.description || '';
    
    console.log(`🔍 Debug: Full embed description:`);
    console.log(description);
    
    const extractedRsvps = {
      attending: [],
      notAttending: [],
      noResponse: []
    };
    
    try {
      // Look for the "Current RSVPs:" section in the description
      const rsvpSectionMatch = description.match(/\*\*Current RSVPs:\*\*\n([\s\S]*?)(?:\n\n|$)/);
      
      if (rsvpSectionMatch) {
        const rsvpText = rsvpSectionMatch[1];
        console.log(`🔍 Debug: Extracted RSVP text section:`);
        console.log(`"${rsvpText}"`);
        
        // Parse the RSVP text for different status categories
        const lines = rsvpText.split('\n');
        console.log(`🔍 Debug: Split into ${lines.length} lines:`, lines);
        
        for (const line of lines) {
          console.log(`🔍 Debug: Processing line: "${line}"`);
          
          // Match patterns like "✅ **Attending (2):** player1, player2"
          // Using unicode escape sequences for more reliable emoji matching
          const attendingMatch = line.match(/[✅✓].*?\*\*Attending.*?\*\*.*?:\s*(.+)/);
            if (attendingMatch) {
              console.log(`✅ Found attending match:`, attendingMatch[1]);
              extractedRsvps.attending = attendingMatch[1].split(',').map(name => name.trim().replace(/^\*\*\s*/, '')).filter(name => name);
              continue;
            }
          
          // Match patterns like "❌ **Not Attending (1):** player3"
          const notAttendingMatch = line.match(/[❌✗×].*?\*\*Not Attending.*?\*\*.*?:\s*(.+)/);
          if (notAttendingMatch) {
            console.log(`❌ Found not attending match:`, notAttendingMatch[1]);
            extractedRsvps.notAttending = notAttendingMatch[1].split(',').map(name => name.trim().replace(/^\*\*\s*/, '')).filter(name => name);
            continue;
          }
          
          // Match patterns like "⏳ **No Response (3):** player4, player5, player6"
          const noResponseMatch = line.match(/[⏳🕐🕑🕒🕓🕔🕕🕖🕗🕘🕙🕚🕛].*?\*\*No Response.*?\*\*.*?:\s*(.+)/);
          if (noResponseMatch) {
            console.log(`⏳ Found no response match:`, noResponseMatch[1]);
            extractedRsvps.noResponse = noResponseMatch[1].split(',').map(name => name.trim()).filter(name => name);
            continue;
          }
          
          // More specific patterns without emoji requirements - handle each type separately
          // Handle "**Attending (X):** names" pattern first (must not contain "Not" or "No")
          if (line.includes('**Attending') && line.includes(':**') && !line.includes('Not') && !line.includes('No')) {
            console.log(`🔍 Debug: Line contains 'Attending' pattern (not Not/No Attending)`);
            const attendingFallbackMatch = line.match(/\*\*Attending.*?\*\*.*?:\s*(.+)/);
            if (attendingFallbackMatch) {
              console.log(`✅ Found attending fallback match:`, attendingFallbackMatch[1]);
              extractedRsvps.attending = attendingFallbackMatch[1].split(',').map(name => name.trim()).filter(name => name);
              continue;
            }
          }
          
          // Handle "**Not Attending (X):** names" pattern
          if (line.includes('**Not Attending') && line.includes(':**')) {
            console.log(`🔍 Debug: Line contains 'Not Attending' pattern`);
            const notAttendingFallbackMatch = line.match(/\*\*Not Attending.*?\*\*.*?:\s*(.+)/);
            if (notAttendingFallbackMatch) {
              console.log(`❌ Found not attending fallback match:`, notAttendingFallbackMatch[1]);
              extractedRsvps.notAttending = notAttendingFallbackMatch[1].split(',').map(name => name.trim()).filter(name => name);
              continue;
            }
          }
          
          // Handle "**No Response (X):** names" pattern
          if (line.includes('**No Response') && line.includes(':**')) {
            console.log(`🔍 Debug: Line contains 'No Response' pattern`);
            const noResponseFallbackMatch = line.match(/\*\*No Response.*?\*\*.*?:\s*(.+)/);
            if (noResponseFallbackMatch) {
              console.log(`⏳ Found no response fallback match:`, noResponseFallbackMatch[1]);
              extractedRsvps.noResponse = noResponseFallbackMatch[1].split(',').map(name => name.trim()).filter(name => name);
              continue;
            }
          }
          
          // Very simple fallback - just look for colon followed by names after common keywords
          if (line.includes(':') && (line.includes('Attending') || line.includes('Not Attending') || line.includes('No Response'))) {
            console.log(`🔍 Debug: Simple colon pattern detected`);
            const colonMatch = line.match(/:\s*(.+)$/);
            if (colonMatch && colonMatch[1].trim()) {
              const namesPart = colonMatch[1].trim();
              console.log(`🔍 Debug: Extracted names part: "${namesPart}"`);
              
              if (line.toLowerCase().includes('attending') && !line.toLowerCase().includes('not attending')) {
                console.log(`✅ Simple attending match:`, namesPart);
                extractedRsvps.attending = namesPart.split(',').map(name => name.trim().replace(/^\*\*\s*/, '')).filter(name => name);
              } else if (line.toLowerCase().includes('not attending')) {
                console.log(`❌ Simple not attending match:`, namesPart);
                extractedRsvps.notAttending = namesPart.split(',').map(name => name.trim().replace(/^\*\*\s*/, '')).filter(name => name);
              } else if (line.toLowerCase().includes('no response')) {
                console.log(`⏳ Simple no response match:`, namesPart);
                extractedRsvps.noResponse = namesPart.split(',').map(name => name.trim().replace(/^\*\*\s*/, '')).filter(name => name);
              }
            }
          }
        }
      } else {
        console.log(`⚠️ Debug: No 'Current RSVPs:' section found in description`);
      }
      
    } catch (parseError) {
      console.error('Error parsing RSVP from message embed:', parseError.message);
    }
    
    console.log(`🔍 Debug: Final extracted RSVPs:`, extractedRsvps);
    return extractedRsvps;
  }

  /**
   * Compare database RSVP state with displayed state
   * @param {Object} databaseRsvps - RSVP data from database
   * @param {Object} displayedRsvps - RSVP data extracted from Discord message
   * @param {Object} userMappings - User mapping data for Discord ID to FACEIT nickname
   * @returns {Object} Comparison results
   */
  compareStates(databaseRsvps, displayedRsvps, userMappings) {
    // Convert database RSVPs to the same format as displayed RSVPs
    const dbState = {
      attending: [],
      notAttending: [],
      noResponse: []
    };
    
    // Get all registered users
    const allUsers = Object.values(userMappings);
    
    // Categorize users based on database RSVP state
    allUsers.forEach(user => {
      const rsvp = databaseRsvps[user.discord_id];
      if (rsvp) {
        if (rsvp.response === 'yes') {
          dbState.attending.push(user.faceit_nickname);
        } else if (rsvp.response === 'no') {
          dbState.notAttending.push(user.faceit_nickname);
        }
      } else {
        dbState.noResponse.push(user.faceit_nickname);
      }
    });
    
    // Sort arrays for comparison
    const sortArrays = (obj) => {
      Object.keys(obj).forEach(key => {
        obj[key].sort();
      });
      return obj;
    };
    
    const sortedDbState = sortArrays({...dbState});
    const sortedDisplayedState = sortArrays({
      attending: [...displayedRsvps.attending],
      notAttending: [...displayedRsvps.notAttending], 
      noResponse: [...displayedRsvps.noResponse]
    });
    
    // Compare states
    const comparison = {
      isMatching: true,
      differences: {},
      summary: {}
    };
    
    // Check each category
    ['attending', 'notAttending', 'noResponse'].forEach(category => {
      const dbList = sortedDbState[category];
      const displayedList = sortedDisplayedState[category];
      
      const isEqual = JSON.stringify(dbList) === JSON.stringify(displayedList);
      
      if (!isEqual) {
        comparison.isMatching = false;
        comparison.differences[category] = {
          database: dbList,
          displayed: displayedList,
          onlyInDatabase: dbList.filter(x => !displayedList.includes(x)),
          onlyInDisplay: displayedList.filter(x => !dbList.includes(x))
        };
      }
      
      comparison.summary[category] = {
        databaseCount: dbList.length,
        displayedCount: displayedList.length,
        isMatching: isEqual
      };
    });
    
    return comparison;
  }

  /**
   * Detect RSVP mismatch and trigger update if needed
   * @param {string} matchId - The match ID to check
   * @param {Object} thread - Optional Discord thread object (will be fetched if not provided)
   * @param {Object} discordService - Discord service instance
   * @param {boolean} forceRefresh - Skip cache and force fresh comparison
   * @returns {Object} Result of mismatch detection and update
   */
  async detectMismatchAndUpdate(matchId, thread, discordService, forceRefresh = false) {
    try {
      console.log(`🔍 Checking for RSVP mismatch for match ${matchId}`);
      
      // Step 1: Compare current RSVP states
      const comparisonResult = await this.compareRsvpStates(matchId);
      
      // Check if we should skip this match (only for RESULT threads)
      if (comparisonResult.skipReason === 'RESULT_THREAD_NO_RSVP') {
        console.log(`⏭️ Skipping RSVP sync for RESULT thread (match ${matchId}) - RSVP not applicable`);
        return {
          matchId,
          hadMismatch: false,
          updateTriggered: false,
          skipped: true,
          skipReason: comparisonResult.skipReason,
          message: comparisonResult.message
        };
      }
      
      // Step 2: Check if there's a mismatch
      if (comparisonResult.comparison.isMatching) {
        console.log(`✅ RSVP states are synchronized for match ${matchId}`);
        return {
          matchId,
          hadMismatch: false,
          updateTriggered: false,
          message: 'RSVP states are already synchronized'
        };
      }
      
      // Step 3: Log the detected differences
      console.log(`⚠️ RSVP mismatch detected for match ${matchId}:`);
      console.log('Differences:', JSON.stringify(comparisonResult.comparison.differences, null, 2));
      
      // Log detailed summary of differences
      Object.keys(comparisonResult.comparison.differences).forEach(category => {
        const diff = comparisonResult.comparison.differences[category];
        console.log(`  ${category}:`);
        console.log(`    Database: [${diff.database.join(', ')}]`);
        console.log(`    Displayed: [${diff.displayed.join(', ')}]`);
        if (diff.onlyInDatabase.length > 0) {
          console.log(`    Only in database: [${diff.onlyInDatabase.join(', ')}]`);
        }
        if (diff.onlyInDisplay.length > 0) {
          console.log(`    Only in display: [${diff.onlyInDisplay.join(', ')}]`);
        }
      });
      
      // Step 4: Get thread if not provided
      let targetThread = thread;
      if (!targetThread) {
        try {
          const threadId = this.db.matchThreads.get(matchId);
          if (!threadId) {
            throw new Error(`No thread ID found for match ${matchId}`);
          }
          targetThread = await this.client.channels.fetch(threadId);
          if (!targetThread) {
            throw new Error(`Could not fetch thread ${threadId}`);
          }
          console.log(`📡 Fetched thread: ${targetThread.name}`);
        } catch (threadError) {
          console.error(`❌ Failed to get thread for match ${matchId}: ${threadError.message}`);
          return {
            matchId,
            hadMismatch: true,
            updateTriggered: false,
            error: `Failed to get thread: ${threadError.message}`,
            comparisonResult
          };
        }
      }
      
      // Step 5: Trigger RSVP update using the existing method
      console.log(`🔄 Triggering RSVP update for match ${matchId} via updateThreadRsvpStatus`);
      
      try {
        await discordService.updateThreadRsvpStatus(matchId, targetThread);
        console.log(`✅ Successfully updated RSVP status for match ${matchId}`);
        
        return {
          matchId,
          hadMismatch: true,
          updateTriggered: true,
          message: 'RSVP mismatch detected and update triggered successfully',
          comparisonResult,
          threadId: targetThread.id,
          threadName: targetThread.name
        };
        
      } catch (updateError) {
        console.error(`❌ Failed to update RSVP status for match ${matchId}: ${updateError.message}`);
        return {
          matchId,
          hadMismatch: true,
          updateTriggered: false,
          error: `Failed to update RSVP status: ${updateError.message}`,
          comparisonResult
        };
      }
      
    } catch (error) {
      console.error(`❌ Error in detectMismatchAndUpdate for match ${matchId}: ${error.message}`);
      return {
        matchId,
        hadMismatch: null, // Unknown due to error
        updateTriggered: false,
        error: error.message
      };
    }
  }

  /**
   * Batch process multiple matches for RSVP mismatch detection
   * @param {Array} matchIds - Array of match IDs to check
   * @param {Object} discordService - Discord service instance
   * @returns {Object} Summary of batch processing results
   */
  async batchDetectMismatchAndUpdate(matchIds, discordService) {
    console.log(`🔍 Batch processing ${matchIds.length} matches for RSVP mismatches`);
    
    const results = {
      processed: 0,
      synchronized: 0,
      mismatched: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      details: []
    };
    
    for (const matchId of matchIds) {
      try {
        console.log(`\n--- Processing match ${results.processed + 1}/${matchIds.length}: ${matchId} ---`);
        
        const result = await this.detectMismatchAndUpdate(matchId, null, discordService);
        
        results.processed++;
        results.details.push(result);
        
        if (result.error) {
          results.errors++;
        } else if (result.skipped) {
          results.skipped++;
        } else if (!result.hadMismatch) {
          results.synchronized++;
        } else {
          results.mismatched++;
          if (result.updateTriggered) {
            results.updated++;
          }
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (batchError) {
        console.error(`❌ Batch processing error for match ${matchId}: ${batchError.message}`);
        results.errors++;
        results.processed++;
        results.details.push({
          matchId,
          hadMismatch: null,
          updateTriggered: false,
          error: batchError.message
        });
      }
    }
    
    // Log summary
    console.log(`\n📊 Batch Processing Summary:`);
    console.log(`   Total processed: ${results.processed}`);
    console.log(`   Already synchronized: ${results.synchronized}`);
    console.log(`   Skipped (no RSVP applicable): ${results.skipped}`);
    console.log(`   Mismatched: ${results.mismatched}`);
    console.log(`   Successfully updated: ${results.updated}`);
    console.log(`   Errors: ${results.errors}`);
    
    return results;
  }

  /**
   * Check all active INCOMING threads for RSVP mismatches
   * @param {Object} discordService - Discord service instance
   * @returns {Object} Results of checking all incoming threads
   */
  async checkAllIncomingThreadsForMismatches(discordService) {
    try {
      console.log(`🔍 Checking all INCOMING threads for RSVP mismatches...`);
      
      // Get all upcoming matches from the database/cache
      const allMatchIds = [];
      
      // Add matches from upcomingMatches cache
      if (this.db.upcomingMatches && this.db.upcomingMatches.size > 0) {
        for (const matchId of this.db.upcomingMatches.keys()) {
          allMatchIds.push(matchId);
        }
      }
      
      // Also check matchThreads for any additional INCOMING threads
      if (this.db.matchThreads && this.db.matchThreads.size > 0) {
        for (const matchId of this.db.matchThreads.keys()) {
          if (!allMatchIds.includes(matchId)) {
            // Verify this is an INCOMING thread by checking if the match is still upcoming
            const threadId = this.db.matchThreads.get(matchId);
            try {
              const thread = await this.client.channels.fetch(threadId);
              if (thread && thread.name && thread.name.startsWith('INCOMING:')) {
                allMatchIds.push(matchId);
              }
            } catch (threadError) {
              console.log(`Could not fetch thread ${threadId} for match ${matchId}: ${threadError.message}`);
            }
          }
        }
      }
      
      console.log(`Found ${allMatchIds.length} matches to check for RSVP synchronization`);
      
      if (allMatchIds.length === 0) {
        return {
          processed: 0,
          synchronized: 0,
          mismatched: 0,
          updated: 0,
          errors: 0,
          details: []
        };
      }
      
      // Batch process all matches
      const results = await this.batchDetectMismatchAndUpdate(allMatchIds, discordService);
      
      return results;
      
    } catch (error) {
      console.error(`❌ Error checking all INCOMING threads for mismatches: ${error.message}`);
      return {
        processed: 0,
        synchronized: 0,
        mismatched: 0,
        updated: 0,
        errors: 1,
        details: [{
          error: error.message,
          matchId: 'unknown',
          hadMismatch: null,
          updateTriggered: false
        }]
      };
    }
  }
}

module.exports = RsvpService;
