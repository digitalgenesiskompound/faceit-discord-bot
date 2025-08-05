/**
 * Recovery Service
 * 
 * Orchestrates data recovery from Discord content when database is empty or incomplete.
 * Coordinates between different recovery modules to restore user mappings and RSVP data.
 */

const RsvpRecoveryService = require('./recovery/rsvpRecoveryService');
const UserMappingRecoveryService = require('./recovery/userMappingRecoveryService');
const InteractionLogService = require('./recovery/interactionLogService');

class RecoveryService {
  constructor(client, databaseService) {
    this.client = client;
    this.db = databaseService;
    
    // Initialize recovery modules
    this.rsvpRecovery = new RsvpRecoveryService(client, databaseService);
    this.userMappingRecovery = new UserMappingRecoveryService(client, databaseService);
    this.interactionLog = new InteractionLogService(databaseService);
  }

  /**
   * Perform comprehensive data recovery from Discord content
   * @param {Object} options - Recovery options
   * @returns {Object} Recovery results summary
   */
  async performComprehensiveRecovery(options = {}) {
    const {
      recoverUserMappings = true,
      recoverRsvpData = true,
      scanDepthDays = 30,
      dryRun = false
    } = options;

    console.log('🔄 Starting comprehensive data recovery from Discord content...');
    console.log(`   Scan depth: ${scanDepthDays} days`);
    console.log(`   Dry run mode: ${dryRun ? 'ON' : 'OFF'}`);

    const results = {
      userMappings: { recovered: 0, errors: 0, details: [] },
      rsvpData: { recovered: 0, errors: 0, details: [] },
      interactionHistory: { recovered: 0, errors: 0, details: [] },
      summary: {}
    };

    try {
      // Step 1: Recover user mappings from Discord interactions
      if (recoverUserMappings) {
        console.log('👥 Recovering user mappings from Discord interactions...');
        const userMappingResults = await this.userMappingRecovery.recoverUserMappingsFromDiscord({
          scanDepthDays,
          dryRun
        });
        results.userMappings = userMappingResults;
        console.log(`✅ User mapping recovery: ${userMappingResults.recovered} recovered, ${userMappingResults.errors} errors`);
      }

      // Step 2: Recover RSVP data from thread messages
      if (recoverRsvpData) {
        console.log('📋 Recovering RSVP data from thread messages...');
        const rsvpResults = await this.rsvpRecovery.recoverRsvpDataFromThreads({
          scanDepthDays,
          dryRun
        });
        results.rsvpData = rsvpResults;
        console.log(`✅ RSVP recovery: ${rsvpResults.recovered} recovered, ${rsvpResults.errors} errors`);
      }

      // Step 3: Recover interaction history for future reference
      console.log('📝 Recovering interaction history...');
      const interactionResults = await this.interactionLog.recoverInteractionHistory({
        scanDepthDays,
        dryRun
      });
      results.interactionHistory = interactionResults;
      console.log(`✅ Interaction history recovery: ${interactionResults.recovered} recovered, ${interactionResults.errors} errors`);

      // Generate summary
      results.summary = {
        totalRecovered: results.userMappings.recovered + results.rsvpData.recovered + results.interactionHistory.recovered,
        totalErrors: results.userMappings.errors + results.rsvpData.errors + results.interactionHistory.errors,
        scanDepthDays,
        dryRun,
        timestamp: new Date().toISOString()
      };

      console.log('✅ Comprehensive recovery completed successfully');
      console.log(`📊 Summary: ${results.summary.totalRecovered} items recovered, ${results.summary.totalErrors} errors`);

      return results;

    } catch (error) {
      console.error('❌ Error during comprehensive recovery:', error.message);
      results.summary.error = error.message;
      return results;
    }
  }

  /**
   * Quick recovery for critical data only
   * @returns {Object} Quick recovery results
   */
  async performQuickRecovery() {
    console.log('⚡ Starting quick recovery for critical data...');
    
    return await this.performComprehensiveRecovery({
      recoverUserMappings: true,
      recoverRsvpData: true,
      scanDepthDays: 7, // Only last week
      dryRun: false
    });
  }

  /**
   * Validate recovery results and suggest actions
   * @param {Object} recoveryResults - Results from recovery operation
   * @returns {Object} Validation summary with recommendations
   */
  validateRecoveryResults(recoveryResults) {
    const validation = {
      isSuccessful: true,
      recommendations: [],
      criticalIssues: [],
      summary: {}
    };

    // Check user mappings
    if (recoveryResults.userMappings.recovered === 0 && recoveryResults.userMappings.errors > 0) {
      validation.criticalIssues.push('No user mappings recovered - users will need to re-register');
      validation.recommendations.push('Ask users to use /register or /link commands to re-establish mappings');
      validation.isSuccessful = false;
    }

    // Check RSVP data
    if (recoveryResults.rsvpData.recovered === 0 && recoveryResults.rsvpData.errors > 0) {
      validation.recommendations.push('RSVP history lost - future matches will start with clean RSVP state');
    }

    // Overall assessment
    const successRate = recoveryResults.summary.totalErrors === 0 ? 100 : 
      Math.round((recoveryResults.summary.totalRecovered / (recoveryResults.summary.totalRecovered + recoveryResults.summary.totalErrors)) * 100);

    validation.summary = {
      successRate,
      totalRecovered: recoveryResults.summary.totalRecovered,
      totalErrors: recoveryResults.summary.totalErrors,
      recommendation: successRate > 80 ? 'Recovery successful' : 
                     successRate > 50 ? 'Partial recovery - manual intervention recommended' : 
                     'Recovery failed - manual setup required'
    };

    return validation;
  }
}

module.exports = RecoveryService;
