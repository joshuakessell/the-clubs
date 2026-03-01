# Deployment Pipeline Overview

This directory contains the deployment automation for The Clubs application.

## Workflows

### 1. **CI (Continuous Integration)** - `.github/workflows/ci.yml`
Runs on all pushes and PRs to `main` and `develop`.

**Jobs:**
- **Lint & Typecheck**: Code quality checks with ESLint and TypeScript
- **Tests**: Unit and integration tests
- **Dependency Audit**: Security vulnerability scanning
- **Build & Archive**: Builds all packages and uploads artifacts

**Triggers:**
- Push to `main` or `develop`
- All pull requests

### 2. **Deploy to Production** - `.github/workflows/deploy-production.yml`
Automatically deploys to production when changes are pushed to `main`.

**Jobs:**
- **Build & Test**: Runs full CI checks
- **Build & Push Image**: Builds Docker image and pushes to GitHub Container Registry
- **Deploy SPAs**: Uploads React apps to S3 and invalidates CloudFront caches
- **Deploy API**: Transfers and deploys API to EC2
- **Notify**: Reports final deployment status

**Environment variables needed:**
- `AWS_ROLE_ARN` (secret): IAM role for AWS OIDC
- `S3_CUSTOMER_KIOSK`, `S3_EMPLOYEE_REGISTER`, `S3_OFFICE_DASHBOARD` (vars): S3 bucket names
- `CF_CUSTOMER_KIOSK`, `CF_EMPLOYEE_REGISTER`, `CF_OFFICE_DASHBOARD` (vars): CloudFront distribution IDs
- `EC2_HOST`, `EC2_SSH_KEY`, `DB_PASSWORD` (secrets): EC2 connection details

### 3. **Deploy to Staging** - `.github/workflows/deploy-staging.yml`
Automatically deploys to staging when changes are pushed to `develop`.

**Triggers:**
- Push to `develop`
- Manual trigger via `workflow_dispatch`

**Environment variables needed:**
- `STAGING_EC2_HOST`, `EC2_SSH_KEY`, `STAGING_DB_PASSWORD` (secrets)

## Deployment Flow

### Production Deployment

```
main branch push
        ↓
CI checks (lint, test, audit)
        ↓
Build all packages & archive artifacts
        ↓
┌─────────────────────────┬──────────────────┐
│                         │                  │
Build Docker Image    Deploy SPAs         Deploy API
  (push to GHCR)       (S3+CloudFront)    (EC2)
│                         │                  │
└─────────────────────────┴──────────────────┘
        ↓
Health checks & notifications
```

### Staging Deployment

```
develop branch push
        ↓
CI checks
        ↓
Build artifacts
        ↓
Deploy API to Staging EC2
        ↓
Health check
```

## Docker Image Registry

Images are pushed to GitHub Container Registry (GHCR) with the following tags:
- `latest` - Latest build from main
- `main-<sha>` - Specific commit hash
- Branch name tags
- Semantic version tags (if using git tags)

### Pulling Images

```bash
# Login to GHCR
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Pull the image
docker pull ghcr.io/your-org/the-clubs-api:latest
```

## Secrets & Variables Configuration

### GitHub Secrets (Repository Settings → Secrets and variables → Secrets)

**Production:**
- `AWS_ROLE_ARN`: ARN of IAM role for AWS OIDC federation
- `EC2_HOST`: IP or hostname of production EC2 instance
- `EC2_SSH_KEY`: SSH private key for EC2 (multiline)
- `DB_PASSWORD`: PostgreSQL password for production

**Staging:**
- `STAGING_EC2_HOST`: IP or hostname of staging EC2 instance
- `STAGING_DB_PASSWORD`: PostgreSQL password for staging

### GitHub Variables (Repository Settings → Secrets and variables → Variables)

