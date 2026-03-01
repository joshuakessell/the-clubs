#!/bin/bash
#
# Rollback deployment script for The Clubs API
# Usage: ./scripts/rollback.sh [production|staging]
#

set -e

ENVIRONMENT="${1:-production}"
APP_DIR="/home/ec2-user/the-clubs"
BACKUP_DIR="$APP_DIR/.backup"
BACKUP_PREV_DIR="$APP_DIR/.backup.old"

echo "🔄 Rolling back $ENVIRONMENT environment..."

if [ ! -d "$BACKUP_DIR" ]; then
  echo "❌ No backup found. Cannot rollback."
  exit 1
fi

# Stop current containers
echo "⏹️  Stopping current containers..."
if [ "$ENVIRONMENT" == "staging" ]; then
  docker compose -f "$APP_DIR/docker-compose.prod.yml" -p club-ops-staging down
else
  docker compose -f "$APP_DIR/docker-compose.prod.yml" down
fi

# Restore previous image state if available
if [ -f "$BACKUP_PREV_DIR/image-state.txt" ]; then
  echo "🔙 Restoring previous image state..."
  # Get the previous image ID from backup
  PREV_IMAGE=$(grep "club-ops-api" "$BACKUP_PREV_DIR/image-state.txt" | awk '{print $3}' | head -1)
  if [ -n "$PREV_IMAGE" ]; then
    echo "  Using image: $PREV_IMAGE"
  fi
fi

# Restart with previous state
echo "🚀 Restarting containers..."
if [ "$ENVIRONMENT" == "staging" ]; then
  docker compose -f "$APP_DIR/docker-compose.prod.yml" \
    --env-file /home/ec2-user/.env.staging \
    -p club-ops-staging \
    up -d
else
  docker compose -f "$APP_DIR/docker-compose.prod.yml" \
    --env-file /home/ec2-user/.env \
    up -d
fi

# Health check
echo "🏥 Checking health..."
MAX_ATTEMPTS=20
for i in $(seq 1 $MAX_ATTEMPTS); do
  if [ "$ENVIRONMENT" == "staging" ]; then
    PORT=3001
  else
    PORT=3000
  fi
  
  if curl -sf "http://localhost:$PORT/health" > /dev/null 2>&1; then
    echo "✅ Rollback successful! $ENVIRONMENT is healthy."
    exit 0
  fi
  
  if [ $i -lt $MAX_ATTEMPTS ]; then
    echo "  Attempt $i/$MAX_ATTEMPTS..."
    sleep 2
  fi
done

echo "❌ Health check failed after rollback"
docker compose -f "$APP_DIR/docker-compose.prod.yml" logs --tail=50
exit 1
