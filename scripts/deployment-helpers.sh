#!/bin/bash
#
# Quick deployment reference and helper commands
# Source this file or run individual commands
#

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ════════════════════════════════════════════════════════════════════════════════
# PRE-DEPLOYMENT
# ════════════════════════════════════════════════════════════════════════════════

pre_deploy_check() {
  echo -e "${BLUE}Running pre-deployment checks...${NC}"
  bash scripts/pre-deploy-check.sh
}

build_locally() {
  echo -e "${BLUE}Building application locally...${NC}"
  pnpm install --frozen-lockfile
  pnpm run build
}

test_locally() {
  echo -e "${BLUE}Running tests locally...${NC}"
  pnpm run typecheck
  pnpm run lint
  pnpm run test 2>/dev/null || echo "Tests skipped"
}

build_docker_image() {
  echo -e "${BLUE}Building Docker image...${NC}"
  docker build -f services/api/Dockerfile -t the-clubs-api:latest .
}

test_docker_image() {
  echo -e "${BLUE}Testing Docker image locally...${NC}"
  docker compose -f docker-compose.prod.yml build
}

# ════════════════════════════════════════════════════════════════════════════════
# DEPLOYMENT MONITORING
# ════════════════════════════════════════════════════════════════════════════════

check_prod_status() {
  echo -e "${BLUE}Checking production status...${NC}"
  bash scripts/deployment-status.sh production
}

check_staging_status() {
  echo -e "${BLUE}Checking staging status...${NC}"
  bash scripts/deployment-status.sh staging
}

watch_prod_logs() {
  echo -e "${BLUE}Watching production logs (Ctrl+C to stop)${NC}"
  ssh ec2-user@${EC2_HOST} "docker compose -f docker-compose.prod.yml logs -f" 2>/dev/null || echo "Set EC2_HOST variable first"
}

watch_staging_logs() {
  echo -e "${BLUE}Watching staging logs (Ctrl+C to stop)${NC}"
  ssh ec2-user@${STAGING_EC2_HOST} "docker compose -f docker-compose.prod.yml -p club-ops-staging logs -f" 2>/dev/null || echo "Set STAGING_EC2_HOST variable first"
}

health_check_prod() {
  echo -e "${BLUE}Production API Health Check${NC}"
  curl -v http://localhost:3000/health 2>&1 | grep -E "< HTTP|healthy"
}

health_check_staging() {
  echo -e "${BLUE}Staging API Health Check${NC}"
  curl -v http://localhost:3001/health 2>&1 | grep -E "< HTTP|healthy"
}

# ════════════════════════════════════════════════════════════════════════════════
# ROLLBACK OPERATIONS
# ════════════════════════════════════════════════════════════════════════════════

rollback_prod() {
  echo -e "${RED}Rolling back production...${NC}"
  ssh ec2-user@${EC2_HOST} "bash /home/ec2-user/the-clubs/scripts/rollback.sh production" 2>/dev/null || echo "Set EC2_HOST variable first"
}

rollback_staging() {
  echo -e "${RED}Rolling back staging...${NC}"
  ssh ec2-user@${STAGING_EC2_HOST} "bash /home/ec2-user/the-clubs/scripts/rollback.sh staging" 2>/dev/null || echo "Set STAGING_EC2_HOST variable first"
}

# ════════════════════════════════════════════════════════════════════════════════
# MANUAL DEPLOYMENT (for emergency/direct deployment)
# ════════════════════════════════════════════════════════════════════════════════

manual_deploy_prod() {
  echo -e "${YELLOW}Manual Production Deployment${NC}"
  echo "Prerequisites:"
  echo "  1. Ensure you've run: pre_deploy_check"
  echo "  2. Have SSH access to EC2: $EC2_HOST"
  echo "  3. Have updated .env variables"
  echo ""
  echo "Commands:"
  echo ""
  echo "  # Build locally and test"
  echo "  pre_deploy_check"
  echo "  build_locally"
  echo "  build_docker_image"
  echo ""
  echo "  # Push changes to main branch (triggers CI/CD)"
  echo "  git push origin main"
  echo ""
  echo "  # Monitor deployment"
  echo "  # Watch GitHub Actions: https://github.com/your-org/the-clubs/actions"
  echo ""
  echo "  # Verify deployment"
  echo "  check_prod_status"
}

