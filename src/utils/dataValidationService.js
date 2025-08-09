const comprehensiveLogger = require('./comprehensiveLogger');

class DataValidationService {
  constructor() {
    this.logger = comprehensiveLogger;
  }

  /**
   * Validate freshness of match data compared to existing data
   * @param {Object} freshData - Fresh match data from API
   * @param {Object} existingData - Existing match data
   * @param {string} matchId - Match identifier
   * @returns {Object} Validation result
   */
  validateMatchDataFreshness(freshData, existingData, matchId) {
    const result = {
      isValid: true,
      isFresher: false,
      hasSignificantChanges: false,
      shouldUpdate: false,
      dataQuality: 'good',
      issues: [],
      recommendations: []
    };

    try {
      // Compare scheduled_at timestamps (primary indicator)
      if (freshData.scheduled_at && existingData.scheduled_at) {
        if (freshData.scheduled_at > existingData.scheduled_at) {
          result.isFresher = true;
          result.recommendations.push('Fresh data has newer scheduled time');
        } else if (freshData.scheduled_at < existingData.scheduled_at) {
          result.issues.push('Fresh data has older scheduled time than existing');
          result.recommendations.push('Consider keeping existing data');
        } else {
          result.recommendations.push('Scheduled times are identical');
        }
      }

      // Compare status progression
      const statusProgression = ['SCHEDULED', 'READY', 'LIVE', 'FINISHED', 'CANCELLED'];
      const freshStatusIndex = statusProgression.indexOf(freshData.status);
      const existingStatusIndex = statusProgression.indexOf(existingData.status);

      if (freshStatusIndex > existingStatusIndex) {
        result.isFresher = true;
        result.recommendations.push(`Status progressed from ${existingData.status} to ${freshData.status}`);
      } else if (freshStatusIndex < existingStatusIndex) {
        result.issues.push(`Status regressed from ${existingData.status} to ${freshData.status}`);
      }

      // Check for finished_at timestamp (indicates match completion)
      if (freshData.finished_at && !existingData.finished_at) {
        result.isFresher = true;
        result.recommendations.push('Fresh data includes finish timestamp');
      }

      return result;

    } catch (error) {
      result.issues.push(`Freshness comparison failed: ${error.message}`);
      return result;
    }
  }

  /**
   * Detect significant changes between data sets
   * @param {Object} newData - Fresh data
   * @param {Object} existingData - Existing data
   * @returns {Object} Changes detection result
   */
  detectSignificantChanges(newData, existingData) {
    const result = {
      hasChanges: false,
      changes: [],
      concerningChanges: [],
      issues: [],
      recommendations: []
    };

    try {
      // Check team name changes (usually concerning)
      if (this.hasTeamNameChanges(newData, existingData)) {
        result.hasChanges = true;
        result.concerningChanges.push('team_names');
        result.changes.push('Team names have changed');
        result.issues.push('Team name changes are unusual and may indicate data issues');
      }

      // Check schedule changes (normal for rescheduling)
      if (this.hasScheduleChanges(newData, existingData)) {
        result.hasChanges = true;
        result.changes.push('Match schedule changed');
        result.recommendations.push('Schedule change detected - normal for rescheduled matches');
      }

      // Check status changes (expected progression)
      if (this.hasStatusChanges(newData, existingData)) {
        result.hasChanges = true;
        result.changes.push(`Status changed from ${existingData.status} to ${newData.status}`);
        
        if (this.isNormalStatusProgression(existingData.status, newData.status)) {
          result.recommendations.push('Normal status progression detected');
          
          // Log normal status progression
          comprehensiveLogger.logStatusConversion('status_progression', 'status_change', {
            origin: comprehensiveLogger.origins.API_LIVE,
            reasoning: 'Normal match status progression detected from API',
            previousStatus: existingData.status,
            newStatus: newData.status,
            context: {
              progressionType: 'normal',
              apiTimestamp: newData.scheduled_at,
              localTimestamp: existingData.scheduled_at
            }
          });
        } else {
          result.concerningChanges.push('abnormal_status_change');
          result.issues.push('Unusual status change pattern detected');
          
          // Log concerning status regression
          comprehensiveLogger.logStatusConversion('status_regression', 'status_change', {
            origin: comprehensiveLogger.origins.API_LIVE,
            reasoning: 'Concerning status regression detected - API data may be inconsistent',
            previousStatus: existingData.status,
            newStatus: newData.status,
            context: {
              progressionType: 'regression',
              apiTimestamp: newData.scheduled_at,
              localTimestamp: existingData.scheduled_at,
              severity: 'concerning'
            }
          });
        }
      }

      // Check for new result data
      if (this.hasNewResultData(newData, existingData)) {
        result.hasChanges = true;
        result.changes.push('Match results added');
        result.recommendations.push('Fresh result data available');
      }

      return result;

    } catch (error) {
      result.issues.push(`Change detection failed: ${error.message}`);
      return result;
    }
  }

