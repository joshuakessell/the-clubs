# Deployment Pipeline Quick Start

## What's New

I've created a comprehensive deployment pipeline for The Clubs with:

- **3 GitHub Actions workflows** for automated CI/CD
- **2 deployment environments** (production & staging)
- **Docker image registry** integration (GitHub Container Registry)
- **Rollback automation** with health checks
- **Deployment monitoring tools** and utilities
- **Complete documentation** and setup guides

## Files Created

### GitHub Actions Workflows

```
.github/workflows/
├── ci.yml                           ← Runs on all PRs and pushes
├── deploy-production.yml            ← Deploys to production (main branch)
├── deploy-staging.yml               ← Deploys to staging (develop branch)
├── deploy.yml                       ← (existing, can be removed)
└── security.yml                     ← (existing, can be kept)
```

### Helper Scripts

```
scripts/
├── deployment-helpers.sh            ← Quick commands for deployment tasks
├── deployment-status.sh             ← Check deployment status and logs
├── pre-deploy-check.sh              ← Validate before deployment
└── rollback.sh                      ← Emergency rollback script
```

### Documentation

```
docs/
├── DEPLOYMENT_PIPELINE.md           ← Overview and workflow explanation
└── GITHUB_ACTIONS_SETUP.md          ← Step-by-step setup guide
```

### Docker Configuration

```
docker-compose.monitoring.yml        ← Logging configuration for production
```

## Deployment Flow

### Production (main → production)
```
Feature Branch
    ↓
GitHub PR (CI runs)
    ↓
Review & Merge to main
    ↓
CI checks (lint, test, build)
    ↓
Build Docker image → Push to GHCR
    ↓
Deploy SPAs to S3 + CloudFront
    ↓
Deploy API to EC2 + Health Check
    ↓
✅ Production live
```

### Staging (develop → staging)
```
Push to develop
    ↓
CI checks
    ↓
Deploy API to Staging EC2
    ↓
Health check
    ↓
✅ Staging updated
```

## Quick Setup (5 Steps)

### 1. Add GitHub Secrets
Navigate to **Settings → Secrets and variables → Secrets**:

```
Production:
  - AWS_ROLE_ARN
  - EC2_HOST
  - EC2_SSH_KEY
  - DB_PASSWORD

Staging:
  - STAGING_EC2_HOST
  - STAGING_DB_PASSWORD
```

See `docs/GITHUB_ACTIONS_SETUP.md` for detailed instructions.

### 2. Add GitHub Variables
Navigate to **Settings → Secrets and variables → Variables**:

```
S3 & CloudFront:
  - S3_CUSTOMER_KIOSK, CF_CUSTOMER_KIOSK
  - S3_EMPLOYEE_REGISTER, CF_EMPLOYEE_REGISTER
  - S3_OFFICE_DASHBOARD, CF_OFFICE_DASHBOARD
```

### 3. Configure EC2 Instances
```bash
# On each EC2 instance (production & staging)
ssh ec2-user@your-host

# Run setup
sudo yum update -y
sudo amazon-linux-extras install docker -y
sudo usermod -a -G docker ec2-user
sudo systemctl start docker

# Install docker-compose and buildx
sudo curl -L https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m) -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 4. Test Staging Deployment
```bash
# Push to develop branch
git push origin develop

# Watch GitHub Actions
# GitHub → Actions → Deploy to Staging

# Verify
curl http://staging-host:3001/health
```

### 5. Deploy to Production
```bash
# After testing in staging, push to main
git push origin main

# Watch GitHub Actions
# GitHub → Actions → Deploy to Production

# Verify
curl http://prod-host:3000/health
```

## Common Commands

### Using Helper Scripts

```bash
# Source the helpers
source scripts/deployment-helpers.sh

# Pre-deployment checks
pre_deploy_check

# Build locally
build_locally

# Check production status
check_prod_status

# Watch logs
watch_prod_logs

# Emergency rollback
rollback_prod
```

### Manual Operations

```bash
# Check container status
ssh ec2-user@your-host
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f api

# Health check
curl http://localhost:3000/health

# Rollback manually
bash scripts/rollback.sh production
```

## Key Features

### ✅ Automated Testing
- Lint checks
- TypeScript type checking
- Unit tests
- Dependency audits

### ✅ Docker Image Registry
- Images pushed to GitHub Container Registry
- Tagged with commit SHA, branch, and `latest`
- Full build cache support
- Multi-stage builds

### ✅ Parallel Deployments
- SPA and API deployments run simultaneously
- CloudFront cache invalidation on SPA deploy
- S3 versioning for rollback

### ✅ Health Checks
- API health endpoint validation
- Database connectivity checks
- Automatic rollback on failures
- 30-second health check timeout

### ✅ Rollback Support
- Previous deployment state backed up
- One-command rollback scripts
- Automatic health verification

### ✅ Monitoring
- Deployment status checker
- Container resource usage
- Log streaming
- Status reports

## Troubleshooting

### Workflow won't trigger
```bash
# Check branch protection rules
# Settings → Branches → Branch protection rules

# Ensure you have write access to the repo
```

### Deployment fails
```bash
# Check workflow logs
# GitHub → Actions → [Workflow Name] → Job logs

# Check EC2
ssh ec2-user@your-host
docker compose -f docker-compose.prod.yml logs --tail=100 api
```

### Health check fails
```bash
# SSH into the instance
ssh ec2-user@your-host

# Check containers
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs api

# Check if port is in use
ss -tlnp | grep 3000
```

### Need to rollback
```bash
# Immediate rollback
source scripts/deployment-helpers.sh
rollback_prod

# Or manually
ssh ec2-user@your-host
bash /home/ec2-user/the-clubs/scripts/rollback.sh production
```

## Next Steps

1. **Read the setup guide**: `docs/GITHUB_ACTIONS_SETUP.md`
2. **Configure GitHub secrets and variables** (5-10 minutes)
3. **Set up EC2 instances** if not already done
4. **Test staging deployment** with a push to develop
5. **Monitor logs** in GitHub Actions

## Documentation Files

- **DEPLOYMENT_PIPELINE.md** - Full pipeline overview, workflows, and operations
- **GITHUB_ACTIONS_SETUP.md** - Step-by-step AWS OIDC and GitHub setup

## Support

For issues or questions:

1. Check workflow logs in GitHub Actions
2. Review Docker logs on EC2: `docker logs -f club-ops-api`
3. Verify health endpoints: `curl http://host:3000/health`
4. Use rollback if needed: `bash scripts/rollback.sh production`

---

**Deployment is now fully automated.** Push to `main` for production, `develop` for staging. Let me know if you have any questions!
