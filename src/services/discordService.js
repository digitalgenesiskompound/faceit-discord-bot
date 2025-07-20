const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { formatMatchTime } = require('../utils/helpers');
const config = require('../config/config');

class DiscordService {
  constructor(client, databaseService) {
    this.client = client;
    this.db = databaseService;
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
      
      // Check if we already have an active thread for this match
      const existingThreadId = this.db.matchThreads.get(match.match_id);
      if (existingThreadId) {
        // Verify the thread still exists and is accessible
        const threadExists = await this.validateThread(existingThreadId);
        if (threadExists) {
          console.log(`Active thread already exists for match ${match.match_id}, skipping notification`);
          return;
        } else {
          console.log(`Thread ${existingThreadId} for match ${match.match_id} no longer exists, will create new thread`);
          // Remove stale thread reference
          this.db.matchThreads.delete(match.match_id);
          await this.db.removeMatchThread(match.match_id);
        }
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
      const rsvpStatus = this.createDynamicRsvpStatus(match.match_id);
      
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
      
      // Get match data for context
      const match = this.db.upcomingMatches.get(matchId);
      if (!match) {
        console.log(`Match ${matchId} not found in upcomingMatches cache, attempting simplified update`);
        
        // Try to update with limited information by finding existing message
        const messages = await thread.messages.fetch({ limit: 10 });
        const rsvpMessage = messages.find(msg => 
          msg.author.id === this.client.user.id && 
          msg.embeds.length > 0 && 
          msg.embeds[0].title && 
          msg.embeds[0].title.includes('RSVP Status')
        );
        
        if (rsvpMessage) {
          // Extract existing information from the message
          const existingEmbed = rsvpMessage.embeds[0];
          const existingTitle = existingEmbed.title;
          const existingDescription = existingEmbed.description;
          
          // Get updated RSVP status
          const rsvpStatus = this.createDynamicRsvpStatus(matchId);
          
          // Update just the RSVP section in the description
          const descriptionParts = existingDescription.split('**Current RSVPs:**\n');
          let updatedDescription = existingDescription;
          if (descriptionParts.length === 2) {
            updatedDescription = descriptionParts[0] + '**Current RSVPs:**\n' + rsvpStatus;
          } else {
            // Fallback - append RSVP status
            updatedDescription = existingDescription + '\n\n**Current RSVPs:**\n' + rsvpStatus;
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
          console.log(`Updated RSVP message with simplified status for match ${matchId}`);
        } else {
          console.log(`RSVP message not found for match ${matchId}, cannot update`);
        }
        return;
      }
      
      const faction1 = match.teams.faction1.name;
      const faction2 = match.teams.faction2.name;
      const matchTimes = formatMatchTime(match.scheduled_at);
      const matchUrl = `https://www.faceit.com/en/cs2/room/${match.match_id}`;
      
      // Get updated RSVP status
      const rsvpStatus = this.createDynamicRsvpStatus(matchId);
      
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
        console.log(`RSVP message not found for match ${matchId}`);
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

      // Check if we already have a finished match thread for this match
      const hasThread = await this.db.hasFinishedMatchThread(match.match_id);
      if (hasThread) {
        console.log(`Finished match thread already exists for match ${match.match_id}`);
        return;
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

      // Store thread reference using the database service FIRST
      await this.db.addMatchThread(match.match_id, thread.id, 'finished');
      
      // Verify the thread was actually saved
      const savedThread = await this.db.hasFinishedMatchThread(match.match_id);
      if (!savedThread) {
        console.error(`Failed to save finished match thread for ${match.match_id}`);
        return;
      }
      console.log(`✅ Successfully saved finished match thread for ${match.match_id}`);
      
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
    // Use setTimeout to avoid blocking the main RSVP response
    setTimeout(async () => {
      await this.updateThreadRsvpStatus(matchId);
    }, 1000);
  }

  /**
   * Check for new matches and send notifications, also check for finished matches
   */
  async checkMatches(faceitService) {
    try {
      console.log('🔄 Checking for new matches and finished matches...');
      
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
      
      if (matches.length > 0) {
        for (const match of matches) {
          if (!this.db.isMatchProcessed(match.match_id)) {
            console.log(`New match found: ${match.match_id}`);
            await this.sendMatchNotification(match);
          }
        }
      } else {
        console.log('No upcoming matches found.');
      }
      
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
            // Check if we already have a finished match thread for this match
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
      
      // Check for finished match threads that need to be locked (72+ hours old)
      // Pass the finished matches data to avoid duplicate API calls
      await this.lockOldFinishedMatchThreads(faceitService, finishedMatches);
      
      console.log('✅ Match check completed');
    } catch (err) {
      console.error(`Error during match check: ${err.message}`);
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
      const rsvpStatus = this.createDynamicRsvpStatus(match.match_id);
      
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
   */
  async validateThread(threadId) {
    try {
      const thread = await this.client.channels.fetch(threadId);
      // Check if thread is archived or locked
      if (thread && !thread.archived && !thread.locked) {
        return true;
      } else if (thread && (thread.archived || thread.locked)) {
        console.log(`Thread ${threadId} is archived or locked`);
        return false;
      }
      return false;
    } catch (err) {
      // Thread doesn't exist or is inaccessible
      console.log(`Thread ${threadId} validation failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Clean up stale thread references by validating all stored threads
   */
  async cleanupStaleThreads() {
    try {
      console.log('🧹 Cleaning up stale thread references...');
      const staleThreads = [];
      
      for (const [matchId, threadId] of this.db.matchThreads.entries()) {
        const isValid = await this.validateThread(threadId);
        if (!isValid) {
          staleThreads.push({ matchId, threadId });
        }
      }
      
      // Remove stale thread references
      for (const { matchId, threadId } of staleThreads) {
        console.log(`Removing stale thread reference: ${threadId} for match ${matchId}`);
        this.db.matchThreads.delete(matchId);
        await this.db.removeMatchThread(matchId);
      }
      
      console.log(`✅ Cleaned up ${staleThreads.length} stale thread references`);
      return staleThreads.length;
    } catch (err) {
      console.error(`Error during thread cleanup: ${err.message}`);
      return 0;
    }
  }

  /**
   * Create dynamic RSVP status display for thread welcome messages
   */
  createDynamicRsvpStatus(matchId) {
    try {
      const matchRsvps = this.db.getRsvpForMatch(matchId);
      const allUserMappings = this.db.userMappings;
      const registeredUsers = Object.values(allUserMappings);
      
      if (registeredUsers.length === 0) {
        return 'No team members registered yet. Use the buttons above to RSVP!';
      }
      
      // Categorize users by RSVP status
      const attendingPlayers = [];
      const notAttendingPlayers = [];
      const noResponsePlayers = [];
      
      registeredUsers.forEach(user => {
        const rsvp = matchRsvps[user.discord_id];
        if (rsvp) {
          if (rsvp.response === 'yes') {
            attendingPlayers.push(user.faceit_nickname);
          } else {
            notAttendingPlayers.push(user.faceit_nickname);
          }
        } else {
          noResponsePlayers.push(user.faceit_nickname);
        }
      });
      
      let statusText = '';
      
      if (attendingPlayers.length > 0) {
        statusText += `✅ **Attending (${attendingPlayers.length}):** ${attendingPlayers.join(', ')}\n\n`;
      }
      
      if (notAttendingPlayers.length > 0) {
        statusText += `❌ **Not Attending (${notAttendingPlayers.length}):** ${notAttendingPlayers.join(', ')}\n\n`;
      }
      
      if (noResponsePlayers.length > 0) {
        statusText += `⏳ **No Response (${noResponsePlayers.length}):** ${noResponsePlayers.join(', ')}`;
      }
      
      if (statusText === '') {
        statusText = 'No RSVPs yet. Use the buttons above to respond!';
      }
      
      return statusText;
      
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
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
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
}

module.exports = DiscordService;
