#!/usr/bin/env node

/**
 * Simple backup restoration script for the FACEIT Discord Bot
 * This script allows you to restore a backup before starting the container
 */

const fs = require('fs').promises;
const path = require('path');
const BackupService = require('./src/services/BackupService');

async function listAvailableBackups() {
  try {
    const backupService = new BackupService();
    const backups = await backupService.listBackups();
    
    if (backups.length === 0) {
      console.log('❌ No backups found in ./backups directory');
      return [];
    }
    
    console.log('📁 Available backups:');
    console.log('');
    
    backups.forEach((backup, index) => {
      const date = new Date(backup.created).toLocaleString();
      const timestamp = path.basename(backup.name, '.db').replace('bot_backup_', '');
      console.log(`${index + 1}. ${backup.name}`);
      console.log(`   📅 Created: ${date}`);
      console.log(`   💾 Size: ${backup.sizeFormatted}`);
      console.log(`   🔢 Timestamp: ${timestamp}`);
      console.log('');
    });
    
    return backups;
  } catch (error) {
    console.error(`❌ Error listing backups: ${error.message}`);
    return [];
  }
}

async function restoreBackup(backupPath) {
  try {
    const backupService = new BackupService();
    
    console.log(`🔄 Restoring backup: ${backupPath}`);
    
    // Verify backup exists
    try {
      await fs.access(backupPath);
    } catch (error) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }
    
    // Restore the backup
    await backupService.restoreFromBackup(backupPath, true);
    
    console.log('✅ Backup restored successfully!');
    console.log('');
    console.log('The database has been restored. You can now start the Discord bot.');
    
  } catch (error) {
    console.error(`❌ Failed to restore backup: ${error.message}`);
    process.exit(1);
  }
}

async function main() {
  console.log('🔧 FACEIT Discord Bot - Backup Restoration Tool');
  console.log('==============================================');
  console.log('');
  
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node restore-backup.js list                    # List available backups');
    console.log('  node restore-backup.js <backup_filename>       # Restore specific backup');
    console.log('  node restore-backup.js <backup_timestamp>      # Restore by timestamp');
    console.log('');
    console.log('Examples:');
    console.log('  node restore-backup.js list');
    console.log('  node restore-backup.js bot_backup_1737394800.db');
    console.log('  node restore-backup.js 1737394800');
    console.log('');
    await listAvailableBackups();
    return;
  }
  
  const command = args[0];
  
  if (command === 'list') {
    await listAvailableBackups();
    return;
  }
  
  // Determine backup path
  let backupPath;
  
  if (command.includes('.db')) {
    // Full filename provided
    backupPath = path.join('./backups', command);
  } else if (/^\d+$/.test(command)) {
    // Timestamp provided
    backupPath = path.join('./backups', `bot_backup_${command}.db`);
  } else {
    console.error('❌ Invalid backup identifier. Use filename or timestamp.');
    process.exit(1);
  }
  
  await restoreBackup(backupPath);
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  });
}

module.exports = { listAvailableBackups, restoreBackup };