  /**
   * Check if team names have changed
   * @param {Object} newData - Fresh data
   * @param {Object} existingData - Existing data
   * @returns {boolean} True if team names changed
   */
  hasTeamNameChanges(newData, existingData) {
    const newTeam1 = newData.teams?.faction1?.name;
    const newTeam2 = newData.teams?.faction2?.name;
    const existingTeam1 = existingData.teams?.faction1?.name;
    const existingTeam2 = existingData.teams?.faction2?.name;

    return (newTeam1 !== existingTeam1) || (newTeam2 !== existingTeam2);
  }

  /**
   * Check if schedule has changed
   * @param {Object} newData - Fresh data
   * @param {Object} existingData - Existing data
   * @returns {boolean} True if schedule changed
   */
  hasScheduleChanges(newData, existingData) {
    return newData.scheduled_at !== existingData.scheduled_at;
  }

  /**
   * Check if status has changed
   * @param {Object} newData - Fresh data
   * @param {Object} existingData - Existing data
   * @returns {boolean} True if status changed
   */
  hasStatusChanges(newData, existingData) {
    return newData.status !== existingData.status;
  }

  /**
   * Check if status change represents normal progression
   * @param {string} oldStatus - Previous status
   * @param {string} newStatus - New status
   * @returns {boolean} True if progression is normal
   */
  isNormalStatusProgression(oldStatus, newStatus) {
    const normalProgressions = {
      'SCHEDULED': ['READY', 'LIVE', 'FINISHED', 'CANCELLED'],
      'READY': ['LIVE', 'FINISHED', 'CANCELLED'],
      'LIVE': ['FINISHED', 'CANCELLED'],
      'FINISHED': [], // Finished matches shouldn't change status
      'CANCELLED': [] // Cancelled matches shouldn't change status
    };

    return normalProgressions[oldStatus]?.includes(newStatus) || false;
  }

  /**
   * Check if new result data is available
   * @param {Object} newData - Fresh data
   * @param {Object} existingData - Existing data
   * @returns {boolean} True if new results available
   */
  hasNewResultData(newData, existingData) {
    // Check if results object is newly available
    if (newData.results && !existingData.results) {
      return true;
    }

    // Check if more detailed results are available
    if (newData.results && existingData.results) {
      const newHasScore = newData.results.score && 
        (newData.results.score.faction1 !== undefined || newData.results.score.faction2 !== undefined);
      const existingHasScore = existingData.results.score && 
        (existingData.results.score.faction1 !== undefined || existingData.results.score.faction2 !== undefined);
      
      if (newHasScore && !existingHasScore) {
        return true;
      }
    }

    return false;
  }

  /**
   * Categorize and log errors/issues based on their nature
   * @param {string} context - Context where error occurred
   * @param {Object} errorInfo - Error information
   * @param {string} matchId - Match identifier
   */
  categorizeAndLogError(context, errorInfo, matchId = 'unknown') {
    const categories = {
      'DATA_UNAVAILABLE': {
        level: 'warn',
        description: 'Expected data not available',
        action: 'Skip operation and retry later'
      },
      'DATA_MALFORMED': {
        level: 'error',
        description: 'Data structure is invalid',
        action: 'Skip operation and investigate data source'
      },
      'DATA_INCONSISTENCY': {
        level: 'warn',
        description: 'Data contains concerning inconsistencies',
        action: 'Proceed with caution, log for review'
      },
      'DATA_STALE': {
        level: 'info',
        description: 'Data is not fresher than existing',
        action: 'Skip update to avoid overwriting newer data'
      },
      'VALIDATION_ERROR': {
        level: 'error',
        description: 'Validation process failed',
        action: 'Skip operation and investigate validation logic'
      },
      'BENIGN_DIFFERENCE': {
        level: 'debug',
        description: 'Minor differences that do not require action',
        action: 'Continue with normal operation'
      }
    };

    const category = categories[errorInfo.category] || categories['VALIDATION_ERROR'];
    
    const logEntry = {
      context,
      matchId,
      category: errorInfo.category,
      description: category.description,
      action: category.action,
      details: errorInfo.details || {},
      timestamp: new Date().toISOString()
    };

    // Log at appropriate level
    this.logger[category.level](`${category.description} in ${context} for match ${matchId}`, logEntry);

    return {
      category: errorInfo.category,
      severity: category.level,
      shouldProceed: category.level === 'debug' || category.level === 'info',
      recommendedAction: category.action
    };
  }

