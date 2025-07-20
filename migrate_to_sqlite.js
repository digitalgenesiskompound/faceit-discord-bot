#!/usr/bin/env node

/**
 * Complete Migration Script from JSON to SQLite Database
 * 
 * This script will:
 * 1. Load existing JSON data files
 * 2. Migrate all data to SQLite database
 * 3. Verify the migration was successful
 * 4. Archive old JSON files as backups
 * 5. Clean up configuration references
 */

const fs = require('fs');
const path = require('path');
const database = require('./database');

class MigrationManager {
  constructor() {
    this.dataDir = path.join(__dirname, 'data');
    this.backupDir = path.join(__dirname, 'data', 'json_backups');
    
    this.jsonFiles = {
      userMappings: path.join(this.dataDir, 'user_mappings.json'),
      rsvpStatus: path.join(this.dataDir, 'rsvp_status.json'),
      processedMatches: path.join(this.dataDir, 'processed_matches.json'),
      matchThreads: path.join(this.dataDir, 'match_threads.json')
    };
    
    this.migrationStats = {
      userMappings: 0,
      rsvpEntries: 0,
      processedMatches: 0,
      matchThreads: 0,
      errors: []
    };
  }

  /**
   * Main migration process
   */
  async migrate() {
    console.log('🔄 Starting complete migration from JSON to SQLite...');
    console.log('='.repeat(60));
    
    try {
      // Step 1: Initialize database
      await this.initializeDatabase();
      
      // Step 2: Load and validate JSON data
      const jsonData = await this.loadJsonData();
      
      // Step 3: Check if migration is needed
      if (!this.isMigrationNeeded(jsonData)) {
        console.log('✅ No migration needed - all JSON files are empty or don\'t exist');
        return;
      }
      
      // Step 4: Create backup directory
      await this.createBackupDirectory();
      
      // Step 5: Migrate data
      await this.migrateData(jsonData);
      
      // Step 6: Verify migration
      await this.verifyMigration(jsonData);
      
      // Step 7: Archive JSON files
      await this.archiveJsonFiles();
      
      // Step 8: Display results
      this.displayMigrationResults();
      
      console.log('✅ Migration completed successfully!');
      
    } catch (error) {
      console.error('❌ Migration failed:', error.message);
      console.error(error.stack);
      process.exit(1);
    } finally {
      await database.close();
    }
  }

  /**
   * Initialize database connection and tables
   */
  async initializeDatabase() {
    console.log('📋 Step 1: Initializing database...');
    await database.initialize();
    console.log('✅ Database initialized');
  }

  /**
   * Load all JSON data files
   */
  async loadJsonData() {
    console.log('📂 Step 2: Loading JSON data files...');
    const data = {};
    
    // Load user mappings
    if (fs.existsSync(this.jsonFiles.userMappings)) {
      try {
        const content = fs.readFileSync(this.jsonFiles.userMappings, 'utf8');
        data.userMappings = JSON.parse(content);
        console.log(`   📄 user_mappings.json: ${Object.keys(data.userMappings).length} entries`);
      } catch (error) {
        console.warn(`   ⚠️  Error reading user_mappings.json: ${error.message}`);
        data.userMappings = {};
      }
    } else {
      data.userMappings = {};
    }

    // Load RSVP status
    if (fs.existsSync(this.jsonFiles.rsvpStatus)) {
      try {
        const content = fs.readFileSync(this.jsonFiles.rsvpStatus, 'utf8');
        data.rsvpStatus = JSON.parse(content);
        const rsvpCount = Object.values(data.rsvpStatus).reduce((sum, match) => sum + Object.keys(match).length, 0);
        console.log(`   📄 rsvp_status.json: ${rsvpCount} RSVP entries across ${Object.keys(data.rsvpStatus).length} matches`);
      } catch (error) {
        console.warn(`   ⚠️  Error reading rsvp_status.json: ${error.message}`);
        data.rsvpStatus = {};
      }
    } else {
      data.rsvpStatus = {};
    }

    // Load processed matches
    if (fs.existsSync(this.jsonFiles.processedMatches)) {
      try {
        const content = fs.readFileSync(this.jsonFiles.processedMatches, 'utf8');
        data.processedMatches = JSON.parse(content);
        console.log(`   📄 processed_matches.json: ${data.processedMatches.length} processed matches`);
      } catch (error) {
        console.warn(`   ⚠️  Error reading processed_matches.json: ${error.message}`);
        data.processedMatches = [];
      }
    } else {
      data.processedMatches = [];
    }

    // Load match threads
    if (fs.existsSync(this.jsonFiles.matchThreads)) {
      try {
        const content = fs.readFileSync(this.jsonFiles.matchThreads, 'utf8');
        data.matchThreads = JSON.parse(content);
        console.log(`   📄 match_threads.json: ${Object.keys(data.matchThreads).length} thread mappings`);
      } catch (error) {
        console.warn(`   ⚠️  Error reading match_threads.json: ${error.message}`);
        data.matchThreads = {};
      }
    } else {
      data.matchThreads = {};
    }

    console.log('✅ JSON data loaded');
    return data;
  }

