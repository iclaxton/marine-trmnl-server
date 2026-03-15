# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim

# Install Chromium (headless screenshots) and ImageMagick (PNG→BMP/grayscale).
# Symlink chromium → chromium-browser so config.yaml default works unchanged.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      imagemagick \
    && ln -s /usr/bin/chromium /usr/bin/chromium-browser \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Bring in production node_modules from build stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code and default config
COPY src/        ./src/
COPY config.yaml ./

# Create writable directories (overridden by volume mounts at runtime)
RUN mkdir -p screens data

EXPOSE 3002

CMD ["node", "src/server.js"]
