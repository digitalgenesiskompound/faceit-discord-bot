const config = require('../config/config');
const axios = require('axios');
const errorHandler = require('./errorHandler');

/**
 * Format date for multiple time zones
 */
function formatMatchTime(timestamp) {
  if (!timestamp) return 'TBD';
  
  const date = new Date(timestamp * 1000);
  
  // Format for Pacific Time
  const pacificTime = date.toLocaleString('en-US', { 
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  // Format for Mountain Time
  const mountainTime = date.toLocaleString('en-US', { 
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  return {
    pacific: `${pacificTime} PDT`,
    mountain: `${mountainTime} MDT`
  };
}

/**
 * Enhanced API request function with advanced retry logic, circuit breaker, and logging
 */
async function makeApiRequest(url, options = {}, context = {}) {
  // Determine circuit breaker key based on URL
  const circuitBreakerKey = url.includes('faceit.com') ? 'faceit_api' : 'external_api';
  
  return await errorHandler.httpRequestWithRetry(
    async () => {
      const headers = {
        'Authorization': `Bearer ${config.faceit.apiKey}`,
        'Accept': 'application/json',
        ...options.headers
      };
      
      const response = await axios.get(url, { 
        ...options, 
        headers,
        timeout: options.timeout || 15000
      });
      
      return response.data;
    },
    {
      maxRetries: options.maxRetries || 3,
      baseDelay: options.baseDelay || 1000,
      maxDelay: options.maxDelay || 30000,
      timeout: options.timeout || 15000,
      circuitBreakerKey,
      context: {
        url,
        operation: context.operation || 'api_request',
        ...context
      }
    }
  );
}

/**
 * Legacy API request function for backward compatibility
 * @deprecated Use makeApiRequest with enhanced options instead
 */
async function legacyMakeApiRequest(url, options = {}, retryCount = 0) {
  errorHandler.logger.warn('Using deprecated legacyMakeApiRequest function', {
    url,
    retryCount,
    caller: new Error().stack.split('\n')[2]?.trim()
  });
  
  return makeApiRequest(url, options, { operation: 'legacy_request' });
}

module.exports = {
  formatMatchTime,
  makeApiRequest
};
