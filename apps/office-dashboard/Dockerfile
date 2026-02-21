# syntax=docker/dockerfile:1
FROM node:22-alpine AS builder
WORKDIR /repo

RUN corepack enable pnpm

# Copy workspace and monorepo files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all packages needed for building
COPY packages/shared ./packages/shared
COPY packages/ui ./packages/ui
COPY apps/office-dashboard ./apps/office-dashboard

# Install dependencies and build
RUN pnpm install --frozen-lockfile

WORKDIR /repo/apps/office-dashboard
RUN pnpm run build

# Production stage - serve with nginx
FROM nginx:alpine

RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/

COPY --from=builder /repo/apps/office-dashboard/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost/index.html || exit 1

CMD ["nginx", "-g", "daemon off;"]