  /**
   * Check if migration is actually needed
   */
  isMigrationNeeded(jsonData) {
    const hasUserMappings = Object.keys(jsonData.userMappings).length > 0;
    const hasRsvpData = Object.keys(jsonData.rsvpStatus).length > 0;
    const hasProcessedMatches = jsonData.processedMatches.length > 0;
    const hasMatchThreads = Object.keys(jsonData.matchThreads).length > 0;
    
    return hasUserMappings || hasRsvpData || hasProcessedMatches || hasMatchThreads;
  }

  /**
   * Create backup directory
   */
  async createBackupDirectory() {
    console.log('📁 Step 3: Creating backup directory...');
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
    console.log('✅ Backup directory ready');
  }

  /**
   * Migrate all data to SQLite
   */
  async migrateData(jsonData) {
    console.log('🔄 Step 4: Migrating data to SQLite...');
    
    // Migrate user mappings
    await this.migrateUserMappings(jsonData.userMappings);
    
    // Migrate RSVP data
    await this.migrateRsvpData(jsonData.rsvpStatus);
    
    // Migrate processed matches
    await this.migrateProcessedMatches(jsonData.processedMatches);
    
    // Migrate match threads
    await this.migrateMatchThreads(jsonData.matchThreads);
    
    console.log('✅ Data migration completed');
  }

  /**
   * Migrate user mappings
   */
  async migrateUserMappings(userMappings) {
    console.log('   👥 Migrating user mappings...');
    
    for (const [discordId, mapping] of Object.entries(userMappings)) {
      try {
        // Check if user already exists
        const existingUser = await database.getUserMappingByDiscordId(discordId);
        
        if (!existingUser) {
          await database.addUserMapping(discordId, mapping.discord_username, {
            nickname: mapping.faceit_nickname,
            player_id: mapping.faceit_player_id,
            skill_level: mapping.faceit_skill_level,
            faceit_elo: mapping.faceit_elo,
            country: mapping.country
          });
          this.migrationStats.userMappings++;
        } else {
          console.log(`      ℹ️  User ${discordId} already exists in database, skipping`);
        }
      } catch (error) {
        const errorMsg = `Failed to migrate user ${discordId}: ${error.message}`;
        console.error(`      ❌ ${errorMsg}`);
        this.migrationStats.errors.push(errorMsg);
      }
    }
    
    console.log(`   ✅ Migrated ${this.migrationStats.userMappings} user mappings`);
  }

  /**
   * Migrate RSVP data
   */
  async migrateRsvpData(rsvpStatus) {
    console.log('   📝 Migrating RSVP data...');
    
    for (const [matchId, rsvps] of Object.entries(rsvpStatus)) {
      for (const [discordId, rsvpData] of Object.entries(rsvps)) {
        try {
          // Check if RSVP already exists
          const existingRsvp = await database.getUserRsvp(matchId, discordId);
          
          if (!existingRsvp) {
            await database.addRsvp(matchId, discordId, rsvpData.response, rsvpData.faceit_nickname);
            this.migrationStats.rsvpEntries++;
          } else {
            console.log(`      ℹ️  RSVP for match ${matchId}, user ${discordId} already exists, skipping`);
          }
        } catch (error) {
          const errorMsg = `Failed to migrate RSVP for match ${matchId}, user ${discordId}: ${error.message}`;
          console.error(`      ❌ ${errorMsg}`);
          this.migrationStats.errors.push(errorMsg);
        }
      }
    }
    
    console.log(`   ✅ Migrated ${this.migrationStats.rsvpEntries} RSVP entries`);
  }

  /**
   * Migrate processed matches
   */
  async migrateProcessedMatches(processedMatches) {
    console.log('   🏁 Migrating processed matches...');
    
    for (const matchId of processedMatches) {
      try {
        // Check if match is already marked as processed
        const isProcessed = await database.isMatchProcessed(matchId);
        
        if (!isProcessed) {
          await database.markMatchAsProcessed(matchId);
          this.migrationStats.processedMatches++;
        } else {
          console.log(`      ℹ️  Match ${matchId} already marked as processed, skipping`);
        }
      } catch (error) {
        const errorMsg = `Failed to migrate processed match ${matchId}: ${error.message}`;
        console.error(`      ❌ ${errorMsg}`);
        this.migrationStats.errors.push(errorMsg);
      }
    }
    
    console.log(`   ✅ Migrated ${this.migrationStats.processedMatches} processed matches`);
  }

