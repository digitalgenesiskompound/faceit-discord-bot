FROM node:lts-alpine

# Create app directory
WORKDIR /app

# Install dependencies first (for better caching)
COPY package*.json ./
RUN npm install --only=production

# Copy app source
COPY . .

# Create data directory with proper permissions
RUN mkdir -p /app/data && chown -R node:node /app

# Health check
HEALTHCHECK --interval=60s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

# Run as non-root user
USER node

# Start the app
CMD ["node", "match-notifier.js"]