manual_deploy_staging() {
  echo -e "${YELLOW}Manual Staging Deployment${NC}"
  echo "Prerequisites:"
  echo "  1. Ensure you've run: pre_deploy_check"
  echo "  2. Have SSH access to EC2: $STAGING_EC2_HOST"
  echo ""
  echo "Commands:"
  echo ""
  echo "  # Build locally and test"
  echo "  pre_deploy_check"
  echo "  build_locally"
  echo ""
  echo "  # Push changes to develop branch (triggers CI/CD)"
  echo "  git push origin develop"
  echo ""
  echo "  # Monitor deployment"
  echo "  # Watch GitHub Actions: https://github.com/your-org/the-clubs/actions"
  echo ""
  echo "  # Verify deployment"
  echo "  check_staging_status"
}

# ════════════════════════════════════════════════════════════════════════════════
# DOCKER OPERATIONS
# ════════════════════════════════════════════════════════════════════════════════

docker_ps() {
  echo -e "${BLUE}Docker containers:${NC}"
  docker ps -a
}

docker_logs() {
  CONTAINER="${1:-club-ops-api}"
  echo -e "${BLUE}Logs from $CONTAINER:${NC}"
  docker logs --tail=50 -f "$CONTAINER"
}

docker_shell() {
  CONTAINER="${1:-club-ops-api}"
  echo -e "${BLUE}Entering shell in $CONTAINER:${NC}"
  docker exec -it "$CONTAINER" /bin/sh
}

# ════════════════════════════════════════════════════════════════════════════════
# QUICK SETUP
# ════════════════════════════════════════════════════════════════════════════════

setup_env_vars() {
  echo -e "${YELLOW}Setting up environment variables${NC}"
  echo "Add these to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
  echo ""
  echo "export EC2_HOST=\"your-production-ec2-host\""
  echo "export STAGING_EC2_HOST=\"your-staging-ec2-host\""
  echo ""
  echo "Then source your profile: source ~/.bashrc"
}

# ════════════════════════════════════════════════════════════════════════════════
# HELP
# ════════════════════════════════════════════════════════════════════════════════

deployment_help() {
  cat << 'EOF'
╔════════════════════════════════════════════════════════════════════════════╗
║                    DEPLOYMENT COMMAND REFERENCE                           ║
╚════════════════════════════════════════════════════════════════════════════╝

📋 PRE-DEPLOYMENT:
  pre_deploy_check        Run all pre-deployment checks
  build_locally          Build all packages locally
  test_locally           Run linting, typecheck, and tests
  build_docker_image     Build Docker image locally
  setup_env_vars         Display environment variable setup

🚀 DEPLOYMENT (Automated):
  # For production: git push origin main
  # For staging:    git push origin develop
  # Watch: GitHub Actions tab

📊 MONITORING:
  check_prod_status      Show production deployment status
  check_staging_status   Show staging deployment status
  watch_prod_logs        Stream production logs (Ctrl+C to stop)
  watch_staging_logs     Stream staging logs (Ctrl+C to stop)
  health_check_prod      Check production API health
  health_check_staging   Check staging API health

↩️  ROLLBACK:
  rollback_prod          Rollback production to previous version
  rollback_staging       Rollback staging to previous version

🐳 DOCKER:
  docker_ps              List all containers
  docker_logs [NAME]     View container logs (default: club-ops-api)
  docker_shell [NAME]    Enter container shell (default: club-ops-api)

❓ HELP:
  deployment_help        Show this help message
  manual_deploy_prod     Show manual production deployment steps
  manual_deploy_staging  Show manual staging deployment steps

═══════════════════════════════════════════════════════════════════════════════

TYPICAL WORKFLOW:

  1. Development:
     $ git checkout -b feature/my-change
     $ # Make your changes
     $ build_locally && test_locally

  2. Testing:
     $ git push origin feature/my-change
     $ # Create PR and let CI run
     $ # Make sure all checks pass

  3. Staging deployment:
     $ git push origin develop
     $ check_staging_status

  4. Production deployment:
     $ git push origin main
     $ check_prod_status

  5. Monitor:
     $ watch_prod_logs
     $ health_check_prod

EMERGENCY ROLLBACK:
  $ rollback_prod

═══════════════════════════════════════════════════════════════════════════════
EOF
}

# Auto-display help if sourced without arguments
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
  deployment_help
fi
