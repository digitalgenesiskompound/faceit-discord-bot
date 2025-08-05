/**
 * Backup Helper
 * 
 * Simple helper for creating and managing database backups for recovery.
 * Keeps it simple - just backup/restore functionality.
 */

const fs = require('fs').promises;
const path = require('path');

class BackupHelper {
  constructor() {
    this.backupDir = path.join(process.cwd(), 'data', 'backups');
    this.dbPath = path.join(process.cwd(), 'data', 'bot.db');
  }

  /**
   * Create a backup of the current database
   * @param {string} reason - Reason for backup (optional)
   * @returns {string} Backup filename
   */
  async createBackup(reason = 'manual') {
    try {
      // Ensure backup directory exists
      await fs.mkdir(this.backupDir, { recursive: true });

      // Create backup filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFilename = `bot_backup_${timestamp}_${reason}.db`;
      const backupPath = path.join(this.backupDir, backupFilename);

      // Copy database file
      await fs.copyFile(this.dbPath, backupPath);

      console.log(`✅ Database backup created: ${backupFilename}`);
      return backupFilename;

    } catch (error) {
      console.error('❌ Error creating backup:', error.message);
      throw error;
    }
  }

  /**
   * List available backups
   * @returns {Array} List of backup files with metadata
   */
  async listBackups() {
    try {
      const files = await fs.readdir(this.backupDir);
      const backups = [];

      for (const file of files) {
        if (file.endsWith('.db')) {
          const filePath = path.join(this.backupDir, file);
          const stats = await fs.stat(filePath);
          
          backups.push({
            filename: file,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime
          });
        }
      }

      // Sort by creation date (newest first)
      return backups.sort((a, b) => b.created - a.created);

    } catch (error) {
      console.error('❌ Error listing backups:', error.message);
      return [];
    }
  }

  /**
   * Restore from a backup file
   * @param {string} backupFilename - Backup file to restore from
   * @returns {boolean} Success status
   */
  async restoreFromBackup(backupFilename) {
    try {
      const backupPath = path.join(this.backupDir, backupFilename);
      
      // Check if backup exists
      await fs.access(backupPath);

      // Create a backup of current database before restoration
      await this.createBackup('pre_restore');

      // Restore the backup
      await fs.copyFile(backupPath, this.dbPath);

      console.log(`✅ Database restored from backup: ${backupFilename}`);
      return true;

    } catch (error) {
      console.error('❌ Error restoring from backup:', error.message);
      return false;
    }
  }

  /**
   * Clean up old backups (keep only recent ones)
   * @param {number} keepCount - Number of backups to keep
   */
  async cleanupOldBackups(keepCount = 10) {
    try {
      const backups = await this.listBackups();
      
      if (backups.length <= keepCount) {
        console.log(`📁 ${backups.length} backups found, no cleanup needed`);
        return;
      }

      // Remove old backups
      const toDelete = backups.slice(keepCount);
      let deletedCount = 0;

      for (const backup of toDelete) {
        try {
          const backupPath = path.join(this.backupDir, backup.filename);
          await fs.unlink(backupPath);
          deletedCount++;
        } catch (deleteError) {
          console.error(`Failed to delete backup ${backup.filename}:`, deleteError.message);
        }
      }

      console.log(`🧹 Cleaned up ${deletedCount} old backups (kept ${keepCount} recent ones)`);

    } catch (error) {
      console.error('❌ Error cleaning up backups:', error.message);
    }
  }
}

module.exports = BackupHelper;
