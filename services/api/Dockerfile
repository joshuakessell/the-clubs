# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /repo
RUN corepack enable

# Use BuildKit cache mounts for pnpm to reduce layer bloat
RUN --mount=type=cache,target=/root/.pnpm-store pnpm config set store-dir /root/.pnpm-store

# ── Dependencies ─────────────────────────────────────
FROM base AS deps
# Only copy what's needed for pnpm resolution
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY services/api/package.json ./services/api/package.json
COPY apps/customer-kiosk/package.json ./apps/customer-kiosk/package.json
COPY apps/employee-register/package.json ./apps/employee-register/package.json
COPY apps/office-dashboard/package.json ./apps/office-dashboard/package.json

# Install dependencies with cache mount
RUN --mount=type=cache,target=/root/.pnpm-store \
    pnpm install --frozen-lockfile --filter @the-clubs/shared --filter @the-clubs/api

# ── Build ────────────────────────────────────────────
FROM deps AS build
RUN --mount=type=cache,target=/root/.pnpm-store \
    pnpm install --frozen-lockfile --filter @the-clubs/shared --filter @the-clubs/api

# Copy source code and build configs
COPY packages/shared/src ./packages/shared/src
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY services/api/src ./services/api/src
COPY services/api/tsconfig.json ./services/api/tsconfig.json
COPY services/api/tsconfig.build.json ./services/api/tsconfig.build.json
COPY tsconfig.base.json ./tsconfig.base.json

# Build shared package, then API
RUN pnpm --filter @the-clubs/shared build && \
    pnpm --filter @the-clubs/api build

# ── Production dependencies ─────────────────────────
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY services/api/package.json ./services/api/package.json
COPY apps/customer-kiosk/package.json ./apps/customer-kiosk/package.json
COPY apps/employee-register/package.json ./apps/employee-register/package.json
COPY apps/office-dashboard/package.json ./apps/office-dashboard/package.json

# Install only production dependencies with cache mount
RUN --mount=type=cache,target=/root/.pnpm-store \
    pnpm install --prod --frozen-lockfile --filter @the-clubs/shared --filter @the-clubs/api

# ── Runner ───────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /repo

# Add non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

ENV NODE_ENV=production
ENV PORT=3000

# Copy dependency manifests (needed for workspace resolution)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY services/api/package.json ./services/api/package.json

# Copy production node_modules
COPY --from=prod-deps --chown=nodejs:nodejs /repo/node_modules ./node_modules
COPY --from=prod-deps --chown=nodejs:nodejs /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=prod-deps --chown=nodejs:nodejs /repo/services/api/node_modules ./services/api/node_modules

# Copy compiled shared package (exports point to dist/)
COPY --from=build --chown=nodejs:nodejs /repo/packages/shared/dist ./packages/shared/dist

# Copy compiled API
COPY --from=build --chown=nodejs:nodejs /repo/services/api/dist ./services/api/dist

# Switch to non-root user
USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"

CMD ["node", "services/api/dist/index.js"]
