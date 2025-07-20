FROM node:lts-alpine

# Install build dependencies for SQLite3 and curl for health checks
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    curl \
    sqlite

# Create app directory
WORKDIR /app

# Install dependencies first (for better caching)
COPY package*.json ./
RUN npm install --only=production

# Copy app source
COPY . .

# Create data directory with proper permissions
RUN mkdir -p /app/data && chown -R node:node /app

# Health check using curl instead of wget
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Run as non-root user
USER node

# Start the app (modular version)
CMD ["node", "src/bot.js"]
