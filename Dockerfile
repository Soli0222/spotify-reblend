# Build stage
FROM node:24.13.1-alpine3.23 AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-workspace.yaml ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/

# Install all dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source code
COPY packages/backend ./packages/backend
COPY packages/frontend ./packages/frontend

# Build frontend first
RUN pnpm build:frontend

# Build backend
RUN pnpm build:backend

# Production stage
FROM node:24.13.1-alpine3.23 AS runner

WORKDIR /app

# Install pnpm for production
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files for production install
COPY package.json pnpm-workspace.yaml ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod

# Copy built backend
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist

# Copy built frontend (served by backend)
COPY --from=builder /app/packages/frontend/dist ./packages/frontend/dist

ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "packages/backend/dist/index.js"]