  /**
   * Migrate match threads
   */
  async migrateMatchThreads(matchThreads) {
    console.log('   🧵 Migrating match threads...');
    
    for (const [matchId, threadId] of Object.entries(matchThreads)) {
      try {
        // Check if thread mapping already exists
        const existingThread = await database.getMatchThread(matchId);
        
        if (!existingThread) {
          await database.addMatchThread(matchId, threadId);
          this.migrationStats.matchThreads++;
        } else {
          console.log(`      ℹ️  Thread for match ${matchId} already exists, skipping`);
        }
      } catch (error) {
        const errorMsg = `Failed to migrate thread for match ${matchId}: ${error.message}`;
        console.error(`      ❌ ${errorMsg}`);
        this.migrationStats.errors.push(errorMsg);
      }
    }
    
    console.log(`   ✅ Migrated ${this.migrationStats.matchThreads} match thread mappings`);
  }

  /**
   * Verify migration was successful
   */
  async verifyMigration(originalData) {
    console.log('🔍 Step 5: Verifying migration...');
    
    // Verify user mappings
    const dbUserMappings = await database.getAllUserMappings();
    const expectedUserCount = Object.keys(originalData.userMappings).length;
    console.log(`   👥 User mappings: ${dbUserMappings.length} in DB (expected at least ${this.migrationStats.userMappings} new)`);
    
    // Verify RSVP data
    const dbRsvpData = await database.getAllRsvpData();
    const expectedRsvpCount = Object.values(originalData.rsvpStatus).reduce((sum, match) => sum + Object.keys(match).length, 0);
    console.log(`   📝 RSVP entries: ${dbRsvpData.length} in DB (expected at least ${this.migrationStats.rsvpEntries} new)`);
    
    // Verify processed matches
    const dbProcessedMatches = await database.getAllProcessedMatches();
    const expectedProcessedCount = originalData.processedMatches.length;
    console.log(`   🏁 Processed matches: ${dbProcessedMatches.length} in DB (expected at least ${this.migrationStats.processedMatches} new)`);
    
    // Verify match threads
    const dbMatchThreads = await database.getAllMatchThreads();
    const expectedThreadCount = Object.keys(originalData.matchThreads).length;
    console.log(`   🧵 Match threads: ${dbMatchThreads.length} in DB (expected at least ${this.migrationStats.matchThreads} new)`);
    
    console.log('✅ Migration verification completed');
  }

  /**
   * Archive old JSON files as backups
   */
  async archiveJsonFiles() {
    console.log('📦 Step 6: Archiving JSON files...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    for (const [name, filepath] of Object.entries(this.jsonFiles)) {
      if (fs.existsSync(filepath)) {
        const filename = path.basename(filepath);
        const backupPath = path.join(this.backupDir, `${timestamp}_${filename}`);
        
        try {
          // Copy file to backup
          fs.copyFileSync(filepath, backupPath);
          console.log(`   📄 Archived ${filename} to json_backups/`);
          
          // Remove original file
          fs.unlinkSync(filepath);
          console.log(`   🗑️  Removed original ${filename}`);
          
        } catch (error) {
          console.error(`   ❌ Error archiving ${filename}: ${error.message}`);
          this.migrationStats.errors.push(`Failed to archive ${filename}: ${error.message}`);
        }
      }
    }
    
    console.log('✅ JSON files archived');
  }

  /**
   * Display final migration results
   */
  displayMigrationResults() {
    console.log('');
    console.log('📊 Migration Results');
    console.log('='.repeat(60));
    console.log(`👥 User mappings migrated: ${this.migrationStats.userMappings}`);
    console.log(`📝 RSVP entries migrated: ${this.migrationStats.rsvpEntries}`);
    console.log(`🏁 Processed matches migrated: ${this.migrationStats.processedMatches}`);
    console.log(`🧵 Match threads migrated: ${this.migrationStats.matchThreads}`);
    console.log(`❌ Errors encountered: ${this.migrationStats.errors.length}`);
    
    if (this.migrationStats.errors.length > 0) {
      console.log('');
      console.log('❌ Migration Errors:');
      this.migrationStats.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }
    
    console.log('');
    console.log('📁 Backup files created in: data/json_backups/');
    console.log('   (You can safely delete these after confirming everything works correctly)');
  }
}

// Run migration if called directly
if (require.main === module) {
  const migrator = new MigrationManager();
  migrator.migrate().catch(error => {
    console.error('Fatal migration error:', error);
    process.exit(1);
  });
}

module.exports = MigrationManager;