  /**
   * Enhanced reconciliation logic with detailed tracking
   * @param {Object} options - Reconciliation options
   * @returns {Object} Reconciliation result
   */
  async performDataReconciliation(options) {
    const {
      freshData,
      existingData,
      context,
      matchId,
      forceUpdate = false
    } = options;

    const reconciliation = {
      action: 'skip',
      reason: '',
      confidence: 'high',
      issues: [],
      dataUsed: null,
      timestamp: new Date().toISOString()
    };

    try {
      // Validate fresh data
      const validation = this.validateMatchDataFreshness(freshData, existingData, matchId);

      // Log validation results
      this.logger.info(`Data reconciliation for match ${matchId} in ${context}`, {
        validation: {
          isValid: validation.isValid,
          isFresher: validation.isFresher,
          hasChanges: validation.hasSignificantChanges,
          shouldUpdate: validation.shouldUpdate,
          quality: validation.dataQuality
        }
      });

      // Decision logic
      if (forceUpdate) {
        reconciliation.action = 'update';
        reconciliation.reason = 'Force update requested';
        reconciliation.dataUsed = freshData;
        reconciliation.confidence = 'high';
        
        // Log forced update
        comprehensiveLogger.logReconciliation('forced_update', freshData, {
          matchId,
          origin: comprehensiveLogger.origins.USER_INPUT,
          reasoning: 'Force update requested by user or system',
          action: 'update',
          confidence: 'high',
          context: { forceUpdate: true, context },
          freshData,
          existingData,
          resultData: freshData
        });
      } else if (!validation.isValid) {
        reconciliation.action = 'skip';
        reconciliation.reason = `Invalid data: ${validation.issues.join(', ')}`;
        reconciliation.dataUsed = existingData;
        reconciliation.confidence = 'high';
        reconciliation.issues = validation.issues;
        
        // Log data validation skip
        comprehensiveLogger.logSkip('reconciliation_update', freshData, {
          matchId,
          origin: comprehensiveLogger.origins.VALIDATION,
          reasoning: 'Invalid data detected during reconciliation - skipping to prevent corruption',
          context: { validationCategory: validation.errorCategory, context },
          validationIssues: validation.issues,
          existingState: existingData
        });
        
        console.log(`❌ [UNNECESSARY CORRECTION AVOIDED] Invalid data detected during reconciliation`);
        console.log(`   - Match: ${matchId}`);
        console.log(`   - Issues: ${validation.issues.join(', ')}`);
        console.log(`   - Action: Skipping operation to prevent data corruption`);
      } else if (validation.shouldUpdate) {
        reconciliation.action = 'update';
        reconciliation.reason = validation.isFresher ? 'Fresher data available' : 'Significant changes detected';
        reconciliation.dataUsed = freshData;
        reconciliation.confidence = validation.errorCategory ? 'medium' : 'high';
        reconciliation.issues = validation.issues;
        
        // Log approved reconciliation update
        comprehensiveLogger.logReconciliation('approved_update', freshData, {
          matchId,
          origin: comprehensiveLogger.origins.RECONCILIATION,
          reasoning: validation.isMissing ? 
            'Reconciliation approved data restoration for missing information' :
            `Reconciliation approved update: ${reconciliation.reason}`,
          action: 'update',
          confidence: reconciliation.confidence,
          context: { 
            isFresher: validation.isFresher,
            hasSignificantChanges: validation.hasSignificantChanges,
            isMissing: validation.isMissing,
            context 
          },
          freshData,
          existingData,
          resultData: freshData
        });
        
        if (validation.isMissing) {
          console.log(`📊 [SAFE RESTORATION] Reconciliation approved data update for missing information`);
          console.log(`   - Match: ${matchId}`);
          console.log(`   - Reason: ${reconciliation.reason}`);
          console.log(`   - Action: Restoring/updating data with validated fresh information`);
        } else {
          console.log(`📊 [SAFE RESTORATION] Reconciliation approved data update`);
          console.log(`   - Match: ${matchId}`);
          console.log(`   - Reason: ${reconciliation.reason}`);
          console.log(`   - Confidence: ${reconciliation.confidence}`);
          console.log(`   - Action: Updating with validated fresh data`);
        }
      } else {
        reconciliation.action = 'skip';
        reconciliation.reason = 'No fresher data or significant changes';
        reconciliation.dataUsed = existingData;
        reconciliation.confidence = 'high';
        
        // Log when no reconciliation update is needed
        comprehensiveLogger.logSkip('reconciliation_update', freshData, {
          matchId,
          origin: comprehensiveLogger.origins.RECONCILIATION,
          reasoning: 'No changes made: existing data is up-to-date after reconciliation analysis',
          context: { 
            isFresher: validation.isFresher,
            hasSignificantChanges: validation.hasSignificantChanges,
            context 
          },
          validationIssues: ['Data is not fresher', 'No significant changes'],
          existingState: existingData
        });
        
        console.log(`ℹ️ [NO ACTION NEEDED] Reconciliation determined no update necessary`);
        console.log(`   - Match: ${matchId}`);
        console.log(`   - Reason: ${reconciliation.reason}`);
        console.log(`   - Action: Retaining existing data`);
      }

      // Log reconciliation decision
      this.logger.info(`Reconciliation decision for match ${matchId}`, {
        action: reconciliation.action,
        reason: reconciliation.reason,
        confidence: reconciliation.confidence,
        issues: reconciliation.issues.length
      });

      return reconciliation;

    } catch (error) {
      reconciliation.action = 'error';
      reconciliation.reason = `Reconciliation failed: ${error.message}`;
      reconciliation.confidence = 'low';
      reconciliation.issues.push(error.message);

      this.logger.error(`Data reconciliation error for match ${matchId}`, {
        error: error.message,
        stack: error.stack,
        context
      });

      return reconciliation;
    }
  }
}

module.exports = new DataValidationService();
