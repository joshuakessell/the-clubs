# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /repo
RUN corepack enable

# ── Dependencies (for build) ─────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY services/api/package.json ./services/api/package.json
COPY apps/customer-kiosk/package.json ./apps/customer-kiosk/package.json
COPY apps/employee-register/package.json ./apps/employee-register/package.json
COPY apps/office-dashboard/package.json ./apps/office-dashboard/package.json

RUN --mount=type=cache,target=/root/.pnpm-store \
    pnpm install --frozen-lockfile --filter @the-clubs/shared --filter @the-clubs/api

# ── Build ────────────────────────────────────────────
FROM deps AS build
COPY packages/shared/src ./packages/shared/src
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY services/api/src ./services/api/src
COPY services/api/tsconfig.json ./services/api/tsconfig.json
COPY services/api/tsconfig.build.json ./services/api/tsconfig.build.json
COPY tsconfig.base.json ./tsconfig.base.json

RUN pnpm --filter @the-clubs/shared build && \
    pnpm --filter @the-clubs/api build

# ── Runner ───────────────────────────────────────────
FROM base AS runner

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

ENV NODE_ENV=production
ENV PORT=3000

# Copy workspace manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY services/api/package.json ./services/api/package.json
COPY apps/customer-kiosk/package.json ./apps/customer-kiosk/package.json
COPY apps/employee-register/package.json ./apps/employee-register/package.json
COPY apps/office-dashboard/package.json ./apps/office-dashboard/package.json

# Copy compiled output FIRST — before pnpm install
# This way, when pnpm creates workspace symlinks, they point to
# directories that already contain the dist/ output.
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/services/api/dist ./services/api/dist

# Copy migration SQL files (needed by auto-migrate on startup)
COPY services/api/migrations ./services/api/migrations

# Now install prod deps — pnpm workspace symlinks will resolve correctly
RUN --mount=type=cache,target=/root/.pnpm-store \
    pnpm install --prod --frozen-lockfile --filter @the-clubs/shared --filter @the-clubs/api

# Set ownership after all files are in place
RUN chown -R nodejs:nodejs /repo

USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"

CMD ["node", "services/api/dist/index.js"]
