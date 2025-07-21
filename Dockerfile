# Optimized single-stage build for maximum speed
FROM node:lts-alpine

# Install only runtime dependencies (no build tools needed)
RUN apk add --no-cache curl sqlite && \
    rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies with optimizations for speed
# Using npm install for better pre-built binary compatibility
RUN npm install --only=production --prefer-offline --no-audit --no-fund --silent && \
    npm cache clean --force

# Copy application source code and database module (changes most frequently, so it's last)
COPY --chown=node:node src/ ./src/
COPY --chown=node:node database.js ./database.js

# Create data, logs, and backups directories
RUN mkdir -p /app/data /app/logs /app/backups && chown -R node:node /app/data /app/logs /app/backups

# Health check using curl instead of wget
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Run as non-root user
USER node

# Start the app (modular version)
CMD ["node", "src/bot.js"]
