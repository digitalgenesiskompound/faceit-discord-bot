# Optimized single-stage build for speed and small size
FROM node:lts-alpine

# Explicit production env
ENV NODE_ENV=production

# Install only runtime packages needed at run time
RUN apk add --no-cache curl sqlite \
 && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package manifests first to leverage layer caching
COPY package*.json ./

# Use npm ci when lockfile is present for reproducible installs, fallback to install
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund --silent; \
    else \
      npm install --only=production --prefer-offline --no-audit --no-fund --silent; \
    fi \
 && npm cache clean --force

# Copy application source
COPY --chown=node:node src/ ./src/

# Create runtime directories with correct ownership
RUN mkdir -p /app/data /app/logs /app/backups \
 && chown -R node:node /app

# Health check endpoint
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Drop privileges
USER node

# Start the bot
CMD ["node", "src/bot.js"]
