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
  }

  /**
   * Compare RSVP state between database and Discord message
   * @param {string} matchId - The match ID to check
   * @returns {Object} Comparison results
   */
  async compareRsvpStates(matchId) {
    try {
      console.log(`🔍 Starting RSVP state comparison for match ${matchId}`);

      // Get RSVP state from database
      const databaseRsvps = this.db.getRsvpForMatch(matchId);
      const threadId = this.db.matchThreads.get(matchId);

      if (!threadId) {
        throw new Error(`No thread found for match ${matchId}`);
      }

      const thread = await this.client.channels.fetch(threadId);
      if (!thread) {
        throw new Error(`Could not fetch thread ${threadId} for match ${matchId}`);
      }

      // Extract RSVP data from thread
      const displayedRsvps = await this.extractRsvpFromThread(thread);

      // Compare states
      const comparison = this.compareStates(databaseRsvps, displayedRsvps);

      console.log(`✅ RSVP state comparison completed for match ${matchId}`);
      return {
        matchId,
        threadId,
        databaseState: databaseRsvps,
        displayedState: displayedRsvps,
        comparison
      };

    } catch (error) {
      console.error(`❌ Error comparing RSVP states for match ${matchId}:`, error.message);
      throw error;
    }
  }

  /**
   * Extract RSVP data from Discord thread
   * @param {Object} thread - Discord thread
   * @returns {Object} RSVP data
   */
  async extractRsvpFromThread(thread) {
    const rsvpData = {
      attending: [],
      notAttending: [],
      noResponse: []
    };

    try {
      // Look for bot's RSVP message
      const messages = await thread.messages.fetch({ limit: 10 });
      const rsvpMessage = messages.find(msg =>
        msg.author.id === this.client.user.id &&
        msg.embeds.length > 0 &&
        msg.embeds[0].title &&
        msg.embeds[0].title.includes('RSVP Status')
      );

      if (!rsvpMessage) {
        return rsvpData; // No RSVP message found
      }

      const embed = rsvpMessage.embeds[0];
      const description = embed.description || '';

      // Parse RSVP section
      const rsvpSection = description.match(/\*\*Current RSVPs:\*\*\n([\s\S]*?)(?:\n\n|$)/);
      if (!rsvpSection) {
        return rsvpData;
      }

      const lines = rsvpSection[1].split('\n').filter(line => line.trim());

      for (const line of lines) {
        // Match attending pattern
        const attendingMatch = line.match(/✅.*?Attending.*?:\s*(.+)/i);
        if (attendingMatch) {
          rsvpData.attending = this.parseNamesList(attendingMatch[1]);
          continue;
        }

        // Match not attending pattern
        const notAttendingMatch = line.match(/❌.*?Not Attending.*?:\s*(.+)/i);
        if (notAttendingMatch) {
          rsvpData.notAttending = this.parseNamesList(notAttendingMatch[1]);
          continue;
        }

        // Match no response pattern
        const noResponseMatch = line.match(/⏳.*?No Response.*?:\s*(.+)/i);
        if (noResponseMatch) {
          rsvpData.noResponse = this.parseNamesList(noResponseMatch[1]);
          continue;
        }
      }

      return rsvpData;

    } catch (error) {
      console.error('Failed to extract RSVP from thread:', error);
      return rsvpData;
    }
  }

  /**
   * Parse comma-separated names list
   * @param {string} namesList - Raw names string
   * @returns {Array} Cleaned names array
   */
  parseNamesList(namesList) {
    return namesList
      .split(',')
      .map(name => name.trim().replace(/^\*\*|\*\*$/g, ''))
      .filter(name => name && name.length > 0);
  }


  /**
   * Compare database and displayed RSVP states
   * @param {Object} databaseRsvps - Database RSVP data
   * @param {Object} displayedRsvps - Discord RSVP data
   * @returns {Object} Comparison result
   */
  compareStates(databaseRsvps, displayedRsvps) {
    // Convert database RSVPs to same format
    const dbState = {
      attending: [],
      notAttending: [],
      noResponse: []
    };

    // Get all registered users
    const allUsers = Object.values(this.db.userMappings || {});

    // Categorize users by RSVP status
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

    // Sort for comparison
    const sortArrays = (obj) => {
      Object.keys(obj).forEach(key => {
        obj[key].sort();
      });
      return obj;
    };

    const sortedDbState = sortArrays({ ...dbState });
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
  async detectMismatchAndUpdate(matchId, discordService) {
    try {
      console.log(`🔍 Checking for RSVP mismatch for match ${matchId}`);
      
      // Compare current RSVP states
      const comparisonResult = await this.compareRsvpStates(matchId);

      // If already synchronized
      if (comparisonResult.comparison.isMatching) {
        console.log(`✅ RSVP states are synchronized for match ${matchId}`);
        return {
          matchId,
          hadMismatch: false,
          updateTriggered: false,
          message: 'RSVP states are already synchronized'
        };
      }

      console.log(`⚠️ RSVP mismatch detected for match ${matchId}`);

      // Log the detected differences
      const differences = comparisonResult.comparison.differences;
      console.log('Differences:', JSON.stringify(differences, null, 2));
      
      // Fetch the thread
      const threadId = comparisonResult.threadId;
      const thread = await this.client.channels.fetch(threadId);

      if (!thread) {
        throw new Error(`Could not fetch thread ${threadId}`);
      }

      // Update the thread
      await discordService.updateThreadRsvpStatus(matchId, thread);
      console.log(`✅ Successfully updated RSVP status for match ${matchId}`);
      
      return {
        matchId,
        hadMismatch: true,
        updateTriggered: true,
        message: 'RSVP mismatch detected and updated',
        comparisonResult,
        threadId,
        threadName: thread.name
      };
      
    } catch (error) {
      console.error(`❌ Error in detectMismatchAndUpdate for match ${matchId}: ${error.message}`);
      return {
        matchId,
        hadMismatch: null,
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
      errors: 0,
      details: []
    };
    
    for (const matchId of matchIds) {
      try {
        const result = await this.detectMismatchAndUpdate(matchId, discordService);
        
        results.processed++;
        results.details.push(result);
        
        if (result.error) {
          results.errors++;
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
