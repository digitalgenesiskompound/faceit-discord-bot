#!/usr/bin/env node

/**
 * Script to clean up redundant Analyze buttons from existing INCOMING threads
 * Analyze buttons are now included in the main notification message
 */

const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const DatabaseService = require('../services/databaseService');
const config = require('../config/config');

class ThreadUpdater {
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });
    
    this.db = new DatabaseService();
  }

  async initialize() {
    await this.db.initialize();
    await this.client.login(config.discord.botToken);
    console.log('✅ Bot logged in successfully');
  }

  async cleanupRedundantButtons() {
    try {
      console.log('🔍 Finding existing INCOMING threads with redundant Analyze buttons...');
      
      // Get all upcoming threads from database
      const upcomingThreads = await this.db.db.getThreadsByType('upcoming');
      console.log(`Found ${upcomingThreads.length} INCOMING threads in database`);

      let cleanedCount = 0;
      let errorCount = 0;

      for (const threadRecord of upcomingThreads) {
        try {
          console.log(`\n🔍 Processing thread: ${threadRecord.thread_id} (Match: ${threadRecord.match_id})`);
          
          // Fetch the thread
          const thread = await this.client.channels.fetch(threadRecord.thread_id);
          if (!thread) {
            console.log(`❌ Could not fetch thread ${threadRecord.thread_id}`);
            errorCount++;
            continue;
          }

          console.log(`📋 Thread found: "${thread.name}"`);

          // Find messages with Analyze buttons to remove
          const messages = await thread.messages.fetch({ limit: 50 });
          let messagesWithAnalyzeButtons = [];

          for (const message of messages.values()) {
            if (message.author.id === this.client.user.id && message.components.length > 0) {
              for (const component of message.components) {
                if (component.components) {
                  for (const button of component.components) {
                    if (button.customId && button.customId.startsWith('analyze_enemy_')) {
                      // Check if this message ONLY contains analyze button (redundant)
                      if (message.content.includes('Enemy Team Analysis Available') || 
                          message.content.includes('Analyze the enemy team!')) {
                        messagesWithAnalyzeButtons.push(message);
                        break;
                      }
                    }
                  }
                }
              }
            }
          }

          if (messagesWithAnalyzeButtons.length === 0) {
            console.log(`✅ No redundant Analyze buttons found in thread`);
            continue;
          }

          // Delete redundant analyze button messages
          for (const messageToDelete of messagesWithAnalyzeButtons) {
            try {
              await messageToDelete.delete();
              console.log(`🗑️ Removed redundant Analyze button message`);
              cleanedCount++;
            } catch (deleteError) {
              console.error(`Error deleting message: ${deleteError.message}`);
            }
          }

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (threadError) {
          console.error(`❌ Error processing thread ${threadRecord.thread_id}:`, threadError.message);
          errorCount++;
        }
      }

      console.log(`\n📊 Cleanup Summary:`);
      console.log(`   - Threads processed: ${upcomingThreads.length}`);
      console.log(`   - Redundant messages removed: ${cleanedCount}`);
      console.log(`   - Errors: ${errorCount}`);

      return { total: upcomingThreads.length, cleaned: cleanedCount, errors: errorCount };

    } catch (error) {
      console.error('❌ Error during thread cleanup process:', error);
      throw error;
    }
  }

  async cleanup() {
    await this.client.destroy();
    await this.db.close();
    console.log('🧹 Cleanup completed');
  }
}

// Run the updater
async function main() {
  const updater = new ThreadUpdater();
  
  try {
    console.log('🚀 Starting thread update process...');
    await updater.initialize();
    
    const results = await updater.cleanupRedundantButtons();
    
    console.log('\n✅ Thread cleanup process completed successfully!');
    console.log(`Cleaned up ${results.cleaned} redundant Analyze button messages`);
    
  } catch (error) {
    console.error('❌ Thread update process failed:', error);
    process.exit(1);
  } finally {
    await updater.cleanup();
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  main();
}

module.exports = ThreadUpdater;
