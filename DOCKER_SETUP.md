# Docker Containerization Setup

## Project Structure
Your monorepo has been containerized with optimized multi-stage Dockerfiles following Docker best practices:

- **3 React SPAs** (Vite): customer-kiosk, employee-register, office-dashboard
- **1 Node.js API** (Fastify): services/api
- **2 Shared packages**: packages/shared, packages/ui
- **PostgreSQL database**

## Files Created

### Dockerfiles
- `./Dockerfile` - Root reference build (shows how all services build)
- `./apps/customer-kiosk/Dockerfile` - Multi-stage build → nginx
- `./apps/employee-register/Dockerfile` - Multi-stage build → nginx
- `./apps/office-dashboard/Dockerfile` - Multi-stage build → nginx
- `./services/api/Dockerfile` - Dependencies + production runtime

### Compose & Config
- `./docker-compose.yml` - Orchestrates all services with healthchecks and networking
- `./.env.example` - Environment variables template
- `./.dockerignore` - Root exclusions for build context

### nginx Config
- `./apps/*/nginx.conf` - SPA routing (fallback to index.html) + asset caching

### .dockerignore Files
- `./apps/*/.dockerignore` - Minimal exclusions for React apps

## Quick Start

1. **Fix TypeScript errors** in packages/shared/src/realtimeSchemas.ts
   - Zod schema definitions need `.strict()` to match type requirements

2. **Build locally** (creates dist files):
   ```bash
   pnpm install
   pnpm run -r build
   ```

3. **Start all services**:
   ```bash
   # Copy environment template
   cp .env.example .env
   
   # Build and run containers
   docker compose up --build
   ```

4. **Access services**:
   - API: http://localhost:3000
   - Customer Kiosk: http://localhost:3001
   - Employee Register: http://localhost:3002
   - Office Dashboard: http://localhost:3003
   - Database: localhost:5433

## Best Practices Implemented

✅ **Multi-stage builds** - Separate build and runtime stages
✅ **Alpine images** - Minimal Node.js and nginx images
✅ **Production deps only** - API excludes dev dependencies
✅ **Healthchecks** - All services include health checks
✅ **Networking** - Custom bridge network for inter-service communication
✅ **Volume management** - PostgreSQL data persists
✅ **Environment variables** - Configurable via .env
✅ **Asset caching** - nginx caches static files for 1 year
✅ **SPA routing** - nginx configured for React Router fallback

## Docker Compose Services

| Service | Port | Image | Status |
|---------|------|-------|--------|
| db | 5433 | postgres:15-alpine | Health check enabled |
| api | 3000 | Built from Dockerfile | Health check enabled |
| customer-kiosk | 3001 | nginx:alpine | Health check enabled |
| employee-register | 3002 | nginx:alpine | Health check enabled |
| office-dashboard | 3003 | nginx:alpine | Health check enabled |

## Environment Variables

Configure in `.env`:
- `NODE_ENV` - Environment (production/development)
- `DB_NAME`, `DB_USER`, `DB_PASSWORD` - PostgreSQL credentials
- `DB_PORT` - Database port mapping
- `REACT_APP_API_URL` - API endpoint for React apps

## Troubleshooting

**"Build failed: dist not found"**
→ Run `pnpm run -r build` locally first. Docker expects pre-built artifacts.

**"Cannot connect to db"**
→ Wait for healthcheck to pass: `docker compose logs db`

**"React app shows blank page"**
→ Check nginx logs: `docker compose logs customer-kiosk`
→ Verify REACT_APP_API_URL is correct in .env

**Port conflicts**
→ Edit port mappings in docker-compose.yml
