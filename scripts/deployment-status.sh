#!/bin/bash
#
# Deployment status checker
# Displays current deployment status, container health, and recent logs
#

set -e

ENVIRONMENT="${1:-production}"
COMPOSE_FILE="docker-compose.prod.yml"

if [ "$ENVIRONMENT" == "staging" ]; then
  PROJECT_NAME="club-ops-staging"
  PORT=3001
else
  PROJECT_NAME="club-ops"
  PORT=3000
fi

echo "════════════════════════════════════════════════"
echo "  Deployment Status Report - $ENVIRONMENT"
echo "════════════════════════════════════════════════"
echo ""

# Container Status
echo "📦 Container Status:"
echo "─────────────────────────────────────────────────"
docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" ps

echo ""
echo "🏥 Health Status:"
echo "─────────────────────────────────────────────────"

# API Health
if curl -sf "http://localhost:$PORT/health" > /dev/null 2>&1; then
  echo "✅ API: Healthy (http://localhost:$PORT/health)"
else
  echo "❌ API: Unhealthy (http://localhost:$PORT/health)"
fi

# Database Health
if docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" exec -T db pg_isready -U clubops > /dev/null 2>&1; then
  echo "✅ Database: Healthy"
else
  echo "❌ Database: Unhealthy"
fi

echo ""
echo "📊 Resource Usage:"
echo "─────────────────────────────────────────────────"
docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" \
  "club-ops-api" "club-ops-db" 2>/dev/null || echo "  (Containers not running)"

echo ""
echo "📋 Recent Logs (last 10 lines):"
echo "─────────────────────────────────────────────────"
echo "[API]"
docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" logs --tail=5 api 2>/dev/null | head -10

echo ""
echo "[Database]"
docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" logs --tail=5 db 2>/dev/null | head -10

echo ""
echo "════════════════════════════════════════════════"
