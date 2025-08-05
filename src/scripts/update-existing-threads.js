#!/usr/bin/env node

/**
 * Script to add Analyze buttons to existing INCOMING threads
 * This is a one-time update script for existing match threads
 */

const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const DatabaseService = require('./src/services/databaseService');
const config = require('./src/config/config');

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

  async updateExistingThreads() {
    try {
      console.log('🔍 Finding existing INCOMING threads...');
      
      // Get all upcoming threads from database
      const upcomingThreads = await this.db.db.getThreadsByType('upcoming');
      console.log(`Found ${upcomingThreads.length} INCOMING threads in database`);

      let updatedCount = 0;
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

          // Check if thread already has an Analyze button
          const messages = await thread.messages.fetch({ limit: 10 });
          let hasAnalyzeButton = false;

          for (const message of messages.values()) {
            if (message.author.id === this.client.user.id && message.components.length > 0) {
              for (const component of message.components) {
                if (component.components) {
                  for (const button of component.components) {
                    if (button.customId && button.customId.startsWith('analyze_enemy_')) {
                      hasAnalyzeButton = true;
                      break;
                    }
                  }
                }
              }
            }
            if (hasAnalyzeButton) break;
          }

          if (hasAnalyzeButton) {
            console.log(`✅ Thread already has Analyze button, skipping`);
            continue;
          }

          // Add Analyze button
          const analyzeButtonRow = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(`analyze_enemy_${threadRecord.match_id}`)
                .setLabel('🔍 Analyze Enemy Team')
                .setStyle(ButtonStyle.Primary)
            );

          await thread.send({
            content: '🎯 **Enemy Team Analysis Available**\nClick the button below to get detailed stats and tactical insights about your opponents:',
            components: [analyzeButtonRow]
          });

          console.log(`✅ Added Analyze button to thread: ${thread.name}`);
          updatedCount++;

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (threadError) {
          console.error(`❌ Error updating thread ${threadRecord.thread_id}:`, threadError.message);
          errorCount++;
        }
      }

      console.log(`\n📊 Update Summary:`);
      console.log(`   - Threads processed: ${upcomingThreads.length}`);
      console.log(`   - Successfully updated: ${updatedCount}`);
      console.log(`   - Errors: ${errorCount}`);

      return { total: upcomingThreads.length, updated: updatedCount, errors: errorCount };

    } catch (error) {
      console.error('❌ Error during thread update process:', error);
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
    
    const results = await updater.updateExistingThreads();
    
    console.log('\n✅ Thread update process completed successfully!');
    console.log(`Updated ${results.updated} threads with Analyze buttons`);
    
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
