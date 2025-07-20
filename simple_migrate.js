const fs = require('fs');
const path = require('path');
const database = require('./database');

async function migrateJsonData() {
  console.log('🔄 Starting JSON to SQLite migration...');
  
  try {
    // Initialize database
    await database.initialize();
    console.log('✅ Database initialized');
    
    // Load JSON data
    const dataDir = path.join(__dirname, 'data');
    const jsonData = {};
    
    // Load user mappings
    const userMappingsPath = path.join(dataDir, 'user_mappings.json');
    if (fs.existsSync(userMappingsPath)) {
      const content = fs.readFileSync(userMappingsPath, 'utf8');
      jsonData.userMappings = JSON.parse(content);
      console.log(`📄 Loaded ${Object.keys(jsonData.userMappings).length} user mappings`);
    }
    
    // Load RSVP data
    const rsvpPath = path.join(dataDir, 'rsvp_status.json');
    if (fs.existsSync(rsvpPath)) {
      const content = fs.readFileSync(rsvpPath, 'utf8');
      jsonData.rsvpStatus = JSON.parse(content);
      const rsvpCount = Object.values(jsonData.rsvpStatus).reduce((sum, match) => sum + Object.keys(match).length, 0);
      console.log(`📄 Loaded ${rsvpCount} RSVP entries`);
    }
    
    // Load processed matches
    const processedPath = path.join(dataDir, 'processed_matches.json');
    if (fs.existsSync(processedPath)) {
      const content = fs.readFileSync(processedPath, 'utf8');
      jsonData.processedMatches = JSON.parse(content);
      console.log(`📄 Loaded ${jsonData.processedMatches.length} processed matches`);
    }
    
    // Load match threads (if exists)
    const threadsPath = path.join(dataDir, 'match_threads.json');
    if (fs.existsSync(threadsPath)) {
      const content = fs.readFileSync(threadsPath, 'utf8');
      jsonData.matchThreads = JSON.parse(content);
      console.log(`📄 Loaded ${Object.keys(jsonData.matchThreads).length} match threads`);
    }
    
    // Use the existing migration method
    await database.migrateFromJson(jsonData);
    
    // Create backup directory
    const backupDir = path.join(dataDir, 'json_backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    // Archive JSON files
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filesToArchive = ['user_mappings.json', 'rsvp_status.json', 'processed_matches.json', 'match_threads.json'];
    
    for (const filename of filesToArchive) {
      const filepath = path.join(dataDir, filename);
      if (fs.existsSync(filepath)) {
        const backupPath = path.join(backupDir, `${timestamp}_${filename}`);
        fs.copyFileSync(filepath, backupPath);
        fs.unlinkSync(filepath);
        console.log(`📦 Archived ${filename}`);
      }
    }
    
    console.log('✅ Migration completed successfully!');
    console.log('📁 JSON backups stored in: data/json_backups/');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
  } finally {
    await database.close();
  }
}

migrateJsonData();
