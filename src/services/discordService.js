const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { formatMatchTime } = require('../utils/helpers');
const config = require('../config/config');
const cache = require('./cache');
const RsvpService = require('./rsvpService');
const ThreadService = require('./threadService');
const MatchService = require('./matchService');
const embedService = require('./embedService');
const RescheduleHandler = require('../utils/rescheduleHandler');
const dataValidationService = require('../utils/dataValidationService');
const comprehensiveLogger = require('../utils/comprehensiveLogger');

class DiscordService {
  constructor(client, databaseService) {
    this.client = client;
    this.db = databaseService;
    
    // Initialize RSVP service for synchronization
    this.rsvpService = new RsvpService(databaseService, client);
    
    // Initialize reschedule handler
    this.rescheduleHandler = new RescheduleHandler(databaseService, this);
    
    // Initialize FACEIT service for data validation
    this.faceitService = require('./faceitService');
    
    // Optimized query cache to reduce redundant database operations
    this.queryCache = {
      matchThreads: new Map(), // Cache for match thread lookups
      sessionCache: new Map() // Per-session cache that lasts for one checkMatches cycle
    };
    
    // Use consistent TTL values across the service
    this.cacheTTL = {
      short: 5 * 60 * 1000,   // 5 minutes
      medium: 15 * 60 * 1000, // 15 minutes
      long: 30 * 60 * 1000    // 30 minutes
    };
  }
  
  /**
   * Refresh all RSVP statuses for INCOMING threads (force refresh without cache)
   * @param {boolean} silent - If true, don't log detailed progress
   * @returns {Object} Summary of refresh results
   */
  async refreshAllRsvpStatuses(silent = false) {
    try {
      if (!silent) {
        console.log('🔄 Starting RSVP status refresh for all INCOMING threads...');
      }
      
      // Force fresh RSVP comparisons
      
      // Use the RSVP service to check and update all threads
      const results = await this.rsvpService.checkAllIncomingThreadsForMismatches(this);
      
      if (!silent) {
        console.log('\n📊 RSVP Refresh Summary:');
        console.log(`   Threads processed: ${results.processed}`);
        console.log(`   Already synchronized: ${results.synchronized}`);
        console.log(`   Mismatched and updated: ${results.updated}`);
        console.log(`   Errors: ${results.errors}`);
        console.log('✅ RSVP status refresh completed');
      }
      
      return results;
      
    } catch (error) {
      console.error('❌ Error refreshing RSVP statuses:', error.message);
      return {
        processed: 0,
        synchronized: 0,
        mismatched: 0,
        updated: 0,
        errors: 1,
        details: [{ error: error.message }]
      };
    }
  }

  /**
   * Send notification for a match with RSVP buttons and create thread
   */
  async sendMatchNotification(match, channel = null) {
    try {
      if (!match || !match.teams || !match.teams.faction1 || !match.teams.faction2) {
        console.error('Invalid match data for notification');
        return;
      }
      
      // Use enhanced data validation for robust data comparison
      const freshMatch = await this.faceitService.getMatchDetails(match.match_id);
      const cachedMatch = this.db.upcomingMatches.get(match.match_id);
      
      const reconciliation = await dataValidationService.performDataReconciliation({
        freshData: freshMatch,
        existingData: cachedMatch,
        context: 'sendMatchNotification',
        matchId: match.match_id
      });
      
      if (reconciliation.action === 'skip') {
        // Log validation skip for notification
        comprehensiveLogger.logSkip('match_notification', match, {
          matchId: match.match_id,
          origin: comprehensiveLogger.origins.VALIDATION,
          reasoning: `Notification skipped: ${reconciliation.reason}`,
          context: {
            validationAction: reconciliation.action,
            confidence: reconciliation.confidence,
            notificationType: 'sendMatchNotification'
          },
          validationIssues: reconciliation.issues,
          existingState: cachedMatch
        });
        
        console.log(`📊 Skipping notification based on data validation: ${reconciliation.reason}`);
        if (reconciliation.issues.length > 0) {
          console.warn(`Issues detected: ${reconciliation.issues.join(', ')}`);
        }
        return;
      }
      
      // Use the validated data for notifications
      const validatedMatch = reconciliation.dataUsed || match;

      // Check if we already have ANY thread for this match (upcoming or finished) - use fresh query for new notifications
      const hasAnyExistingThread = await this.db.hasAnyMatchThread(match.match_id);
      if (hasAnyExistingThread) {
        console.log(`⚠️ Thread already exists for match ${match.match_id}, skipping notification to prevent duplicates`);
        return;
      }
      
      const faction1 = match.teams.faction1.name;
      const faction2 = match.teams.faction2.name;
      const matchTimes = formatMatchTime(match.scheduled_at);
      const matchUrl = `https://www.faceit.com/en/cs2/room/${match.match_id}`;
      
      // Store match data for RSVP purposes
      this.db.upcomingMatches.set(match.match_id, match);
      
      // Create a clean, simple RSVP chart
      const rsvpChart = this.createSimpleRsvpChart(match.match_id);
      
      const embed = new EmbedBuilder()
        .setTitle(`🎮 ${faction1} vs ${faction2}`)
        .setDescription(`🔗 **[Join Match Room](${matchUrl})**\n\n⏰ **Match Times:**\n${matchTimes.pacific}\n${matchTimes.mountain}\n\n📋 **Team RSVP Status:**\n${rsvpChart}`)
        .setColor(0x00ff00)
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
      const targetChannel = channel || this.client.channels.cache.get(config.discord.channelId);
      
      if (targetChannel) {
        // Send the main notification message to the channel
        const message = await targetChannel.send({
          content: "New match scheduled!",
          embeds: [embed],
          components: [rsvpRow, statusRow]
        });
        
        // Create a standalone thread in the channel (not attached to the message)
        const thread = await targetChannel.threads.create({
name: `INCOMING: ${matchTimes.mountain} - ${faction1} vs ${faction2}`,
          autoArchiveDuration: 60,
          type: 11, // GUILD_PUBLIC_THREAD
          reason: `Discussion thread for match: ${faction1} vs ${faction2}`
        });

        // Store thread reference for this match using the database service
        await this.db.addMatchThread(match.match_id, thread.id, 'upcoming');
        
        // Log thread creation event
        comprehensiveLogger.logThreadTransition(match.match_id, 'created', {
          origin: comprehensiveLogger.origins.DISCORD,
          reasoning: 'New upcoming match thread created for Discord notification',
          context: {
            threadType: 'upcoming',
            faction1: faction1,
            faction2: faction2,
            matchTime: matchTimes.mountain,
            notificationChannel: targetChannel.name
          },
          previousState: null,
          newState: 'upcoming_thread',
          threadId: thread.id,
          threadName: thread.name
        });
        
        // Invalidate cache since we just added a new thread
        this.invalidateMatchCache(match.match_id);
        
      // Cache invalidation for thread creation is handled by the unified cache
        
        // Send a simple RSVP status message to the thread
        await this.sendSimpleRsvpMessage(thread, match);

        console.log(`Thread created for match: ${thread.name}`);
        console.log('Notification sent successfully!');
        
        // Only mark as processed if this was an automatic notification
        if (!channel) {
          this.db.markMatchAsProcessed(match.match_id);
        }
      } else {
        console.error('Could not find target channel for notification');
      }
      
    } catch (err) {
      console.error(`Error sending notification: ${err.message}`);
    }
  }

