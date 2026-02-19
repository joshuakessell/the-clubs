# Club Operations API

Fastify-based REST API server with AppSync Events-powered realtime updates and PostgreSQL database.

## Prerequisites

- **Node.js** >= 18.0.0
- **pnpm** >= 8.0.0
- **Docker** and **Docker Compose** (for local database)

## Quick Start

### 1. Start the Database

```bash
# Start PostgreSQL in Docker
pnpm db:start

# Verify it's running
docker ps
```

This starts a PostgreSQL 16 container with:

- **Host**: localhost
- **Port**: 5432
- **Database**: club_operations
- **User**: clubops
- **Password**: clubops_dev

### 2. Run Migrations

```bash
# Apply all pending migrations
pnpm db:migrate

# Check migration status
pnpm db:migrate:status
```

### 3. Seed the Database

```bash
# Insert seed data (rooms, key tags with QR scan tokens)
pnpm seed
```

This creates:

- 10 rooms with various statuses (DIRTY, CLEANING, CLEAN)
- Key tags with QR scan tokens (e.g., `ROOM-101`, `ROOM-102`, etc.)
- Mix of room types (STANDARD, DOUBLE, SPECIAL, LOCKER)

**Scan tokens for testing:**

- `ROOM-101`, `ROOM-102`, `ROOM-201` → DIRTY rooms
- `ROOM-103`, `ROOM-202` → CLEANING rooms
- `ROOM-104`, `ROOM-105`, `ROOM-203`, `ROOM-301`, `LOCKER-01` → CLEAN rooms

### 4. Start the API Server

```bash
# Development mode (with hot reload)
pnpm dev

# Production mode
pnpm build
pnpm start
```

The API server will be available at:

- **REST API**: http://localhost:3000
- **Realtime Auth**: http://localhost:3000/v1/realtime/auth
- **Health Check**: http://localhost:3000/health

## Database Commands

| Command                    | Description                           |
| -------------------------- | ------------------------------------- |
| `pnpm db:start`            | Start PostgreSQL container            |
| `pnpm db:stop`             | Stop PostgreSQL container             |
| `pnpm db:migrate`          | Run pending migrations                |
| `pnpm db:migrate:status`   | Show migration status                 |
| `pnpm db:migrate:rollback` | Rollback last migration record        |
| `pnpm db:reset`            | Reset database (destroys all data)    |
| `pnpm seed`                | Insert seed data (rooms and key tags) |

## Environment Variables

Copy `.env.example` to `.env` and configure as needed:

```bash
cp .env.example .env
```

| Variable         | Default         | Description              |
| ---------------- | --------------- | ------------------------ |
| `PORT`           | 3000            | API server port          |
| `HOST`           | 0.0.0.0         | API server host          |
| `DB_HOST`        | localhost       | PostgreSQL host          |
| `DB_PORT`        | 5432            | PostgreSQL port          |
| `DB_NAME`        | club_operations | Database name            |
| `DB_USER`        | clubops         | Database user            |
| `DB_PASSWORD`    | "$PASSWORD"     | Database password        |
| `DB_SSL`         | false           | Enable SSL for database  |
| `DB_POOL_MAX`    | 20              | Max connections in pool  |
| `DB_CONNECTION_TIMEOUT_MS` | 5000 | Connection timeout (ms) |
| `DB_WAIT_TIMEOUT_SECONDS` | 300 | Wait-for-DB timeout (seconds) |
| `DB_WAIT_RETRY_DELAY_MS` | 1000 | Wait-for-DB retry delay (ms) |
| `DB_LOG_QUERIES` | false           | Log all database queries |

## Database Schema

**Deprecated / superseded**: This README used to list “tables” and enum values, but those lists can drift (for example: legacy `members`/`sessions` vs the current customer-first schema).

For the canonical database meaning/contracts, see:

- `docs/database/DATABASE_SOURCE_OF_TRUTH.md`
- `docs/database/DATABASE_ENTITY_DETAILS.md`

For the current schema snapshot and history, see:

- `db/schema.sql`
- `services/api/migrations/000_baseline.sql` (no-op baseline for migration tracking)
- `services/api/migrations/001_init.sql` (schema snapshot baseline)
- `services/api/migrations/_archive/` (legacy migration history before re-baseline)

