const path = require('path');
const fs = require('fs').promises;
const sqlite3 = require('sqlite3').verbose();
const errorHandler = require('../utils/errorHandler');

/**
 * Service for handling SQLite database backups with proper locking
 */
class BackupService {
  constructor() {
    this.dbPath = path.join(__dirname, '../../data/bot.db');
    // Use the backup directory that matches Docker Compose mapping
    // ./backups (host) -> /app/backups (container)
    // Clean direct mapping without nested paths
    this.backupDir = path.join(__dirname, '../../backups');
    this.isBackupRunning = false;
    this.backupInterval = null;
  }

  /**
   * Initialize backup service and ensure backup directory exists
   */
  async initialize() {
    try {
      // Ensure backup directory exists with proper permissions
      await fs.mkdir(this.backupDir, { recursive: true, mode: 0o755 });
      
      // Test write permissions by creating and deleting a test file
      const testFile = path.join(this.backupDir, '.write_test');
      try {
        await fs.writeFile(testFile, 'test');
        await fs.unlink(testFile);
        console.log('✅ Backup service initialized, backup directory ready with write permissions');
      } catch (permError) {
        throw new Error(`Backup directory exists but is not writable: ${permError.message}`);
      }
      
      // Start periodic backups
      this.startPeriodicBackups();
      
      errorHandler.logger.info('Backup service initialized successfully');
    } catch (error) {
      console.error('❌ Error initializing backup service:', error.message);
      console.error('💡 If running in Docker, ensure the backup directory has proper permissions');
      errorHandler.logger.error('Failed to initialize backup service', { 
        error: error.message,
        stack: error.stack,
        backupDir: this.backupDir 
      });
      throw error;
    }
  }

  /**
   * Start periodic database backups (every 6 hours)
   */
  startPeriodicBackups() {
    // Run backup every 6 hours (6 * 60 * 60 * 1000 ms)
    this.backupInterval = setInterval(() => {
      this.performBackup('scheduled');
    }, 6 * 60 * 60 * 1000);

    // Also do an initial backup on startup (after 5 minutes to let bot settle)
    setTimeout(() => {
      this.performBackup('startup');
    }, 5 * 60 * 1000);

    console.log('📅 Scheduled database backups configured (every 6 hours)');
    errorHandler.logger.info('Periodic database backups started');
  }