  /**
   * Send a simple RSVP status message to the match thread
   */
  async sendSimpleRsvpMessage(thread, match) {
    try {
      const faction1 = match.teams.faction1.name;
      const faction2 = match.teams.faction2.name;
      const matchTimes = formatMatchTime(match.scheduled_at);
      const matchUrl = `https://www.faceit.com/en/cs2/room/${match.match_id}`;
      
      // Get current RSVP status
      const rsvpStatus = await this.createDynamicRsvpStatus(match.match_id);
      
      const rsvpEmbed = new EmbedBuilder()
        .setTitle(`📋 ${faction1} vs ${faction2} - RSVP Status`)
        .setDescription(`⏰ ${matchTimes.pacific}\n⏰ ${matchTimes.mountain}\n\n🔗 [Join Match Room](${matchUrl})\n\n**Current RSVPs:**\n${rsvpStatus}`)
        .setColor(0x1e88e5)
        .setTimestamp()
        .setFooter({ text: `Match ID: ${match.match_id}` });
      
      // Add RSVP buttons
      const rsvpRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`rsvp_yes_${match.match_id}`)
            .setLabel('✅ Attending')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`rsvp_no_${match.match_id}`)
            .setLabel('❌ Not Attending')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`rsvp_status_${match.match_id}`)
            .setLabel('📋 View RSVPs')
            .setStyle(ButtonStyle.Secondary)
        );
      
      await thread.send({ 
        embeds: [rsvpEmbed], 
        components: [rsvpRow]
      });
      
      console.log(`Simple RSVP message sent to thread for match ${match.match_id}`);
      
    } catch (err) {
      console.error(`Error sending simple RSVP message: ${err.message}`);
    }
  }

  /**
   * Update thread RSVP message with current status
   */
  async updateThreadRsvpStatus(matchId, thread = null) {
    try {
      console.log(`🔄 Updating RSVP status for match ${matchId}`);
      
      // Get match data - use cached version for faster updates
      const match = this.db.upcomingMatches.get(matchId);

      if (!thread) {
        const threadId = this.db.matchThreads.get(matchId);
        if (!threadId) {
          console.log(`No thread found for match ${matchId}`);
          return;
        }
        thread = await this.client.channels.fetch(threadId);
      }
      
      if (!thread) {
        console.error(`Could not fetch thread for match ${matchId}`);
        return;
      }
      
      // Check if we have match data, if not try to fetch fresh data
      if (!match) {
        console.log(`Match ${matchId} not found in upcomingMatches cache, attempting enhanced update with fresh API data`);
        
        // Fetch fresh match data from API to get current scheduled time
        let freshMatch = null;
        try {
          const faceitService = require('./faceitService');
          
          // Get fresh upcoming matches to find the current match data
          const upcomingMatches = await faceitService.getUpcomingMatches();
          freshMatch = upcomingMatches.find(m => m.match_id === matchId);
          
          if (freshMatch) {
            console.log(`🔄 Found fresh match data for ${matchId} with scheduled time: ${freshMatch.scheduled_at}`);
            // Store it in cache for future use
            this.db.upcomingMatches.set(matchId, freshMatch);
          }
        } catch (error) {
          console.error(`Error fetching fresh match data for ${matchId}:`, error.message);
        }
        
        // Try to update with existing message
        const messages = await thread.messages.fetch({ limit: 10 });
        const rsvpMessage = messages.find(msg => 
          msg.author.id === this.client.user.id && 
          msg.embeds.length > 0 && 
          msg.embeds[0].title && 
          msg.embeds[0].title.includes('RSVP Status')
        );
        
        if (rsvpMessage) {
          const existingEmbed = rsvpMessage.embeds[0];
          const existingTitle = existingEmbed.title;
          
          // Get updated RSVP status
          const rsvpStatus = await this.createDynamicRsvpStatus(matchId);
          
          let updatedDescription;
          
          if (freshMatch) {
            // Reconstruct the entire description with fresh match data
            const { formatMatchTime } = require('../utils/helpers');
            const matchTimes = formatMatchTime(freshMatch.scheduled_at);
            const matchUrl = `https://www.faceit.com/en/cs2/room/${matchId}`;
            
            updatedDescription = `⏰ ${matchTimes.pacific}\n⏰ ${matchTimes.mountain}\n\n🔗 [Join Match Room](${matchUrl})\n\n**Current RSVPs:**\n${rsvpStatus}`;
            
            // Update thread name if the match time has changed
            const faction1 = freshMatch.teams.faction1.name;
            const faction2 = freshMatch.teams.faction2.name;
            const newThreadName = `INCOMING: ${matchTimes.mountain} - ${faction1} vs ${faction2}`;
            
            if (thread.name !== newThreadName) {
              console.log(`🔄 Updating thread name from "${thread.name}" to "${newThreadName}"`);
              try {
                await thread.setName(newThreadName);
                console.log(`✅ Successfully updated thread name to reflect new match time`);
              } catch (nameError) {
                console.error(`❌ Failed to update thread name: ${nameError.message}`);
              }
            }
            
            console.log(`🕐 Updated thread with fresh match time: ${matchTimes.pacific}`);
          } else {
            // Fallback to updating just RSVP if we couldn't get fresh match data
            const existingDescription = existingEmbed.description;
            const descriptionParts = existingDescription.split('**Current RSVPs:**\n');
            if (descriptionParts.length === 2) {
              updatedDescription = descriptionParts[0] + '**Current RSVPs:**\n' + rsvpStatus;
            } else {
              updatedDescription = existingDescription + '\n\n**Current RSVPs:**\n' + rsvpStatus;
            }
            
            console.log(`⚠️ Updated thread with existing match time (couldn't fetch fresh data)`);
          }
          
          const updatedEmbed = new EmbedBuilder()
            .setTitle(existingTitle)
            .setDescription(updatedDescription)
            .setColor(existingEmbed.color || 0x1e88e5)
            .setTimestamp()
            .setFooter({ text: `Match ID: ${matchId}` });
          
          // Create updated button row
          const rsvpRow = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(`rsvp_yes_${matchId}`)
                .setLabel('✅ Attending')
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId(`rsvp_no_${matchId}`)
                .setLabel('❌ Not Attending')
                .setStyle(ButtonStyle.Danger),
              new ButtonBuilder()
                .setCustomId(`rsvp_status_${matchId}`)
                .setLabel('📋 View RSVPs')
                .setStyle(ButtonStyle.Secondary)
            );
          
          await rsvpMessage.edit({ 
            embeds: [updatedEmbed], 
            components: [rsvpRow]
          });
          console.log(`Updated RSVP message with ${freshMatch ? 'fresh' : 'simplified'} status for match ${matchId}`);
        } else {
          console.log(`RSVP message not found for match ${matchId}, creating new RSVP Status message`);
          // Create a new RSVP Status message since it doesn't exist
          if (freshMatch) {
            await this.sendSimpleRsvpMessage(thread, freshMatch);
          } else {
            await this.sendSimpleRsvpMessage(thread, { match_id: matchId });
          }
        }
        return;
      }
      
      const faction1 = match.teams.faction1.name;
      const faction2 = match.teams.faction2.name;
      const matchTimes = formatMatchTime(match.scheduled_at);
      const matchUrl = `https://www.faceit.com/en/cs2/room/${match.match_id}`;
      
      // Get updated RSVP status
      const rsvpStatus = await this.createDynamicRsvpStatus(matchId);
      
      // Create updated RSVP embed
      const rsvpEmbed = new EmbedBuilder()
        .setTitle(`📋 ${faction1} vs ${faction2} - RSVP Status`)
        .setDescription(`⏰ ${matchTimes.pacific}\n⏰ ${matchTimes.mountain}\n\n🔗 [Join Match Room](${matchUrl})\n\n**Current RSVPs:**\n${rsvpStatus}`)
        .setColor(0x1e88e5)
        .setTimestamp()
        .setFooter({ text: `Match ID: ${match.match_id}` });
      
      // Create updated button row
      const rsvpRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`rsvp_yes_${match.match_id}`)
            .setLabel('✅ Attending')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`rsvp_no_${match.match_id}`)
            .setLabel('❌ Not Attending')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`rsvp_status_${match.match_id}`)
            .setLabel('📋 View RSVPs')
            .setStyle(ButtonStyle.Secondary)
        );
      
      // Find the RSVP message in the thread (should be the first bot message)
      const messages = await thread.messages.fetch({ limit: 10 });
      const rsvpMessage = messages.find(msg => 
        msg.author.id === this.client.user.id && 
        msg.embeds.length > 0 && 
        msg.embeds[0].title && 
        msg.embeds[0].title.includes('RSVP Status')
      );
      
      if (rsvpMessage) {
        await rsvpMessage.edit({ 
          embeds: [rsvpEmbed], 
          components: [rsvpRow]
        });
        console.log(`Updated RSVP message with status for match ${matchId}`);
      } else {
        console.log(`RSVP message not found for match ${matchId}, creating new one`);
        // Create new RSVP Status message since it doesn't exist
        await thread.send({ 
          embeds: [rsvpEmbed], 
          components: [rsvpRow]
        });
        console.log(`Created new RSVP message for match ${matchId}`);
      }
      
    } catch (err) {
      console.error(`Error updating thread RSVP status: ${err.message}`);
    }
  }

  /**
   * Create a finished match thread with detailed match summary
   */
  async createFinishedMatchThread(match, channel = null) {
    try {
      if (!match || !match.teams || !match.teams.faction1 || !match.teams.faction2) {
        console.error('Invalid finished match data');
        return;
      }

      // CRITICAL: Always use fresh database query, not cached version, to prevent duplicates
      console.log(`🔍 Checking for existing finished match thread: ${match.match_id}`);
      const hasFinishedThread = await this.db.hasFinishedMatchThread(match.match_id);
      if (hasFinishedThread) {
        console.log(`⚠️ FINISHED thread already exists for match ${match.match_id}, skipping creation`);
        return;
      }
      
      // Also check for any thread type (upcoming -> finished transition case)
      const hasAnyThread = await this.db.hasAnyMatchThread(match.match_id);
      if (hasAnyThread) {
        // Check if it's an upcoming thread that needs to be converted to finished
        const hasUpcomingThread = await this.db.hasUpcomingMatchThread(match.match_id);
        if (hasUpcomingThread) {
          console.log(`🔄 Converting existing INCOMING thread to RESULT thread for match ${match.match_id}`);
          return await this.convertIncomingToResultThread(match);
        } else {
          console.log(`⚠️ Non-upcoming thread already exists for match ${match.match_id}, skipping finished thread creation`);
          return;
        }
      }
      
      // CRITICAL: Search Discord directly for existing threads with this match ID
      // This prevents duplicates when database references are stale but threads still exist
      console.log(`🔍 Searching Discord for existing threads with match ID: ${match.match_id}`);
      const existingDiscordThread = await this.findMatchThreadInDiscord(match.match_id);
      if (existingDiscordThread) {
        console.log(`⚠️ Found existing Discord thread for match ${match.match_id}: "${existingDiscordThread.name}"`);
        
        // If it's a RESULT thread, restore the database reference and skip creation
        if (existingDiscordThread.name.includes('RESULT:')) {
          console.log(`📊 [SAFE RESTORATION] Restoring database reference for existing Discord thread`);
          console.log(`   - Match: ${match.match_id}`);
          console.log(`   - Thread: ${existingDiscordThread.id} ("${existingDiscordThread.name}")`);
          console.log(`   - Reason: Thread exists in Discord but missing from database`);
          console.log(`   - Action: Adding database reference, no Discord thread creation needed`);
          
          await this.db.addMatchThread(match.match_id, existingDiscordThread.id, 'finished');
          console.log(`✅ [SAFE RESTORATION] Successfully restored thread reference`);
          return existingDiscordThread;
        } else {
          console.log(`📊 [UNNECESSARY CORRECTION AVOIDED] Found non-RESULT thread for match ${match.match_id}`);
          console.log(`   - Thread name: "${existingDiscordThread.name}"`);
          console.log(`   - Reason: Thread exists but is not a finished match thread`);
          console.log(`   - Action: Skipping creation to prevent confusion/duplicates`);
          return;
        }
      }

      // Save finished match data to database before creating thread
      // This ensures the match data with finished_at timestamp is available for thread locking logic
      try {
        // Determine winner and result for database storage
        const winner = this.determineMatchWinner(match);
        const result = this.formatMatchResult(match);
        
        // First, add or update the basic match info
        await this.db.db.addOrUpdateMatch({
          match_id: match.match_id,
          teams: match.teams,
          scheduled_at: match.scheduled_at,
          competition_name: match.competition_name || 'FACEIT Match',
          status: 'FINISHED'
        });
        
        // Then update with finished match results
        await this.db.db.updateMatchResult(
          match.match_id,
          result,
          winner,
          match.finished_at
        );
        
        console.log(`✅ Saved finished match data to database: ${match.match_id}`);
      } catch (dbErr) {
        console.error(`❌ Error saving finished match data to database: ${dbErr.message}`);
        // Continue with thread creation even if database save fails
      }

      const faction1 = match.teams.faction1.name;
      const faction2 = match.teams.faction2.name;
      const matchUrl = `https://www.faceit.com/en/cs2/room/${match.match_id}`;
      
      // Determine winner and result
      const winner = this.determineMatchWinner(match);
      const result = this.formatMatchResult(match);
      const matchDate = match.finished_at ? new Date(match.finished_at * 1000).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Los_Angeles'
      }) : 'Unknown';
      
      // Short date for thread title
      const shortDate = match.finished_at ? new Date(match.finished_at * 1000).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'America/Los_Angeles'
      }) : 'Unknown';

      // Get target channel
      const targetChannel = channel || this.client.channels.cache.get(config.discord.channelId);
      
      if (!targetChannel) {
        console.error('Could not find target channel for finished match thread');
        return;
      }

      // Create thread for the finished match