Note: the re-baselined migration history assumes a clean database. If you're coming from older migrations,
run `pnpm db:reset` before `pnpm db:migrate`.

## Creating New Migrations

Add new SQL files to the `migrations/` directory following the naming convention:

```
NNN_description.sql
```

Where `NNN` is a zero-padded sequence number (e.g., `009_add_staff_table.sql`).

Migrations are executed in alphabetical order and tracked in the `schema_migrations` table. The current
no-op baseline is `000_baseline.sql`, and `001_init.sql` contains the schema snapshot. New migrations
should continue the numeric sequence after the latest file.

## Development

```bash
# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Type checking
pnpm typecheck

# Linting
pnpm lint
```

## Connecting from Other Services

Use the database connection module:

```typescript
import { initializeDatabase, query, transaction } from './db/index.js';

// Initialize on startup
await initializeDatabase();

// Simple query
const result = await query('SELECT * FROM rooms WHERE status = $1', ['CLEAN']);

// Transaction
await transaction(async (client) => {
  await client.query('UPDATE rooms SET status = $1 WHERE id = $2', ['CLEANING', roomId]);
  await client.query('INSERT INTO audit_log ...', [...]);
});
```

## Testing the Cleaning Workflow (API)

After seeding the database, you can test the cleaning workflow endpoints used by staff tools:

### 1. Test Key Resolution

```bash
# Resolve a single key tag
curl -X POST http://localhost:3000/v1/keys/resolve \
  -H "Content-Type: application/json" \
  -d '{"tagCodes": ["ROOM-101"]}'

# Resolve multiple key tags (batch scan)
curl -X POST http://localhost:3000/v1/keys/resolve \
  -H "Content-Type: application/json" \
  -d '{"tagCodes": ["ROOM-101", "ROOM-102", "ROOM-103"]}'
```

Expected response includes:

- `rooms`: Array of resolved rooms with statuses
- `statusCounts`: Count of rooms by status
- `isMixedStatus`: Whether rooms have different statuses
- `primaryAction`: Suggested action based on statuses

### 2. Test Batch Cleaning Update

```bash
# First, resolve tags to get room IDs
RESPONSE=$(curl -s -X POST http://localhost:3000/v1/keys/resolve \
  -H "Content-Type: application/json" \
  -d '{"tagCodes": ["ROOM-101"]}')

# Extract room ID (adjust based on your JSON parser)
ROOM_ID=$(echo $RESPONSE | jq -r '.rooms[0].roomId')

# Update room status (DIRTY → CLEANING)
curl -X POST http://localhost:3000/v1/cleaning/batch \
  -H "Content-Type: application/json" \
  -d "{
    \"roomIds\": [\"$ROOM_ID\"],
    \"targetStatus\": \"CLEANING\",
    \"staffId\": \"staff-001\",
    \"override\": false
  }"
```

The batch endpoint:

- ✅ Uses database transactions (all-or-nothing)
- ✅ Uses row locking (`FOR UPDATE`) to prevent race conditions
- ✅ Broadcasts realtime events for status changes
- ✅ Updates inventory counts via realtime events

### 3. Verify Realtime Events (AppSync Events)

If AppSync Events is configured, request realtime auth headers:

```bash
curl -X POST http://localhost:3000/v1/realtime/auth \
  -H "Content-Type: application/json" \
  -H "x-kiosk-token: <kiosk-token>" \
  -d '{"channels":["/club-ops/lane/lane-1"]}'
```

Use the returned `realtimeEndpoint` and headers with the AppSync Events client to subscribe.

## Troubleshooting

### Cannot connect to database

1. Ensure Docker is running: `docker ps`
2. Check if the container is up: `docker compose ps`
3. View container logs: `docker compose logs postgres`
4. Restart the database: `pnpm db:stop && pnpm db:start`

### Migration failed

1. Check the error message for SQL syntax issues
2. View current status: `pnpm db:migrate:status`
3. If needed, reset the database: `pnpm db:reset` (⚠️ destroys all data)
4. Re-run migrations: `pnpm db:migrate`

### Port 5432 already in use

If you need to use a different port, update the `DB_PORT` environment variable to match your PostgreSQL instance.
