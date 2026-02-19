#!/bin/bash
# Database setup script for development

set -e

echo "🚀 Setting up database for Club Operations..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker is not running. Please start Docker Desktop and try again."
  exit 1
fi

# Start database
echo "📦 Starting PostgreSQL container..."
docker compose up -d

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
sleep 5

# Check if database is ready
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
  if docker compose exec -T postgres pg_isready -U clubops -d club_operations > /dev/null 2>&1; then
    echo "✅ Database is ready!"
    break
  fi
  attempt=$((attempt + 1))
  echo "  Attempt $attempt/$max_attempts..."
  sleep 1
done

if [ $attempt -eq $max_attempts ]; then
  echo "❌ Database failed to start after $max_attempts attempts"
  exit 1
fi

# Run migrations
echo "📝 Running database migrations..."
pnpm db:migrate

echo "✅ Database setup complete!"
echo ""
echo "Database connection info:"
echo "  Host: localhost"
echo "  Port: 5432"
echo "  Database: club_operations"
echo "  User: clubops"
echo "  Password: clubops_dev"
echo ""
echo "To stop the database: pnpm db:stop"
echo "To reset the database: pnpm db:reset"








