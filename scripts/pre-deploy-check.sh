#!/bin/bash
#
# Pre-deployment validation script
# Checks configuration, secrets, and deployment readiness
#

set -e

echo "🔍 Pre-Deployment Validation"
echo "════════════════════════════════════════════════"
echo ""

ERRORS=0
WARNINGS=0

# Check Git status
echo "1️⃣  Git Status:"
if [ -z "$(git status --short)" ]; then
  echo "   ✅ Working directory clean"
else
  echo "   ⚠️  Uncommitted changes found:"
  git status --short | sed 's/^/      /'
  WARNINGS=$((WARNINGS + 1))
fi

# Check branch
echo ""
echo "2️⃣  Branch:"
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" == "main" ] || [ "$CURRENT_BRANCH" == "develop" ]; then
  echo "   ✅ On deployable branch: $CURRENT_BRANCH"
else
  echo "   ⚠️  On branch: $CURRENT_BRANCH (not main or develop)"
  WARNINGS=$((WARNINGS + 1))
fi

# Check dependencies
echo ""
echo "3️⃣  Dependencies:"
if command -v pnpm &> /dev/null; then
  PNPM_VERSION=$(pnpm --version)
  echo "   ✅ pnpm: $PNPM_VERSION"
else
  echo "   ❌ pnpm not found"
  ERRORS=$((ERRORS + 1))
fi

if command -v docker &> /dev/null; then
  DOCKER_VERSION=$(docker --version | awk '{print $3}' | sed 's/,//')
  echo "   ✅ Docker: $DOCKER_VERSION"
else
  echo "   ❌ Docker not found"
  ERRORS=$((ERRORS + 1))
fi

# Check environment files
echo ""
echo "4️⃣  Configuration Files:"
if [ -f ".env.production" ]; then
  echo "   ✅ .env.production exists"
else
  echo "   ⚠️  .env.production not found"
  WARNINGS=$((WARNINGS + 1))
fi

if [ -f "docker-compose.prod.yml" ]; then
  echo "   ✅ docker-compose.prod.yml exists"
else
  echo "   ❌ docker-compose.prod.yml not found"
  ERRORS=$((ERRORS + 1))
fi

# Check Dockerfile
echo ""
echo "5️⃣  Docker Configuration:"
if [ -f "services/api/Dockerfile" ]; then
  echo "   ✅ services/api/Dockerfile exists"
  STAGES=$(grep -c "^FROM" services/api/Dockerfile)
  echo "   ✅ Multi-stage build: $STAGES stages"
else
  echo "   ❌ services/api/Dockerfile not found"
  ERRORS=$((ERRORS + 1))
fi

# Check build scripts
echo ""
echo "6️⃣  Build Configuration:"
if grep -q '"build":' package.json; then
  echo "   ✅ Build script in package.json"
else
  echo "   ⚠️  No build script found"
  WARNINGS=$((WARNINGS + 1))
fi

# Check health check endpoints
echo ""
echo "7️⃣  Health Checks:"
if grep -q "/health" services/api/Dockerfile; then
  echo "   ✅ API HEALTHCHECK configured"
else
  echo "   ⚠️  No HEALTHCHECK in API Dockerfile"
  WARNINGS=$((WARNINGS + 1))
fi

if grep -q "healthcheck:" docker-compose.prod.yml; then
  echo "   ✅ Service health checks configured"
else
  echo "   ⚠️  No service health checks in compose file"
  WARNINGS=$((WARNINGS + 1))
fi

# Summary
echo ""
echo "════════════════════════════════════════════════"
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo "✅ All checks passed! Ready to deploy."
  exit 0
elif [ $ERRORS -eq 0 ]; then
  echo "⚠️  $WARNINGS warning(s) found. Review before deployment."
  exit 0
else
  echo "❌ $ERRORS error(s) found. Fix before deployment."
  exit 1
fi