  /**
   * Stop periodic backups
   */
  stopPeriodicBackups() {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = null;
      console.log('📴 Periodic database backups stopped');
      errorHandler.logger.info('Periodic database backups stopped');
    }
  }

  /**
   * Perform a database backup using SQLite's VACUUM INTO command for safe backup
   * This ensures data consistency and proper locking
   */
  async performBackup(triggerType = 'manual') {
    if (this.isBackupRunning) {
      console.log('⚠️ Backup already in progress, skipping...');
      return false;
    }

    this.isBackupRunning = true;
    const startTime = Date.now();
    
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const backupFileName = `bot_backup_${timestamp}.db`;
      const backupPath = path.join(this.backupDir, backupFileName);
      
      console.log(`🔄 Starting ${triggerType} database backup...`);
      console.log(`📁 Backup location: ${backupPath}`);

      // Check if source database exists and is accessible
      try {
        await fs.access(this.dbPath);
      } catch (error) {
        throw new Error(`Source database not accessible: ${this.dbPath}`);
      }

      // Use SQLite's VACUUM INTO for safe backup with proper locking
      await this.createSafeBackup(backupPath);
      
      // Verify backup was created and is valid
      const backupStats = await this.verifyBackup(backupPath);
      
      const duration = Date.now() - startTime;
      console.log(`✅ Database backup completed successfully`);
      console.log(`📊 Backup size: ${(backupStats.size / 1024 / 1024).toFixed(2)} MB`);
      console.log(`⏱️ Duration: ${duration}ms`);

      // Clean up old backups (keep only last 5 for all backup types)
      const keepCount = 5;
      await this.cleanupOldBackups(keepCount);

      errorHandler.logger.info('Database backup completed successfully', {
        triggerType,
        backupPath,
        backupSize: backupStats.size,
        duration,
        timestamp
      });

      return {
        success: true,
        backupPath,
        size: backupStats.size,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Database backup failed after ${duration}ms:`, error.message);
      
      errorHandler.logger.error('Database backup failed', {
        triggerType,
        error: error.message,
        stack: error.stack,
        duration
      });

      return {
        success: false,
        error: error.message,
        duration
      };
    } finally {
      this.isBackupRunning = false;
    }
  }

  /**
   * Create a safe backup using SQLite's VACUUM INTO command
   * This ensures the database is not corrupted during backup
   */
  async createSafeBackup(backupPath) {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
          reject(new Error(`Failed to open source database: ${err.message}`));
          return;
        }

        // Use VACUUM INTO for atomic backup with proper locking
        // This command creates a complete backup while ensuring data consistency
        db.run(`VACUUM INTO ?`, [backupPath], function(err) {
          if (err) {
            db.close();
            reject(new Error(`VACUUM INTO failed: ${err.message}`));
            return;
          }

          db.close((closeErr) => {
            if (closeErr) {
              console.warn(`Warning: Error closing source database: ${closeErr.message}`);
            }
            resolve();
          });
        });
      });
    });
  }

  /**
   * Verify that the backup file was created successfully and is valid
   */
  async verifyBackup(backupPath) {
    try {
      // Check if backup file exists and get its stats
      const backupStats = await fs.stat(backupPath);
      
      if (backupStats.size === 0) {
        throw new Error('Backup file is empty');
      }

      // Verify the backup is a valid SQLite database by opening it
      await new Promise((resolve, reject) => {
        const testDb = new sqlite3.Database(backupPath, sqlite3.OPEN_READONLY, (err) => {
          if (err) {
            reject(new Error(`Backup verification failed: ${err.message}`));
            return;
          }

          // Run a simple query to ensure database integrity
          testDb.get('SELECT COUNT(*) as count FROM sqlite_master WHERE type="table"', (err, row) => {
            testDb.close();
            
            if (err) {
              reject(new Error(`Backup integrity check failed: ${err.message}`));
              return;
            }

            if (typeof row.count !== 'number') {
              reject(new Error('Backup appears to be corrupted'));
              return;
            }

            resolve();
          });
        });
      });

      return backupStats;
    } catch (error) {
      // Clean up invalid backup file
      try {
        await fs.unlink(backupPath);
      } catch (unlinkError) {
        console.warn(`Warning: Failed to clean up invalid backup: ${unlinkError.message}`);
      }
      throw error;
    }
  }

  /**
   * Clean up old backup files, keeping only the most recent ones
   */
  async cleanupOldBackups(keepCount = 5) {
    try {
      const files = await fs.readdir(this.backupDir);
      const backupFiles = files
        .filter(file => file.startsWith('bot_backup_') && file.endsWith('.db'))
        .map(file => ({
          name: file,
          path: path.join(this.backupDir, file)
        }));

      if (backupFiles.length <= keepCount) {
        return; // No cleanup needed
      }

      // Get file stats for sorting by creation time
      const filesWithStats = await Promise.all(
        backupFiles.map(async file => {
          const stats = await fs.stat(file.path);
          return {
            ...file,
            mtime: stats.mtime
          };
        })
      );

      // Sort by modification time (newest first)
      filesWithStats.sort((a, b) => b.mtime - a.mtime);

      // Remove old backups
      const filesToDelete = filesWithStats.slice(keepCount);
      let deletedCount = 0;
      let deletedSize = 0;

      for (const file of filesToDelete) {
        try {
          const stats = await fs.stat(file.path);
          await fs.unlink(file.path);
          deletedCount++;
          deletedSize += stats.size;
          console.log(`🗑️ Deleted old backup: ${file.name}`);
        } catch (error) {
          console.warn(`Warning: Failed to delete old backup ${file.name}:`, error.message);
        }
      }

      if (deletedCount > 0) {
        console.log(`🧹 Cleaned up ${deletedCount} old backup(s), freed ${(deletedSize / 1024 / 1024).toFixed(2)} MB`);
        errorHandler.logger.info('Old backups cleaned up', {
          deletedCount,
          freedSpace: deletedSize,
          remainingCount: filesWithStats.length - deletedCount
        });
      }

    } catch (error) {
      console.warn('Warning: Backup cleanup failed:', error.message);
      errorHandler.logger.warn('Backup cleanup failed', { error: error.message });
    }
  }

  /**
   * List all available backup files
   */
  async listBackups() {
    try {
      const files = await fs.readdir(this.backupDir);
      const backupFiles = files
        .filter(file => file.startsWith('bot_backup_') && file.endsWith('.db'))
        .map(file => path.join(this.backupDir, file));

      const backupsWithInfo = await Promise.all(
        backupFiles.map(async filePath => {
          const stats = await fs.stat(filePath);
          return {
            path: filePath,
            name: path.basename(filePath),
            size: stats.size,
            created: stats.mtime,
            sizeFormatted: (stats.size / 1024 / 1024).toFixed(2) + ' MB'
          };
        })
      );

      // Sort by creation time (newest first)
      backupsWithInfo.sort((a, b) => b.created - a.created);

      return backupsWithInfo;
    } catch (error) {
      errorHandler.logger.error('Failed to list backups', { error: error.message });
      throw error;
    }
  }

  /**
   * Restore database from a backup file
   * WARNING: This will overwrite the current database!
   */
  async restoreFromBackup(backupPath, createBackupBeforeRestore = true) {
    if (this.isBackupRunning) {
      throw new Error('Cannot restore while backup is in progress');
    }

    try {
      // Verify backup file exists and is valid
      await fs.access(backupPath);
      await this.verifyBackup(backupPath);

      // Create a backup of current database before restoring
      if (createBackupBeforeRestore) {
        console.log('📋 Creating pre-restore backup...');
        await this.performBackup('pre-restore');
      }

      // Copy backup to main database location
      console.log(`🔄 Restoring database from: ${backupPath}`);
      await fs.copyFile(backupPath, this.dbPath);
      
      console.log('✅ Database restored successfully');
      errorHandler.logger.info('Database restored from backup', { backupPath });

      return { success: true };
    } catch (error) {
      console.error('❌ Database restore failed:', error.message);
      errorHandler.logger.error('Database restore failed', { 
        error: error.message,
        backupPath 
      });
      throw error;
    }
  }

  /**
   * Get backup service status and statistics
   */
  async getStatus() {
    try {
      const backups = await this.listBackups();
      const backupDirStats = await fs.stat(this.backupDir);
      
      return {
        isRunning: this.isBackupRunning,
        periodicBackupsEnabled: !!this.backupInterval,
        backupDirectory: this.backupDir,
        totalBackups: backups.length,
        latestBackup: backups[0] || null,
        oldestBackup: backups[backups.length - 1] || null,
        totalBackupSize: backups.reduce((sum, backup) => sum + backup.size, 0),
        backupDirectoryExists: true
      };
    } catch (error) {
      return {
        isRunning: this.isBackupRunning,
        periodicBackupsEnabled: !!this.backupInterval,
        backupDirectory: this.backupDir,
        error: error.message
      };
    }
  }

  /**
   * Shutdown the backup service
   */
  shutdown() {
    this.stopPeriodicBackups();
    console.log('📴 Backup service shut down');
    errorHandler.logger.info('Backup service shut down');
  }
}

module.exports = BackupService;
