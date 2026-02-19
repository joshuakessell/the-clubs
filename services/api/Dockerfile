# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /repo
RUN corepack enable

# Dependencies stage - install production dependencies only
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY services/api/package.json ./services/api/package.json

RUN pnpm install --prod --frozen-lockfile

# Production stage - minimal runtime
FROM node:22-alpine AS runner
WORKDIR /repo

ENV NODE_ENV=production
ENV PORT=3000

# Copy dependency manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY services/api/package.json ./services/api/package.json

# Copy production dependencies
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /repo/services/api/node_modules ./services/api/node_modules

# Copy prebuilt artifacts and certificate
COPY packages/shared/dist ./packages/shared/dist
COPY services/api/dist ./services/api/dist
COPY services/api/certs/rds-ca-bundle.pem ./services/api/certs/rds-ca-bundle.pem

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"

CMD ["node", "services/api/dist/index.js"]