const threadName = `RESULT: ${shortDate} - ${faction1} vs ${faction2}`;
      const thread = await targetChannel.threads.create({
        name: threadName,
        autoArchiveDuration: 10080, // 7 days
        type: 11, // GUILD_PUBLIC_THREAD
        reason: `Result thread for finished match: ${faction1} vs ${faction2}`
      });

      // Store thread reference using the database service FIRST with enhanced logging
      console.log(`💾 Saving finished match thread to database: ${match.match_id} -> ${thread.id}`);
      await this.db.addMatchThread(match.match_id, thread.id, 'finished');
      
      // Invalidate cache since we just added a new thread
      this.invalidateMatchCache(match.match_id);
      
    // Cache invalidation for match finish is handled by the unified cache
      
      // Verify the thread was actually saved with enhanced verification
      const savedThread = await this.db.hasFinishedMatchThread(match.match_id);
      if (!savedThread) {
        console.error(`❌ CRITICAL: Failed to save finished match thread for ${match.match_id}`);
        console.error(`Thread ID: ${thread.id}, Thread Name: ${threadName}`);
        // Clean up the created thread since we couldn't save it
        try {
          await thread.delete('Failed to save thread reference to database');
          console.log(`🗑️ Cleaned up unsaved thread: ${threadName}`);
        } catch (deleteErr) {
          console.error(`Failed to cleanup unsaved thread: ${deleteErr.message}`);
        }
        return;
      }
      console.log(`✅ Successfully saved finished match thread for ${match.match_id}: ${thread.id}`);
      
      // Also verify it's in memory cache
      const memoryThreadId = this.db.matchThreads.get(match.match_id);
      if (memoryThreadId !== thread.id) {
        console.warn(`⚠️ Memory cache mismatch for match ${match.match_id}: expected ${thread.id}, got ${memoryThreadId}`);
      }
      
      // Create detailed match summary embed
      const summaryEmbed = this.createMatchSummaryEmbed(match, winner, result, matchDate);
      
      // Send the match summary to the thread
      await thread.send({ embeds: [summaryEmbed] });
      
      // Get team performance data if available
      const performanceData = await this.getMatchPerformanceData(match);
      if (performanceData) {
        const performanceEmbed = this.createPerformanceEmbed(match, performanceData);
        await thread.send({ embeds: [performanceEmbed] });
      }

      console.log(`Finished match thread created: ${threadName}`);
      return thread;
      
    } catch (err) {
      console.error(`Error creating finished match thread: ${err.message}`);
    }
  }

  /**
   * Create detailed match summary embed
   */
  createMatchSummaryEmbed(match, winner, result, matchDate) {
    const faction1 = match.teams.faction1.name;
    const faction2 = match.teams.faction2.name;
    const matchUrl = `https://www.faceit.com/en/cs2/room/${match.match_id}`;
    
    // Debug logging
    console.log(`\n=== MATCH RESULT DEBUG ===`);
    console.log(`Match ID: ${match.match_id}`);
    console.log(`Teams: ${faction1} vs ${faction2}`);
    console.log(`Winner: ${winner}`);
    console.log(`Our Team ID: ${config.faceit.teamId}`);
    console.log(`Faction1 ID: ${match.teams.faction1.faction_id}`);
    console.log(`Faction2 ID: ${match.teams.faction2.faction_id}`);
    
    // Determine if a team is ours by checking if it matches our team ID
    const isOurTeam = (team) => {
      if (!team || !team.faction_id) return false;
      const result = team.faction_id === config.faceit.teamId;
      console.log(`Team ${team.name} (${team.faction_id}) is our team: ${result}`);
      return result;
    };
    
    // Check which team is ours
    const isOurTeam1 = isOurTeam(match.teams.faction1);
    const isOurTeam2 = isOurTeam(match.teams.faction2);
    
    // Determine if we won or lost
    let resultColor = 0x808080; // Default gray
    let resultIcon = '⚪';
    
    if (winner) {
      // Check if the winner is our team by comparing with team objects
      const isWinnerOurTeam = (isOurTeam1 && winner === faction1) || 
                               (isOurTeam2 && winner === faction2);
      
      console.log(`Is winner our team: ${isWinnerOurTeam}`);
      
      if (isWinnerOurTeam) {
        resultColor = 0x00ff00; // Green for win
        resultIcon = '🏆';
        console.log(`🏆 WE WON! Setting green color`);
      } else {
        resultColor = 0xff0000; // Red for loss
        resultIcon = '💔';
        console.log(`💔 We lost. Setting red color`);
      }
    } else {
      console.log(`⚪ No winner determined. Using gray color`);
    }
    console.log(`========================\n`);
    
    const embed = new EmbedBuilder()
      .setTitle(`${resultIcon} ${faction1} vs ${faction2} - Match Complete`)
      .setDescription(`🔗 **[View Match Details](${matchUrl})**\n\n📅 **Match Date:** ${matchDate}\n🏟️ **Competition:** ${match.competition_name || 'FACEIT Match'}\n\n**📊 Final Result:**\n${result}`)
      .setColor(resultColor)
      .setTimestamp()
      .setFooter({ text: `Match ID: ${match.match_id}` });
    
    // Add winner field if we have one
    if (winner) {
      embed.addFields({
        name: '🎉 Winner',
        value: `**${winner}**`,
        inline: true
      });
    }
    
    // Add match duration if available
    if (match.started_at && match.finished_at) {
      const durationMs = (match.finished_at - match.started_at) * 1000;
      const durationMinutes = Math.round(durationMs / (1000 * 60));
      embed.addFields({
        name: '⏱️ Match Duration',
        value: `${durationMinutes} minutes`,
        inline: true
      });
    }
    
    return embed;
  }

  /**
   * Determine match winner from match data
   */
  determineMatchWinner(match) {
    // First try to get winner from results.winner field
    if (match.results && match.results.winner) {
      const winnerId = match.results.winner;
      
      if (match.teams.faction1.faction_id === winnerId) {
        return match.teams.faction1.name;
      } else if (match.teams.faction2.faction_id === winnerId) {
        return match.teams.faction2.name;
      }
    }
    
    // If no winner field, determine from score
    if (match.results && match.results.score) {
      const score = match.results.score;
      const faction1Score = parseInt(score.faction1 || 0);
      const faction2Score = parseInt(score.faction2 || 0);
      
      console.log(`Determining winner from scores: ${match.teams.faction1.name} ${faction1Score} - ${faction2Score} ${match.teams.faction2.name}`);
      
      if (faction1Score > faction2Score) {
        console.log(`Winner determined from score: ${match.teams.faction1.name}`);
        return match.teams.faction1.name;
      } else if (faction2Score > faction1Score) {
        console.log(`Winner determined from score: ${match.teams.faction2.name}`);
        return match.teams.faction2.name;
      }
      // If scores are equal, it's a tie - no winner
    }
    
    console.log('Could not determine winner from results.winner or scores');
    return null;
  }

  /**
   * Format match result string
   */
  formatMatchResult(match) {
    if (!match.results) {
      return '📋 Result details not available';
    }
    
    const score = match.results.score || {};
    const faction1Score = score.faction1 || 0;
    const faction2Score = score.faction2 || 0;
    
    return `**${match.teams.faction1.name}** ${faction1Score} - ${faction2Score} **${match.teams.faction2.name}**`;
  }

  /**
   * Get match performance data (if available from FACEIT API)
   */
  async getMatchPerformanceData(match) {
    try {
      // This would require additional FACEIT API calls to get detailed stats
      // For now, return null - can be expanded later with detailed player stats
      return null;
    } catch (err) {
      console.error(`Error getting match performance data: ${err.message}`);
      return null;
    }
  }

  /**
   * Create performance embed (placeholder for future enhancement)
   */
  createPerformanceEmbed(match, performanceData) {
    return new EmbedBuilder()
      .setTitle('📈 Team Performance')
      .setDescription('Detailed performance statistics coming soon!')
      .setColor(0x1e88e5)
      .setTimestamp();
  }

  /**
   * Async wrapper for thread updates
   */
  updateThreadRsvpStatusAsync(matchId) {
    // Update thread status immediately without artificial delay
    this.updateThreadRsvpStatus(matchId).catch(error => {
      console.error(`Error updating thread RSVP status for ${matchId}:`, error.message);
    });
  }


  /**
   * Reconcile existing Discord threads with the database
   */
  async reconcileExistingThreads() {
    try {
console.log(`🔄 Starting reconciliation of existing threads with conservative approach...`);
      
      const channel = this.client.channels.cache.get(config.discord.channelId);
      if (!channel || !channel.threads) {
        console.error('Could not access channel threads to reconcile');
        return;
      }
      
      // Fetch active threads
      const activeThreads = await channel.threads.fetchActive();
      
      // Fetch ALL archived threads (with pagination)
      const allArchivedThreads = new Map();
      let hasMoreArchived = true;
      let archivedBefore = null;
      
      while (hasMoreArchived) {
        const archivedBatch = await channel.threads.fetchArchived({ before: archivedBefore });
        
        // Add this batch to our collection
        archivedBatch.threads.forEach((thread, id) => {
          allArchivedThreads.set(id, thread);
        });
        
        // Check if there are more archived threads to fetch
        hasMoreArchived = archivedBatch.hasMore;
        if (hasMoreArchived && archivedBatch.threads.size > 0) {
          // Set the 'before' parameter to the last thread ID for pagination
          const lastThread = Array.from(archivedBatch.threads.values()).pop();
          archivedBefore = lastThread.id;
        }
      }
      
      const allThreads = [...activeThreads.threads.values(), ...allArchivedThreads.values()];
      console.log(`📋 Found ${activeThreads.threads.size} active and ${allArchivedThreads.size} archived threads`);
      
      let reconciledCount = 0;
      let joinedCount = 0;
      const foundMatchIds = new Set();
      
      for (const thread of allThreads) {
        // Check if thread is match-related based on name pattern
        if (this.isMatchThread(thread.name)) {
          const matchId = await this.extractMatchIdFromThread(thread);
          if (matchId) {
            console.log(`Found match thread: ${thread.name} -> Match ID: ${matchId}`);
            foundMatchIds.add(matchId);
            
            // Check if bot is a member of this thread
            const isMember = await this.checkThreadMembership(thread);
            if (!isMember) {
              console.log(`🤝 Bot is not a member of thread ${thread.name}, joining...`);
              const joined = await this.joinThread(thread);
              if (joined) {
                joinedCount++;
                console.log(`✅ Successfully joined thread: ${thread.name}`);
              }
            } else {
              console.log(`✅ Bot is already a member of thread: ${thread.name}`);
            }
            
            // Check if this thread is already tracked in database (any type)
            const hasAnyThreadInDB = await this.db.hasAnyMatchThread(matchId);
            
      if (!hasAnyThreadInDB) {
        console.log(`📊 [SAFE RESTORATION] Restoring missing thread reference: ${matchId} -> ${thread.id}`);
        console.log(`   - Thread name: "${thread.name}"`);
        console.log(`   - Reason: Thread exists in Discord but missing from database`);
        console.log(`   - Action: Adding database reference without modifying Discord thread`);
        
        // Determine thread type based on name
        const threadType = thread.name.startsWith('RESULT:') ? 'finished' : 'upcoming';
        await this.db.addMatchThread(matchId, thread.id, threadType);
        reconciledCount++;
      } else {
        console.log(`ℹ️ [NO ACTION NEEDED] Thread already tracked for match ID: ${matchId}`);
      }
          } else {
            console.warn(`⚠️ Could not extract match ID from thread: ${thread.name}`);
          }
        }
      }
      
      // Clean up stale database references (threads that no longer exist in Discord)
      console.log('🔍 Cleaning up stale database thread references...');
      const dbThreads = await this.db.db.getAllMatchThreads();
      let staleCount = 0;
      
      for (const dbThread of dbThreads) {
        if (!foundMatchIds.has(dbThread.match_id)) {
          console.log(`📊 [SAFE CORRECTION] Removing stale database reference: ${dbThread.match_id} -> ${dbThread.thread_id}`);
          console.log(`   - Reason: Database references thread that no longer exists in Discord`);
          console.log(`   - Action: Cleaning up orphaned database entry`);
          console.log(`   - Impact: Database consistency improved, no Discord changes`);
          
          await this.db.removeMatchThread(dbThread.match_id);
          // Invalidate cache since we removed a thread reference
          this.invalidateMatchCache(dbThread.match_id);
          staleCount++;
        }
      }
      
      console.log(`✅ Thread reconciliation complete - restored ${reconciledCount} thread references, joined ${joinedCount} threads, cleaned ${staleCount} stale references`);

    } catch (err) {
      console.error(`Error during thread reconciliation: ${err.message}`);
    }
  }

  /**
   * Check if the bot is a member of a thread
   */
  async checkThreadMembership(thread) {
    try {
      // Check if the bot is in the thread's member list
      const members = await thread.members.fetch();
      return members.has(this.client.user.id);
    } catch (err) {
      console.error(`Error checking thread membership for ${thread.name}: ${err.message}`);
      return false;
    }
  }

  /**
   * Join a thread as the bot
   */
  async joinThread(thread) {
    try {
      // Check if thread is archived or locked
      if (thread.archived) {
        console.log(`Thread ${thread.name} is archived, cannot join`);
        return false;
      }
      
      if (thread.locked) {
        console.log(`Thread ${thread.name} is locked, cannot join`);
        return false;
      }
      
      // Join the thread
      await thread.join();
      
      // Small delay to ensure membership is registered
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Verify we actually joined
      const isNowMember = await this.checkThreadMembership(thread);
      if (isNowMember) {
        console.log(`✅ Successfully joined and verified membership in: ${thread.name}`);
        return true;
      } else {
        console.warn(`⚠️ Joined thread but membership verification failed: ${thread.name}`);
        return false;
      }
      
    } catch (err) {
      console.error(`Error joining thread ${thread.name}: ${err.message}`);
      return false;
    }
  }

  /**
   * Check if a thread name indicates it's a match thread
   */
  isMatchThread(threadName) {
    return threadName.startsWith('INCOMING:') || threadName.startsWith('RESULT:');
  }

  /**
   * Extract match ID from thread messages (look for Match ID in footer or embeds)
   */
  async extractMatchIdFromThread(thread) {
    try {
      // Fetch the first few messages from the thread
      const messages = await thread.messages.fetch({ limit: 5 });
      
      for (const message of messages.values()) {
        // Look for Match ID in embed footer or description
        if (message.embeds && message.embeds.length > 0) {
          const embed = message.embeds[0];
          
          // Check footer for Match ID
          if (embed.footer && embed.footer.text && embed.footer.text.includes('Match ID:')) {
            const matchId = embed.footer.text.replace('Match ID: ', '').trim();
            if (matchId) {
              return matchId;
            }
          }
          
          // Check description for Match ID pattern
          if (embed.description) {
            const matchIdMatch = embed.description.match(/Match ID: ([a-f0-9-]+)/i);
            if (matchIdMatch) {
              return matchIdMatch[1];
            }
          }
        }
        
        // Also check message content for Match ID
        if (message.content && message.content.includes('Match ID:')) {
          const matchIdMatch = message.content.match(/Match ID: ([a-f0-9-]+)/i);
          if (matchIdMatch) {
            return matchIdMatch[1];
          }
        }
      }
      
      return null;
    } catch (err) {
      console.error(`Error extracting match ID from thread ${thread.name}: ${err.message}`);
      return null;
    }
  }

  /**
   * Check for new matches and send notifications, also check for finished matches
   */
  async checkMatches(faceitService) {
    try {
      console.log('🔄 Checking for new matches and finished matches...');
      
      // Reset session cache at the start of each check cycle
      this.resetSessionCache();
      
      // Reconcile existing threads with database (especially important after backup restoration)
      await this.reconcileExistingThreads();
      
      // Periodically clean up stale thread references (every 10th check)
      if (!this.lastCleanupCheck) this.lastCleanupCheck = 0;
      this.lastCleanupCheck++;
      if (this.lastCleanupCheck >= 10) {
        await this.cleanupStaleThreads();
        this.lastCleanupCheck = 0;
      }
      
      // Check for upcoming matches
      const matches = await faceitService.getUpcomingMatches();
      console.log(`Found ${matches.length} upcoming matches`);
      
      // Track all matches we should have threads for
      const allMatchesRequiringThreads = [];
      
      if (matches.length > 0) {
        for (const match of matches) {
          allMatchesRequiringThreads.push({ match, type: 'upcoming' });
          
          // Check for reschedule first (for processed matches)
          const rescheduleInfo = await this.rescheduleHandler.detectReschedule(match);
          if (rescheduleInfo.isRescheduled) {
            console.log(`🔄 Match reschedule detected for ${match.match_id}`);
            await this.rescheduleHandler.handleReschedule(match, rescheduleInfo);
          } else if (!this.db.isMatchProcessed(match.match_id)) {
            console.log(`New match found: ${match.match_id}`);
            await this.sendMatchNotification(match);
          }
          
          // Always update upcomingMatches cache with current match data after processing
          // This ensures we store the latest data for comparison in the next check cycle
          this.db.upcomingMatches.set(match.match_id, match);
        }
      } else {
        console.log('No upcoming matches found.');
      }

      // Before checking finished matches, detect potential thread conversions
      console.log('🚨 DEBUG: About to call checkForPotentialThreadConversions at', new Date().toISOString());
      await this.checkForPotentialThreadConversions();
      console.log('🚨 DEBUG: checkForPotentialThreadConversions completed at', new Date().toISOString());
      
      // Check for finished matches and create result threads
      console.log('🏁 Checking for finished matches...');
      const finishedMatches = await faceitService.getFinishedMatches(10);
      console.log(`Found ${finishedMatches.length} recent finished matches`);

      if (finishedMatches.length > 0) {
        // Clean up any stale finished match thread references before checking
        await this.cleanupStaleFinishedMatchThreads();

        let createdThreads = 0;

        for (const match of finishedMatches) {
          try {
            allMatchesRequiringThreads.push({ match, type: 'finished' });

          // Check if we already have a finished match thread for this match (ALWAYS use fresh DB query)
            const hasThread = await this.db.hasFinishedMatchThread(match.match_id);

            if (!hasThread) {
              console.log(`Creating finished match thread for: ${match.match_id}`);
              const thread = await this.createFinishedMatchThread(match);
              if (thread) {
                createdThreads++;
              }

              // Small delay to avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          } catch (matchErr) {
            console.error(`Error processing finished match ${match.match_id}: ${matchErr.message}`);
          }
        }

        if (createdThreads > 0) {
          console.log(`✅ Created ${createdThreads} new finished match threads`);
        } else {
          console.log('No new finished match threads needed');
        }
      }

      // Check all active INCOMING threads for RSVP mismatch and correct
      console.log('🔄 Synchronizing RSVP status for all INCOMING threads...');
      const rsvpSyncResults = await this.rsvpService.checkAllIncomingThreadsForMismatches(this);
      console.log(`Processed ${rsvpSyncResults.processed} matches, updated ${rsvpSyncResults.updated} mismatched RSVPs`);
      
      // Check all current matches to ensure they have proper threads
      console.log('🔍 Verifying all matches have proper threads...');
      await this.ensureAllMatchThreadsExist(allMatchesRequiringThreads);
      
      // Check for finished match threads that need to be locked (72+ hours old)
      // Pass the finished matches data to avoid duplicate API calls
      await this.lockOldFinishedMatchThreads(faceitService, finishedMatches);
      
      console.log('✅ Match check completed');
      
      // Clear session cache after each check cycle to ensure fresh data next time
      this.clearSessionCache();
      
    } catch (err) {
      console.error(`Error during match check: ${err.message}`);
      // Clear session cache on error too
      this.clearSessionCache();
    }
  }

  /**
   * Send a welcome message to the match thread with match details and instructions
   */
  async sendThreadWelcomeMessage(thread, match) {
    try {
      const faction1 = match.teams.faction1.name;
      const faction2 = match.teams.faction2.name;
      const matchTimes = formatMatchTime(match.scheduled_at);
      const matchUrl = `https://www.faceit.com/en/cs2/room/${match.match_id}`;
      
      // Get current RSVP status for dynamic display
      const rsvpStatus = await this.createDynamicRsvpStatus(match.match_id);
      
      const welcomeEmbed = new EmbedBuilder()
        .setTitle(`🎯 ${faction1} vs ${faction2} - Match Thread`)
        .setDescription('Welcome to the official discussion thread for this match!')
        .setColor(0x1e88e5)
        .addFields(
          {
            name: '🕐 Match Time',
            value: `${matchTimes.pacific}\n${matchTimes.mountain}`,
            inline: true
          },
          {
            name: '🏆 Competition',
            value: match.competition_name || 'ESEA Season',
            inline: true
          },
          {
            name: '🔗 Match Room',
            value: `[Join Match Room](${matchUrl})`,
            inline: true
          },
          {
            name: '📝 RSVP Status',
            value: rsvpStatus,
            inline: false
          }
        )
        .setTimestamp()
        .setFooter({ text: `Match ID: ${match.match_id}` });
      
      // Add RSVP reminder buttons in the thread
      const rsvpReminderRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`rsvp_yes_${match.match_id}`)
            .setLabel('✅ I\'m Attending')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`rsvp_no_${match.match_id}`)
            .setLabel('❌ Can\'t Attend')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`rsvp_status_${match.match_id}`)
            .setLabel('📋 Check Status')
            .setStyle(ButtonStyle.Secondary)
        );
      
      await thread.send({ 
        embeds: [welcomeEmbed], 
        components: [rsvpReminderRow]
      });
      
      console.log(`Welcome message sent to thread for match ${match.match_id}`);
      
    } catch (err) {
      console.error(`Error sending thread welcome message: ${err.message}`);
    }
  }

  /**
   * Get a thread by ID
   */
  async getThread(threadId) {
    try {
      const thread = await this.client.channels.fetch(threadId);
      return thread;
    } catch (err) {
      console.error(`Error fetching thread ${threadId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Validate if a thread still exists and is accessible
   * Enhanced version for startup reconciliation with detailed logging
   */
  async validateThread(matchId, threadId) {
    try {
      console.log(`🔍 [VALIDATION] Validating thread ${threadId} for match ${matchId}`);
      
      const thread = await this.client.channels.fetch(threadId);
      
      if (!thread) {
        console.log(`❌ [VALIDATION] Thread ${threadId} not found`);
        return { isValid: false, reason: 'Thread not found', shouldRemove: true };
      }
      
      // Check thread accessibility and state
      if (thread.archived) {
        console.log(`⚠️ [VALIDATION] Thread ${threadId} is archived but accessible`);
        return { isValid: false, reason: 'Thread is archived', shouldRemove: false };
      }
      
      if (thread.locked) {
        console.log(`🔒 [VALIDATION] Thread ${threadId} is locked but accessible`);
        return { isValid: true, reason: 'Thread is locked but valid', shouldRemove: false };
      }
      
      // Validate that the thread actually belongs to this match
      const extractedMatchId = await this.extractMatchIdFromThread(thread);
      if (extractedMatchId && extractedMatchId !== matchId) {
        console.log(`❌ [VALIDATION] Thread ${threadId} belongs to different match: ${extractedMatchId} vs ${matchId}`);
        return { isValid: false, reason: 'Thread belongs to different match', shouldRemove: true };
      }
      
      // Check if it's actually a match thread
      if (!this.isMatchThread(thread.name)) {
        console.log(`❌ [VALIDATION] Thread ${threadId} is not a match thread: "${thread.name}"`);
        return { isValid: false, reason: 'Not a match thread', shouldRemove: true };
      }
      
      console.log(`✅ [VALIDATION] Thread ${threadId} is valid and accessible`);
      return { isValid: true, reason: 'Thread is valid and accessible', shouldRemove: false };
      
    } catch (err) {
      console.log(`❌ [VALIDATION] Thread ${threadId} validation failed: ${err.message}`);
      return { isValid: false, reason: `Validation error: ${err.message}`, shouldRemove: true };
    }
  }

  /**
   * Comprehensive cleanup of stale thread references and related data
   * Enhanced to validate all threads and clean up orphaned database entries
   */
  async cleanupStaleThreads() {
    try {
      console.log('🧹 Starting comprehensive thread cleanup and validation...');
      
      const cleanupResults = {
        memoryStaleThreads: 0,
        databaseStaleThreads: 0,
        orphanedMatches: 0,
        orphanedRsvps: 0,
        validatedThreads: 0,
        errors: []
      };
      
      // Phase 1: Validate memory cache threads
      console.log('📋 Phase 1: Validating memory cache thread references...');
      const memoryStaleThreads = [];
      
      for (const [matchId, threadId] of this.db.matchThreads.entries()) {
        try {
          const validationResult = await this.validateThread(matchId, threadId);
          if (!validationResult.isValid && validationResult.shouldRemove) {
            memoryStaleThreads.push({ matchId, threadId, reason: validationResult.reason });
          } else {
            cleanupResults.validatedThreads++;
            console.log(`✅ Validated thread: ${matchId} -> ${threadId}`);
          }
        } catch (validationErr) {
          console.error(`Error validating thread ${threadId} for match ${matchId}: ${validationErr.message}`);
          cleanupResults.errors.push(`Validation error for ${matchId}: ${validationErr.message}`);
        }
      }
      
      // Remove stale threads from memory and database
      for (const { matchId, threadId, reason } of memoryStaleThreads) {
        console.log(`🗑️ Removing stale thread reference: ${threadId} for match ${matchId} (${reason})`);
        this.db.matchThreads.delete(matchId);
        await this.db.removeMatchThread(matchId);
        cleanupResults.memoryStaleThreads++;
      }
      
      // Phase 2: Check database for orphaned thread references not in memory
      console.log('📋 Phase 2: Checking database for orphaned thread references...');
      const allDbThreads = await this.db.db.getAllMatchThreads();
      const memoryMatchIds = new Set(this.db.matchThreads.keys());
      
      for (const dbThread of allDbThreads) {
        if (!memoryMatchIds.has(dbThread.match_id)) {
          console.log(`🔍 Found database thread not in memory: ${dbThread.match_id} -> ${dbThread.thread_id}`);
          
          // Try to validate this thread directly
          try {
            const thread = await this.client.channels.fetch(dbThread.thread_id).catch(() => null);
            if (!thread) {
              console.log(`🗑️ Removing orphaned database thread reference: ${dbThread.match_id} -> ${dbThread.thread_id}`);
              await this.db.removeMatchThread(dbThread.match_id);
              cleanupResults.databaseStaleThreads++;
            } else {
              // Thread exists in Discord but not in memory - restore to memory
              console.log(`🔄 Restoring valid thread to memory cache: ${dbThread.match_id} -> ${dbThread.thread_id}`);
              this.db.matchThreads.set(dbThread.match_id, dbThread.thread_id);
              cleanupResults.validatedThreads++;
            }
          } catch (checkErr) {
            console.error(`Error checking orphaned thread ${dbThread.thread_id}: ${checkErr.message}`);
            // If we can't validate it, assume it's stale and remove it
            await this.db.removeMatchThread(dbThread.match_id);
            cleanupResults.databaseStaleThreads++;
            cleanupResults.errors.push(`Orphaned thread check error for ${dbThread.match_id}: ${checkErr.message}`);
          }
        }
      }
      
      // Phase 3: Clean up orphaned match data (matches with no threads that should have them)
      console.log('📋 Phase 3: Checking for orphaned match data...');
      try {
        // Get all matches from database that have no thread references
        const allMatches = await this.db.db.all('SELECT match_id, status FROM matches');
        const threadsMatchIds = new Set((await this.db.db.getAllMatchThreads()).map(t => t.match_id));
        
        for (const match of allMatches) {
          if (!threadsMatchIds.has(match.match_id)) {
            // Check if this match is old and can be cleaned up
            const matchData = await this.db.db.getMatch(match.match_id);
            if (matchData) {
              const isOldFinished = matchData.status === 'FINISHED' && matchData.finished_at && 
                                   (Date.now() / 1000 - matchData.finished_at) > (7 * 24 * 60 * 60); // 7 days
              
              if (isOldFinished) {
                console.log(`🗑️ Cleaning up old finished match data: ${match.match_id}`);
                // Remove associated RSVP data first
                await this.db.db.run('DELETE FROM rsvp_status WHERE match_id = ?', [match.match_id]);
                // Remove match data
                await this.db.db.run('DELETE FROM matches WHERE match_id = ?', [match.match_id]);
                // Remove from processed matches
                await this.db.db.run('DELETE FROM processed_matches WHERE match_id = ?', [match.match_id]);
                cleanupResults.orphanedMatches++;
              }
            }
          }
        }
      } catch (matchCleanupErr) {
        console.error(`Error during match data cleanup: ${matchCleanupErr.message}`);
        cleanupResults.errors.push(`Match cleanup error: ${matchCleanupErr.message}`);
      }
      
      // Phase 4: Clean up orphaned RSVP data (RSVPs for matches that no longer exist)
      console.log('📋 Phase 4: Cleaning up orphaned RSVP data...');
      try {
        // Modified query: Only remove RSVPs for matches that have neither match data NOR thread references
        // This prevents deleting RSVPs for valid matches that just lack match table entries
        const orphanedRsvpQuery = `
          DELETE FROM rsvp_status 
          WHERE match_id NOT IN (SELECT match_id FROM matches)
          AND match_id NOT IN (SELECT match_id FROM match_threads)
        `;
        const rsvpResult = await this.db.db.run(orphanedRsvpQuery);
        cleanupResults.orphanedRsvps = rsvpResult.changes || 0;
        
        if (cleanupResults.orphanedRsvps > 0) {
          console.log(`🗑️ Cleaned up ${cleanupResults.orphanedRsvps} truly orphaned RSVP entries`);
          // Clear RSVP memory cache to stay in sync
          this.db.rsvpStatus = {};
          // Reload RSVP data
          const rsvpData = await this.db.db.getAllRsvpData();
          for (const rsvp of rsvpData) {
            if (!this.db.rsvpStatus[rsvp.match_id]) {
              this.db.rsvpStatus[rsvp.match_id] = {};
            }
            this.db.rsvpStatus[rsvp.match_id][rsvp.discord_id] = {
              response: rsvp.response,
              faceit_nickname: rsvp.faceit_nickname,
              timestamp: rsvp.created_at
            };
          }
        }
      } catch (rsvpCleanupErr) {
        console.error(`Error during RSVP cleanup: ${rsvpCleanupErr.message}`);
        cleanupResults.errors.push(`RSVP cleanup error: ${rsvpCleanupErr.message}`);
      }
      
      // Phase 5: Clean up expired cache entries
      console.log('📋 Phase 5: Cleaning up expired cache entries...');
      try {
        await this.db.cleanupExpiredApiCache();
        await this.db.cleanupExpiredCache();
        await this.db.cleanupExpiredTeamDataCache();
      } catch (cacheCleanupErr) {
        console.error(`Error during cache cleanup: ${cacheCleanupErr.message}`);
        cleanupResults.errors.push(`Cache cleanup error: ${cacheCleanupErr.message}`);
      }
      
      // Summary
      console.log('✅ Comprehensive thread cleanup completed:');
      console.log(`   - Memory stale threads removed: ${cleanupResults.memoryStaleThreads}`);
      console.log(`   - Database stale threads removed: ${cleanupResults.databaseStaleThreads}`);
      console.log(`   - Orphaned matches cleaned: ${cleanupResults.orphanedMatches}`);
      console.log(`   - Orphaned RSVPs cleaned: ${cleanupResults.orphanedRsvps}`);
      console.log(`   - Threads validated: ${cleanupResults.validatedThreads}`);
      console.log(`   - Errors encountered: ${cleanupResults.errors.length}`);
      
      if (cleanupResults.errors.length > 0) {
        console.log('⚠️ Cleanup errors:');
        cleanupResults.errors.forEach(error => console.log(`   - ${error}`));
      }
      
      return cleanupResults;
    } catch (err) {
      console.error(`Error during comprehensive thread cleanup: ${err.message}`);
      return {
        memoryStaleThreads: 0,
        databaseStaleThreads: 0,
        orphanedMatches: 0,
        orphanedRsvps: 0,
        validatedThreads: 0,
        errors: [err.message]
      };
    }
  }

  /**
   * Create dynamic RSVP status display for thread welcome messages
   */
  async createDynamicRsvpStatus(matchId) {
    try {
      const matchRsvps = this.db.getRsvpForMatch(matchId);
      const allUserMappings = this.db.userMappings;
      
      // Get all team players from FACEIT
      let teamPlayers = [];
      try {
        const faceitService = require('./faceitService');
        teamPlayers = await faceitService.listTeamPlayers();
      } catch (err) {
        console.error(`Error fetching team players: ${err.message}`);
        // Fallback to registered Discord users if FACEIT API fails
        teamPlayers = Object.values(allUserMappings).map(user => ({ nickname: user.faceit_nickname }));
      }
      
      if (teamPlayers.length === 0) {
        return 'No team players found. Use the buttons above to RSVP!';
      }
      
      // Categorize players by RSVP status
      const attendingPlayers = [];
      const notAttendingPlayers = [];
      const noResponsePlayers = [];
      
      // Create a mapping of FACEIT nicknames to Discord user mappings for quick lookup
      const nicknameToDiscordMapping = new Map();
      Object.values(allUserMappings).forEach(user => {
        nicknameToDiscordMapping.set(user.faceit_nickname, user);
      });
      
      teamPlayers.forEach(player => {
        const playerNickname = player.nickname;
        const discordUser = nicknameToDiscordMapping.get(playerNickname);
        
        if (discordUser && matchRsvps[discordUser.discord_id]) {
          const rsvp = matchRsvps[discordUser.discord_id];
          if (rsvp.response === 'yes') {
            attendingPlayers.push(playerNickname);
          } else {
            notAttendingPlayers.push(playerNickname);
          }
        } else {
          // Player hasn't RSVP'd (either not registered with Discord or no RSVP response)
          noResponsePlayers.push(playerNickname);
        }
      });
      
      let statusText = '';
      
      if (attendingPlayers.length > 0) {
        statusText += `✅ **Attending (${attendingPlayers.length}):** ${attendingPlayers.join(', ')}\n`;
      }
      
      if (notAttendingPlayers.length > 0) {
        statusText += `❌ **Not Attending (${notAttendingPlayers.length}):** ${notAttendingPlayers.join(', ')}\n`;
      }
      
      // Add No Response section if there are players who haven't responded
      if (noResponsePlayers.length > 0) {
        // Add spacing before the "No Response" section if there are other RSVPs
        if (statusText.length > 0) {
          statusText += '\n';
        }
        statusText += `⏳ **No Response (${noResponsePlayers.length}):** ${noResponsePlayers.join(', ')}`;
      }
      
      if (statusText === '') {
        statusText = 'No RSVPs yet. Use the buttons above to respond!';
      }
      
      return statusText.trim();
      
    } catch (err) {
      console.error(`Error creating dynamic RSVP status: ${err.message}`);
      return 'Error loading RSVP status. Use the buttons above to respond!';
    }
  }

  /**
   * Clean up stale finished match thread references
   */
  async cleanupStaleFinishedMatchThreads() {
    try {
      // Get all finished match threads from database
      const finishedThreads = await this.db.db.getThreadsByType('finished');
      
      if (finishedThreads.length === 0) {
        return;
      }
      
      let cleanedCount = 0;
      
      for (const threadRecord of finishedThreads) {
        try {
          const thread = await this.client.channels.fetch(threadRecord.thread_id).catch(() => null);
          
          if (!thread) {
            console.log(`Thread ${threadRecord.thread_id} no longer exists, removing from database`);
            await this.db.removeMatchThread(threadRecord.match_id);
            cleanedCount++;
          }
        } catch (threadErr) {
          console.error(`Error checking thread ${threadRecord.thread_id}: ${threadErr.message}`);
        }
      }
      
      if (cleanedCount > 0) {
        console.log(`🧹 Cleaned up ${cleanedCount} stale finished match thread references`);
      }
    } catch (err) {
      console.error(`Error cleaning up stale finished match threads: ${err.message}`);
    }
  }

  /**
   * Lock finished match threads that are older than 72 hours based on match finish time
   */
  async lockOldFinishedMatchThreads(faceitService, finishedMatches = []) {
    try {
      console.log('🔒 Checking for old finished match threads to lock...');
      
      // Create a lookup map for finished matches to avoid redundant API calls
      const finishedMatchLookup = new Map();
      if (finishedMatches && finishedMatches.length > 0) {
        finishedMatches.forEach(match => {
          finishedMatchLookup.set(match.match_id, match);
        });
        console.log(`📋 Using cached data for ${finishedMatchLookup.size} recently finished matches`);
      }
      
      // Get all finished match threads from database
      const finishedThreads = await this.db.db.getThreadsByType('finished');
      
      if (finishedThreads.length === 0) {
        console.log('No finished match threads found');
        return;
      }
      
      let lockedCount = 0;
      const cutoffTime = Date.now() - (72 * 60 * 60 * 1000); // 72 hours ago in milliseconds
      
      for (const threadRecord of finishedThreads) {
        try {
          const thread = await this.client.channels.fetch(threadRecord.thread_id).catch(() => null);
          
          if (!thread) {
            // Thread cleanup should have been done earlier, but just in case
            console.log(`Thread ${threadRecord.thread_id} no longer exists, removing from database`);
            await this.db.removeMatchThread(threadRecord.match_id);
            continue;
          }
          
          // Skip if thread is already locked or archived
          if (thread.locked || thread.archived) {
            continue;
          }
          
          // Get match data to check the actual match finish time
          let matchData = await this.db.db.getMatch(threadRecord.match_id);
          let matchFinishTime = null;
          
          if (matchData && matchData.finished_at) {
            // Use stored finish time from database
            matchFinishTime = matchData.finished_at * 1000; // Convert to milliseconds
            console.log(`Using stored finish time for match ${threadRecord.match_id}: ${new Date(matchFinishTime).toLocaleString()}`);
            
            // Check if thread title needs correction (has "Unknown" date) even with stored data
            if (thread.name.includes('RESULT: Unknown')) {
              console.log(`🔧 Correcting thread title with stored database date for match ${threadRecord.match_id}`);
              const correctedDate = new Date(matchData.finished_at * 1000).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                timeZone: 'America/Los_Angeles'
              });
              
              // Extract team names from stored match data or thread name
              let faction1, faction2;
              if (matchData.faction1_name && matchData.faction2_name) {
                faction1 = matchData.faction1_name;
                faction2 = matchData.faction2_name;
              } else {
                // Extract from thread name as fallback
                const nameMatch = thread.name.match(/RESULT: Unknown - (.+) vs (.+)/);
                if (nameMatch) {
                  faction1 = nameMatch[1];
                  faction2 = nameMatch[2];
                } else {
                  console.warn(`Could not extract team names from thread: ${thread.name}`);
                  faction1 = 'Team1';
                  faction2 = 'Team2';
                }
              }
              
              const correctedThreadName = `RESULT: ${correctedDate} - ${faction1} vs ${faction2}`;
              
              try {
                await thread.setName(correctedThreadName);
                console.log(`✅ Updated thread title from "${thread.name}" to "${correctedThreadName}"`);
              } catch (nameErr) {
                console.error(`❌ Failed to update thread title: ${nameErr.message}`);
              }
            }
          } else {
            // No stored match data - check if we have it in the cached finished matches
            const cachedMatch = finishedMatchLookup.get(threadRecord.match_id);
            if (cachedMatch && cachedMatch.finished_at) {
              matchFinishTime = cachedMatch.finished_at * 1000; // Convert to milliseconds
              console.log(`Using cached FACEIT data for legacy match ${threadRecord.match_id}: ${new Date(matchFinishTime).toLocaleString()}`);
              
              // Optionally save this data to database for future use
              try {
                const winner = this.determineMatchWinner(cachedMatch);
                const result = this.formatMatchResult(cachedMatch);
                
                await this.db.db.addOrUpdateMatch({
                  match_id: cachedMatch.match_id,
                  teams: cachedMatch.teams,
                  scheduled_at: cachedMatch.scheduled_at,
                  competition_name: cachedMatch.competition_name || 'FACEIT Match',
                  status: 'FINISHED'
                });
                
                await this.db.db.updateMatchResult(
                  cachedMatch.match_id,
                  result,
                  winner,
                  cachedMatch.finished_at
                );
                
              console.log(`💾 Saved cached match data to database for future reference: ${cachedMatch.match_id}`);
              
              // Check if thread title needs correction (has "Unknown" date)
              if (thread.name.includes('RESULT: Unknown')) {
                console.log(`🔧 Correcting thread title with proper date for match ${cachedMatch.match_id}`);
                const correctedDate = new Date(cachedMatch.finished_at * 1000).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  timeZone: 'America/Los_Angeles'
                });
                const faction1 = cachedMatch.teams.faction1.name;
                const faction2 = cachedMatch.teams.faction2.name;
                const correctedThreadName = `RESULT: ${correctedDate} - ${faction1} vs ${faction2}`;
                
                try {
                  await thread.setName(correctedThreadName);
                  console.log(`✅ Updated thread title from "${thread.name}" to "${correctedThreadName}"`);
                } catch (nameErr) {
                  console.error(`❌ Failed to update thread title: ${nameErr.message}`);
                }
              }
              
            } catch (saveErr) {
              console.error(`Failed to save cached match data: ${saveErr.message}`);
              // Continue with locking even if save fails
            }
            } else {
              console.log(`⚠️ No match finish data available for thread ${threadRecord.thread_id} (match: ${threadRecord.match_id})`);
              console.log(`This is likely a legacy thread created before database persistence was implemented.`);
              console.log(`⏭️ Skipping thread until FACEIT match finish data is available: ${thread.name}`);
              continue;
            }
          }
          
          // Check if the match is old enough to lock (72+ hours since finish)
          if (matchFinishTime && matchFinishTime < cutoffTime) {
            console.log(`Locking old finished match thread: ${thread.name} (match finished ${new Date(matchFinishTime).toLocaleString()})`);
            
            // Lock the thread
            await thread.setLocked(true, 'Auto-locking finished match thread after 72 hours since match completion');
            
            // Optionally send a final message before locking
            await thread.send({
              embeds: [
                new EmbedBuilder()
                  .setTitle('🔒 Thread Locked')
                  .setDescription('This match thread has been automatically locked 72 hours after the match ended. The match discussion is now archived for historical reference.')
                  .setColor(0x808080)
                  .setTimestamp()
              ]
            });
            
            lockedCount++;
          } else if (matchFinishTime) {
            const hoursRemaining = Math.ceil((matchFinishTime + (72 * 60 * 60 * 1000) - Date.now()) / (60 * 60 * 1000));
            console.log(`Match ${threadRecord.match_id} will be eligible for locking in ${hoursRemaining} hours`);
          }
        } catch (threadErr) {
          console.error(`Error processing thread ${threadRecord.thread_id}: ${threadErr.message}`);
        }
      }
      
      if (lockedCount > 0) {
        console.log(`🔒 Locked ${lockedCount} old finished match threads`);
      } else {
        console.log('No old finished match threads need locking');
      }
    } catch (err) {
      console.error(`Error locking old finished match threads: ${err.message}`);
    }
  }

  /**
   * Create a simple, clean RSVP chart for match notifications
   */
  createSimpleRsvpChart(matchId) {
    try {
      const matchRsvps = this.db.getRsvpForMatch(matchId);
      const allUserMappings = this.db.userMappings;
      const registeredUsers = Object.values(allUserMappings);
      
      if (registeredUsers.length === 0) {
        return '```\nNo team members registered yet\n```';
      }
      
      // Create a simple chart showing each player and their status
      let chart = '```\n';
      
      registeredUsers.forEach(user => {
        const rsvp = matchRsvps[user.discord_id];
        let status = '⏳'; // Default: No response
        
        if (rsvp) {
          status = rsvp.response === 'yes' ? '✅' : '❌';
        }
        
        // Format: [Status] PlayerName
        const name = user.faceit_nickname.padEnd(12).substring(0, 12);
        chart += `${status} ${name}\n`;
      });
      
      chart += '\n✅ Attending  ❌ Not Attending  ⏳ No Response\n```';
      
      return chart;
      
    } catch (err) {
      console.error(`Error creating RSVP chart: ${err.message}`);
      return '```\nError loading RSVP status\n```';
    }
  }

  /**
   * Ensure all current matches have proper threads (create missing ones)
   */
  async ensureAllMatchThreadsExist(allMatches) {
    try {
      let createdThreads = 0;
      
      for (const { match, type } of allMatches) {
        try {
          // Check if this match has ANY thread in the database (use fresh DB query for accuracy)
          const hasAnyThread = await this.db.hasAnyMatchThread(match.match_id);
          
          if (!hasAnyThread) {
            console.log(`⚠️ Match ${match.match_id} has no thread in database, checking Discord...`);
            
            // Double-check by looking for the thread in Discord directly
            const existingThread = await this.findMatchThreadInDiscord(match.match_id);
            
            if (existingThread) {
              console.log(`✅ Found existing Discord thread for match ${match.match_id}: ${existingThread.name}`);
              // Restore the database reference
              const threadType = existingThread.name.startsWith('RESULT:') ? 'finished' : 'upcoming';
              await this.db.addMatchThread(match.match_id, existingThread.id, threadType);
              console.log(`💾 Restored database reference for ${threadType} thread: ${match.match_id}`);
            } else {
              console.log(`🆕 Creating missing ${type} thread for match ${match.match_id}`);
              
              // Create the appropriate thread type
              if (type === 'upcoming') {
                // Force create upcoming thread (bypass normal duplicate check)
                await this.createMissingUpcomingThread(match);
              } else if (type === 'finished') {
                await this.createFinishedMatchThread(match);
              }
              
              createdThreads++;
            }
          }
        } catch (matchErr) {
          console.error(`Error ensuring thread exists for match ${match.match_id}: ${matchErr.message}`);
        }
      }
      
      if (createdThreads > 0) {
        console.log(`✅ Created ${createdThreads} missing match threads`);
      } else {
        console.log('All matches have proper threads');
      }
      
    } catch (err) {
      console.error(`Error ensuring all match threads exist: ${err.message}`);
    }
  }

  /**
   * Find a match thread in Discord by searching for the match ID
   */
  async findMatchThreadInDiscord(matchId) {
    try {
      const channel = this.client.channels.cache.get(config.discord.channelId);
      if (!channel || !channel.threads) {
        return null;
      }
      
      // Fetch active threads
      const activeThreads = await channel.threads.fetchActive();
      
      // Search active threads first
      for (const thread of activeThreads.threads.values()) {
        if (this.isMatchThread(thread.name)) {
          const extractedMatchId = await this.extractMatchIdFromThread(thread);
          if (extractedMatchId === matchId) {
            return thread;
          }
        }
      }
      
      // Search recent archived threads (limited search to avoid performance issues)
      const recentArchived = await channel.threads.fetchArchived({ limit: 50 });
      for (const thread of recentArchived.threads.values()) {
        if (this.isMatchThread(thread.name)) {
          const extractedMatchId = await this.extractMatchIdFromThread(thread);
          if (extractedMatchId === matchId) {
            return thread;
          }
        }
      }
      
      return null;
    } catch (err) {
      console.error(`Error finding match thread in Discord: ${err.message}`);
      return null;
    }
  }

  /**
   * Reset session cache at the beginning of a check cycle
   */
  resetSessionCache() {
    console.log('🔄 Resetting session cache for new check cycle');
    this.queryCache.sessionCache.clear();
  }

  /**
   * Clear session cache after check cycle completion
   */
  clearSessionCache() {
    this.queryCache.sessionCache.clear();
  }

  /**
   * Get cached result or execute database query with caching
   */
  async getCachedQuery(cacheKey, queryFunction, useSessionCache = true) {
    try {
      // Check if we should use session cache (for current check cycle only)
      if (useSessionCache && this.queryCache.sessionCache.has(cacheKey)) {
        console.log(`📋 Using session cache for: ${cacheKey}`);
        return this.queryCache.sessionCache.get(cacheKey);
      }
      
      // Check persistent cache (with TTL)
      if (this.queryCache.matchThreads.has(cacheKey)) {
        const cachedItem = this.queryCache.matchThreads.get(cacheKey);
        const cacheAge = Date.now() - cachedItem.timestamp;
        
        if (cacheAge < this.queryCache.cacheTTL) {
          console.log(`💾 Using persistent cache for: ${cacheKey} (age: ${Math.round(cacheAge / 1000)}s)`);
          
          // Also store in session cache for faster access during this cycle
          if (useSessionCache) {
            this.queryCache.sessionCache.set(cacheKey, cachedItem.result);
          }
          
          return cachedItem.result;
        } else {
          // Cache expired, remove it
          this.queryCache.matchThreads.delete(cacheKey);
        }
      }
      
      // Execute the query function
      console.log(`🔍 Executing fresh query for: ${cacheKey}`);
      const result = await queryFunction();
      
      // Store in persistent cache
      this.queryCache.matchThreads.set(cacheKey, {
        result: result,
        timestamp: Date.now()
      });
      
      // Store in session cache if requested
      if (useSessionCache) {
        this.queryCache.sessionCache.set(cacheKey, result);
      }
      
      return result;
      
    } catch (err) {
      console.error(`Error in cached query ${cacheKey}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Invalidate cache for a specific match (when we know data has changed)
   */
  invalidateMatchCache(matchId) {
    console.log(`🗑️ Invalidating cache for match: ${matchId}`);
    
    // Remove from persistent cache
    this.queryCache.matchThreads.delete(`hasAnyThread_${matchId}`);
    this.queryCache.matchThreads.delete(`hasFinishedThread_${matchId}`);
    this.queryCache.matchThreads.delete(`hasUpcomingThread_${matchId}`);
    
    // Remove from session cache
    this.queryCache.sessionCache.delete(`hasAnyThread_${matchId}`);
    this.queryCache.sessionCache.delete(`hasFinishedThread_${matchId}`);
    this.queryCache.sessionCache.delete(`hasUpcomingThread_${matchId}`);
  }

  /**
   * Cached version of hasAnyMatchThread with intelligent caching
   */
  async hasAnyMatchThreadCached(matchId) {
    const cacheKey = `hasAnyThread_${matchId}`;
    return await this.getCachedQuery(
      cacheKey,
      () => this.db.hasAnyMatchThread(matchId),
      true // Use session cache
    );
  }

  /**
   * Cached version of hasFinishedMatchThread
   */
  async hasFinishedMatchThreadCached(matchId) {
    const cacheKey = `hasFinishedThread_${matchId}`;
    return await this.getCachedQuery(
      cacheKey,
      () => this.db.hasFinishedMatchThread(matchId),
      true // Use session cache
    );
  }

  /**
   * Convert an existing INCOMING thread to a RESULT thread when match finishes
   * Enhanced with detailed validation logging and conservative checks
   */
  async convertIncomingToResultThread(match) {
    try {
      console.log(`🔄 [CONVERSION START] Converting INCOMING thread to RESULT thread for match ${match.match_id}`);
      console.log(`   - Match status: ${match.status}`);
      console.log(`   - Match finished_at: ${match.finished_at ? new Date(match.finished_at * 1000).toISOString() : 'not set'}`);
      
      // VALIDATION: Verify match data integrity
      if (!match || !match.teams || !match.teams.faction1 || !match.teams.faction2) {
        console.error(`❌ [CONVERSION FAILED] Invalid finished match data for thread conversion: ${match.match_id}`);
        return null;
      }
      
      // VALIDATION: Confirm match is actually finished
      if (match.status !== 'FINISHED') {
        console.error(`❌ [CONVERSION FAILED] Match ${match.match_id} status is ${match.status}, not FINISHED`);
        return null;
      }
      
      if (!match.finished_at) {
        console.error(`❌ [CONVERSION FAILED] Match ${match.match_id} is FINISHED but missing finished_at timestamp`);
        return null;
      }

      // Get the existing upcoming thread
      const existingThreadId = this.db.matchThreads.get(match.match_id);
      if (!existingThreadId) {
        console.error(`❌ [CONVERSION FAILED] No thread found in memory cache for match ${match.match_id}`);
        
        // Try to find it in database as fallback
        try {
          const dbThreads = await this.db.db.getThreadsByType('upcoming');
          const matchingDbThread = dbThreads.find(t => t.match_id === match.match_id);
          if (matchingDbThread) {
            console.log(`🔍 [RECOVERY] Found thread in database: ${matchingDbThread.thread_id}`);
            // Update memory cache
            this.db.matchThreads.set(match.match_id, matchingDbThread.thread_id);
            const recoveredThread = await this.client.channels.fetch(matchingDbThread.thread_id).catch(() => null);
            if (recoveredThread) {
              console.log(`✅ [RECOVERY] Successfully recovered thread reference from database`);
              return await this.convertIncomingToResultThread(match); // Retry with recovered thread
            }
          }
        } catch (recoveryErr) {
          console.error(`❌ [RECOVERY FAILED] Could not recover thread from database: ${recoveryErr.message}`);
        }
        return null;
      }

      const existingThread = await this.client.channels.fetch(existingThreadId).catch(() => null);
      if (!existingThread) {
        console.error(`❌ [CONVERSION FAILED] Could not fetch existing thread ${existingThreadId} for match ${match.match_id}`);
        // Clean up stale reference
        this.db.matchThreads.delete(match.match_id);
        await this.db.removeMatchThread(match.match_id);
        console.log(`🧹 [CLEANUP] Removed stale thread reference for match ${match.match_id}`);
        return null;
      }

      console.log(`📍 [VALIDATION] Found existing thread: "${existingThread.name}" (ID: ${existingThread.id})`);
      
      // VALIDATION: Ensure thread is an INCOMING thread
      if (!existingThread.name.startsWith('INCOMING:')) {
        console.warn(`⚠️ [VALIDATION WARNING] Thread "${existingThread.name}" does not appear to be an INCOMING thread`);
        console.warn(`   This may indicate the thread was already converted or has an unexpected name format`);
      }
      
      // Generate new thread name for RESULT
      const faction1 = match.teams.faction1.name;
      const faction2 = match.teams.faction2.name;
      const shortDate = match.finished_at ? new Date(match.finished_at * 1000).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'America/Los_Angeles'
      }) : 'Unknown';
      
      const newThreadName = `RESULT: ${shortDate} - ${faction1} vs ${faction2}`;
      
      console.log(`🏷️ [CONVERSION] Renaming thread from "${existingThread.name}" to "${newThreadName}"`);
      console.log(`   - Conversion reason: Match ${match.match_id} finished at ${new Date(match.finished_at * 1000).toISOString()}`);
      
      // Update thread name
      await existingThread.setName(newThreadName);
      console.log(`✅ [THREAD UPDATE] Successfully renamed thread`);
      
      // Update thread type in database
      console.log(`💾 [DATABASE] Updating thread type from 'upcoming' to 'finished' in database`);
      await this.db.db.run('UPDATE match_threads SET thread_type = ? WHERE match_id = ?', ['finished', match.match_id]);
      
      // Save finished match data to database
      console.log(`💾 [DATABASE] Saving finished match data to database`);
      try {
        const winner = this.determineMatchWinner(match);
        const result = this.formatMatchResult(match);
        
        console.log(`   - Winner: ${winner}`);
        console.log(`   - Result: ${result}`);
        
        await this.db.db.addOrUpdateMatch({
          match_id: match.match_id,
          teams: match.teams,
          scheduled_at: match.scheduled_at,
          competition_name: match.competition_name || 'FACEIT Match',
          status: 'FINISHED'
        });
        
        await this.db.db.updateMatchResult(
          match.match_id,
          result,
          winner,
          match.finished_at
        );
        
        console.log(`✅ [DATABASE] Successfully saved finished match data to database`);
      } catch (dbErr) {
        console.error(`❌ [DATABASE ERROR] Failed to save finished match data: ${dbErr.message}`);
        // Continue with conversion even if database save fails
      }
      
      // Create and send match result embed to the thread
      console.log(`📊 [RESULT EMBED] Creating and sending match result summary`);
      const matchDate = match.finished_at ? new Date(match.finished_at * 1000).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Los_Angeles'
      }) : 'Unknown';
      
      const winner = this.determineMatchWinner(match);
      const result = this.formatMatchResult(match);
      
      const summaryEmbed = this.createMatchSummaryEmbed(match, winner, result, matchDate);
      
      // Send the match summary (matching original RESULT thread style)
      await existingThread.send({ embeds: [summaryEmbed] });
      console.log(`✅ [RESULT EMBED] Successfully sent match result summary to converted thread`);
      
      // Get team performance data if available (matching original RESULT thread style)
      console.log(`📈 [PERFORMANCE] Checking for performance data`);
      const performanceData = await this.getMatchPerformanceData(match);
      if (performanceData) {
        const performanceEmbed = this.createPerformanceEmbed(match, performanceData);
        await existingThread.send({ embeds: [performanceEmbed] });
        console.log(`✅ [PERFORMANCE] Sent performance data to converted thread`);
      } else {
        console.log(`ℹ️ [PERFORMANCE] No performance data available for this match`);
      }
      
      // Invalidate cache since we changed thread type
      console.log(`🗑️ [CACHE] Invalidating cache for converted match`);
      this.invalidateMatchCache(match.match_id);
      
      // Cache invalidation for match finish is handled by the unified cache
      
      console.log(`✅ [CONVERSION COMPLETE] Successfully converted INCOMING thread to RESULT thread: "${newThreadName}"`);
      console.log(`   - Thread ID: ${existingThread.id}`);
      console.log(`   - Match: ${faction1} vs ${faction2}`);
      console.log(`   - Finished: ${matchDate}`);
      
      return existingThread;
      
    } catch (err) {
      console.error(`❌ [CONVERSION ERROR] Failed to convert INCOMING thread to RESULT thread for match ${match?.match_id}: ${err.message}`);
      console.error(`   - Error stack: ${err.stack}`);
      return null;
    }
  }

  /**
   * Check for potential thread conversions (INCOMING → RESULT) based on existing threads and scheduling
   * ENHANCED for conservative validation with fresh API data and extensive validation
   */
  async checkForPotentialThreadConversions() {
    console.log('🚨 DEBUG: checkForPotentialThreadConversions method CALLED at', new Date().toISOString());
    try {
      console.log('🔍 Checking for potential thread conversions with ENHANCED conservative validation...');
      
      // Get all upcoming threads from database
      const upcomingThreads = await this.db.db.getThreadsByType('upcoming');
      if (upcomingThreads.length === 0) {
        console.log('No upcoming threads found for conversion checking');
        return;
      }
      
      const now = Date.now() / 1000; // Unix timestamp
      let directConversions = 0;
      let validationChecks = 0;
      
      console.log(`📋 Found ${upcomingThreads.length} upcoming threads to check for conversion`);
      
      for (const threadRecord of upcomingThreads) {
        try {
          console.log(`🔍 [ENHANCED] Checking thread ${threadRecord.thread_id} for match ${threadRecord.match_id}`);
          
          // CONSERVATIVE APPROACH: Always fetch fresh match data from FACEIT API first
          console.log(`🌐 [ENHANCED] Fetching fresh match data from FACEIT API for validation: ${threadRecord.match_id}`);
          let freshApiMatch = null;
          let freshApiError = null;
          
          try {
            const faceitService = require('./faceitService');
            freshApiMatch = await faceitService.getMatchDetails(threadRecord.match_id);
            console.log(`✅ [ENHANCED] Retrieved fresh API data for match ${threadRecord.match_id}, status: ${freshApiMatch?.status}, finished_at: ${freshApiMatch?.finished_at}`);
          } catch (apiErr) {
            freshApiError = apiErr.message;
            console.log(`❌ [ENHANCED] Failed to fetch fresh API data for match ${threadRecord.match_id}: ${freshApiError}`);
          }
          
          // Get cached/stored match data for comparison
          let storedMatch = this.db.upcomingMatches.get(threadRecord.match_id);
          if (!storedMatch) {
            try {
              storedMatch = await this.db.db.getMatch(threadRecord.match_id);
              console.log(`📋 [ENHANCED] Retrieved stored match data from database: ${threadRecord.match_id}`);
            } catch (dbErr) {
              console.log(`⚠️ [ENHANCED] No stored match data found for ${threadRecord.match_id}: ${dbErr.message}`);
            }
          } else {
            console.log(`📋 [ENHANCED] Retrieved stored match data from cache: ${threadRecord.match_id}`);
          }
          
          // VALIDATION PHASE: Only proceed if we have reliable fresh API data
          if (!freshApiMatch) {
            console.log(`⚠️ [ENHANCED] CONSERVATIVE SKIP: No fresh API data available for ${threadRecord.match_id} - cannot safely validate conversion`);
            
            // If scheduled more than 4 hours ago and we can't get API data, log concern
            if (storedMatch?.scheduled_at) {
              const hoursSinceScheduled = (now - storedMatch.scheduled_at) / 3600;
              if (hoursSinceScheduled >= 4) {
                console.warn(`🚨 [ENHANCED] ATTENTION: Match ${threadRecord.match_id} scheduled ${hoursSinceScheduled.toFixed(1)}h ago but API unavailable for status validation`);
              }
            }
            continue;
          }
          
          // VALIDATION: Compare fresh API data with stored data
          let validationResult = this.validateMatchDataForConversion(freshApiMatch, storedMatch, threadRecord.match_id);
          validationChecks++;
          
          if (!validationResult.isValid) {
            console.log(`⚠️ CONSERVATIVE SKIP: Validation failed for ${threadRecord.match_id}: ${validationResult.reason}`);
            continue;
          }
          
          // CONVERSION DECISION: Only convert if fresh API data shows FINISHED status
          if (freshApiMatch.status === 'FINISHED') {
            console.log(`✅ VALIDATED CONVERSION: Fresh API confirms match ${threadRecord.match_id} is FINISHED`);
            console.log(`   Conversion reason: ${validationResult.conversionReason}`);
            
            // Additional validation: ensure match has finished_at timestamp
            if (!freshApiMatch.finished_at) {
              console.warn(`⚠️ CONSERVATIVE SKIP: Match ${threadRecord.match_id} status is FINISHED but missing finished_at timestamp`);
              continue;
            }
            
            // Perform the conversion with fresh API data
            const convertedThread = await this.convertIncomingToResultThread(freshApiMatch);
            if (convertedThread) {
              directConversions++;
              console.log(`✅ Successfully converted thread for validated finished match: ${threadRecord.match_id}`);
              
              // Save fresh match data to database to keep it up-to-date
              try {
                const winner = this.determineMatchWinner(freshApiMatch);
                const result = this.formatMatchResult(freshApiMatch);
                
                await this.db.db.addOrUpdateMatch({
                  match_id: freshApiMatch.match_id,
                  teams: freshApiMatch.teams,
                  scheduled_at: freshApiMatch.scheduled_at,
                  competition_name: freshApiMatch.competition_name || 'FACEIT Match',
                  status: 'FINISHED'
                });
                
                await this.db.db.updateMatchResult(
                  freshApiMatch.match_id,
                  result,
                  winner,
                  freshApiMatch.finished_at
                );
                
                console.log(`💾 Updated database with fresh API match data: ${freshApiMatch.match_id}`);
              } catch (saveErr) {
                console.error(`Failed to save fresh API match data: ${saveErr.message}`);
              }
            } else {
              console.error(`❌ Failed to convert thread for validated finished match: ${threadRecord.match_id}`);
            }
          } else {
            // Match is not finished - log current status for monitoring
            const scheduledTime = freshApiMatch.scheduled_at ? new Date(freshApiMatch.scheduled_at * 1000).toISOString() : 'Unknown';
            const hoursSinceScheduled = freshApiMatch.scheduled_at ? (now - freshApiMatch.scheduled_at) / 3600 : 0;
            
            console.log(`📊 Match ${threadRecord.match_id} status: ${freshApiMatch.status}`);
            console.log(`   Scheduled: ${scheduledTime} (${hoursSinceScheduled.toFixed(1)}h ago)`);
            console.log(`   Validation: ${validationResult.reason}`);
            
            // Alert if match has been scheduled for a very long time but still not finished
            if (hoursSinceScheduled >= 6) {
              console.warn(`🚨 LONG-RUNNING MATCH: ${threadRecord.match_id} scheduled ${hoursSinceScheduled.toFixed(1)}h ago but still ${freshApiMatch.status}`);
            }
          }
          
        } catch (threadErr) {
          console.error(`Error checking thread ${threadRecord.thread_id} for conversion: ${threadErr.message}`);
        }
      }
      
      // Summary logging
      console.log(`🔍 Thread conversion check complete:`);
      console.log(`   - Validation checks performed: ${validationChecks}`);
      console.log(`   - Direct conversions completed: ${directConversions}`);
      
      if (directConversions > 0) {
        console.log(`✅ Successfully performed ${directConversions} validated thread conversions`);
      } else if (validationChecks > 0) {
        console.log(`📊 Performed ${validationChecks} validation checks, no conversions needed`);
      } else {
        console.log('📋 No thread conversions or validations performed');
      }
      
    } catch (err) {
      console.error('Error checking for potential thread conversions:', err.message);
    }
  }
  
  /**
   * Validate match data for thread conversion with extensive checks
   */
  validateMatchDataForConversion(freshApiMatch, storedMatch, matchId) {
    console.log(`🔍 Validating match data for conversion: ${matchId}`);
    
    // Basic API data validation
    if (!freshApiMatch) {
      return {
        isValid: false,
        reason: 'No fresh API data available',
        conversionReason: null
      };
    }
    
    if (!freshApiMatch.teams || !freshApiMatch.teams.faction1 || !freshApiMatch.teams.faction2) {
      return {
        isValid: false,
        reason: 'Fresh API data missing team information',
        conversionReason: null
      };
    }
    
    // For FINISHED matches, ensure we have all required data
    if (freshApiMatch.status === 'FINISHED') {
      if (!freshApiMatch.finished_at) {
        return {
          isValid: false,
          reason: 'FINISHED match missing finished_at timestamp',
          conversionReason: null
        };
      }
      
      // Validate finished_at is reasonable (not in future, not too old)
      const now = Date.now() / 1000;
      const finishedAt = freshApiMatch.finished_at;
      
      if (finishedAt > now) {
        return {
          isValid: false,
          reason: 'FINISHED match has future finished_at timestamp',
          conversionReason: null
        };
      }
      
      // Don't convert matches finished more than 7 days ago (likely stale)
      const daysSinceFinished = (now - finishedAt) / (24 * 3600);
      if (daysSinceFinished > 7) {
        return {
          isValid: false,
          reason: `Match finished ${daysSinceFinished.toFixed(1)} days ago - too old for conversion`,
          conversionReason: null
        };
      }
      
      // Additional validation: compare with stored data if available
      let comparisonResult = '';
      if (storedMatch) {
        // Check if status changed from non-FINISHED to FINISHED
        if (storedMatch.status && storedMatch.status !== 'FINISHED') {
          comparisonResult = `Status changed from ${storedMatch.status} to FINISHED`;
        } else if (storedMatch.status === 'FINISHED') {
          // Both stored and fresh show FINISHED - check timestamps
          if (storedMatch.finished_at && Math.abs(storedMatch.finished_at - freshApiMatch.finished_at) > 300) {
            comparisonResult = `finished_at timestamp updated (${Math.abs(storedMatch.finished_at - freshApiMatch.finished_at)}s difference)`;
          } else {
            comparisonResult = 'Confirmed FINISHED status with consistent data';
          }
        } else {
          comparisonResult = 'Fresh API data shows newly FINISHED match';
        }
      } else {
        comparisonResult = 'Fresh API data shows FINISHED match (no stored data for comparison)';
      }
      
      return {
        isValid: true,
        reason: 'Valid FINISHED match with fresh API data',
        conversionReason: `Fresh API validation: ${comparisonResult}`
      };
    }
    
    // For non-FINISHED matches, still validate but don't convert
    return {
      isValid: true,
      reason: `Match status ${freshApiMatch.status} - no conversion needed`,
      conversionReason: null
    };
  }
  
  /**
   * Create a missing upcoming thread (bypass normal duplication checks)
   */
  async createMissingUpcomingThread(match) {
    try {
      if (!match || !match.teams || !match.teams.faction1 || !match.teams.faction2) {
        console.error('Invalid match data for missing upcoming thread creation');
        return;
      }
      
      const faction1 = match.teams.faction1.name;
      const faction2 = match.teams.faction2.name;
      const matchTimes = formatMatchTime(match.scheduled_at);
      
      // Store match data for RSVP purposes
      this.db.upcomingMatches.set(match.match_id, match);
      
      const targetChannel = this.client.channels.cache.get(config.discord.channelId);
      
      if (targetChannel) {
        // Create a standalone thread in the channel
        const thread = await targetChannel.threads.create({
          name: `INCOMING: ${matchTimes.mountain} - ${faction1} vs ${faction2}`,
          autoArchiveDuration: 60,
          type: 11, // GUILD_PUBLIC_THREAD
          reason: `Restored missing discussion thread for match: ${faction1} vs ${faction2}`
        });

        // Store thread reference for this match using the database service
        await this.db.addMatchThread(match.match_id, thread.id, 'upcoming');
        
        // Invalidate cache since we just added a new thread
        this.invalidateMatchCache(match.match_id);
        
        // Send a simple RSVP status message to the thread
        await this.sendSimpleRsvpMessage(thread, match);

        console.log(`✅ Created missing upcoming thread: ${thread.name}`);
        
        return thread;
      } else {
        console.error('Could not find target channel for missing upcoming thread');
        return null;
      }
      
    } catch (err) {
      console.error(`Error creating missing upcoming thread: ${err.message}`);
      return null;
    }
  }
}

module.exports = DiscordService;
