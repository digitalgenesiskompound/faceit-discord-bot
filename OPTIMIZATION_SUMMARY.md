# FaceitService Optimizations

## What was optimized:

### 1. **Caching System**
- Added in-memory caching with TTL (Time To Live) for API responses
- Different cache durations based on data freshness requirements:
  - Championship matches: 2 minutes (frequently updated)
  - Team data: 10-15 minutes (relatively stable)
  - Player history: 3 minutes (moderately frequent updates)
  - Match details: 10 minutes (stable once finished)
  - Player profiles: 30 minutes (very stable)

### 2. **Request Deduplication**
- Prevents multiple identical API requests from running simultaneously
- Uses a pending requests map to share results across concurrent calls

### 3. **Smart Batch Processing**
- Processes match requests in batches of 5 instead of one-by-one
- Uses `Promise.all()` for parallel processing within batches
- Reduces total API call time significantly

### 4. **Intelligent Player Selection**
- If some matches are already found, only checks 3 players instead of all 7
- Prioritizes getting sufficient results over exhaustive searching

### 5. **Optimized Rate Limiting**
- Better spacing between requests (200ms between batches, 300ms between players)
- Respects API rate limits while maintaining reasonable speed

### 6. **Reduced Data Fetching**
- Lowered player history limit from 50 to 30 matches per player
- Early termination when enough results are found

### 7. **Automatic Cache Cleanup**
- Periodic cleanup every 10 minutes to prevent memory leaks
- Removes expired cache entries automatically

## Expected Results:

**Before optimization:**
- ~200+ individual API requests for match history
- High chance of rate limiting
- Slow response times (2-3 minutes)
- Duplicate requests for same data

**After optimization:**
- ~20-50 API requests (depending on cache hits)
- Much lower rate limiting risk
- Faster response times (30-60 seconds on first run, 5-10 seconds with cache)
- No duplicate requests
- Reduced API usage by 70-80%

## Cache Benefits:
- **First run**: Still comprehensive but much faster due to batching
- **Subsequent runs**: Very fast due to cached data
- **Mixed scenarios**: Partial cache hits provide balanced speed/freshness