**S3 & CloudFront:**
- `S3_CUSTOMER_KIOSK`: S3 bucket for customer kiosk
- `CF_CUSTOMER_KIOSK`: CloudFront distribution ID for customer kiosk
- `S3_EMPLOYEE_REGISTER`: S3 bucket for employee register
- `CF_EMPLOYEE_REGISTER`: CloudFront distribution ID for employee register
- `S3_OFFICE_DASHBOARD`: S3 bucket for office dashboard
- `CF_OFFICE_DASHBOARD`: CloudFront distribution ID for office dashboard

## Manual Rollback

If a deployment fails, use the rollback script:

```bash
# Rollback production
ssh ec2-user@<EC2_HOST> '/home/ec2-user/the-clubs/scripts/rollback.sh production'

# Rollback staging
ssh ec2-user@<STAGING_EC2_HOST> '/home/ec2-user/the-clubs/scripts/rollback.sh staging'
```

Or copy and execute directly:

```bash
scp scripts/rollback.sh ec2-user@<EC2_HOST>:/home/ec2-user/
ssh ec2-user@<EC2_HOST> 'chmod +x /home/ec2-user/rollback.sh && /home/ec2-user/rollback.sh production'
```

## Monitoring Deployments

### View Workflow Runs

Navigate to your repository → **Actions** tab to see:
- Current and past workflow runs
- Job logs and step details
- Artifact uploads/downloads

### Check Container Status on EC2

```bash
ssh ec2-user@<EC2_HOST>

# See running containers
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f db

# Health check
curl http://localhost:3000/health
```

### Check S3 & CloudFront

```bash
# List uploaded files
aws s3 ls s3://your-bucket-name/

# Check CloudFront cache
aws cloudfront list-invalidations \
  --distribution-id YOUR_DISTRIBUTION_ID \
  --query 'InvalidationList.Items[0]'
```

## Troubleshooting

### Workflow Failures

1. **Check the workflow run** in GitHub Actions
2. **View detailed logs** by expanding failed steps
3. **Common issues:**
   - Missing secrets: Verify all GitHub secrets are set
   - Docker build fails: Check Dockerfile and build context
   - Health check timeout: SSH into EC2 and check container logs

### Deployment Issues

**API won't start:**
```bash
docker logs club-ops-api
# Check DATABASE_URL, environment variables, and port availability
```

**SPA not updating:**
```bash
# Check S3 upload
aws s3 ls s3://your-bucket/ --recursive

# Invalidate CloudFront cache manually
aws cloudfront create-invalidation \
  --distribution-id YOUR_DISTRIBUTION_ID \
  --paths "/*"
```

**Database connection failed:**
```bash
docker logs club-ops-db
# Verify DB_PASSWORD, POSTGRES_USER, POSTGRES_DB match .env
```

## Local Development

For local multi-service development:

```bash
# Start database
docker compose up -d db

# Run all services in development mode
pnpm dev

# Run with hot-reload
pnpm dev:runner
```

For production-like testing locally:

```bash
# Build images
docker compose -f docker-compose.prod.yml build

# Run services
docker compose -f docker-compose.prod.yml up -d

# Check status
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f
```

## CI/CD Best Practices

1. **Always test locally before pushing**
   ```bash
   pnpm install
   pnpm build
   pnpm run typecheck
   pnpm run lint
   ```

2. **Use feature branches and PRs**
   - Push to feature branch
   - Create PR for review
   - CI runs automatically
   - Merge after approval

3. **Test in staging first**
   - Push to `develop` to deploy to staging
   - Verify changes work in staging environment
   - Only promote to production via `main` branch

4. **Monitor deployments**
   - Watch workflow runs in GitHub Actions
   - Check health endpoints post-deployment
   - Keep recent backups available for rollback

5. **Secrets rotation**
   - Rotate AWS credentials periodically
   - Update SSH keys when team changes
   - Never commit secrets to git

## Performance Notes

- **Docker image caching**: Uses GitHub Actions cache for faster builds
- **Parallel jobs**: SPA and API deployments run in parallel
- **Artifact cleanup**: Artifacts are retained for 1 day to reduce storage
- **BuildKit**: Enabled for multi-stage build optimization
