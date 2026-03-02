# Deployment Pipeline Overview

This directory contains the deployment automation for The Clubs application.

## Workflows

### 1. **CI (Continuous Integration)** - `.github/workflows/ci.yml`
Runs on all pushes and PRs to `main` and `dev`.

**Jobs:**
- **Lint & Typecheck**: Code quality checks with ESLint and TypeScript
- **Tests**: Unit and integration tests
- **Dependency Audit**: Security vulnerability scanning
- **Build & Archive**: Builds all packages and uploads artifacts

**Triggers:**
- Push to `main` or `dev`
- All pull requests to `main` or `dev`

### 2. **Deploy** - `.github/workflows/deploy.yml`
Single unified workflow that deploys to **production** or **demo** based on target branch.

**Triggers:**
- PR merged to `main` → deploys to **production** environment
- PR merged to `dev` → deploys to **demo** environment
- Manual trigger via `workflow_dispatch` (pick environment)

**Jobs:**
- **Resolve Environment**: Determines target from branch or manual input
- **Build**: Installs deps, builds all packages, uploads artifacts
- **Deploy SPAs**: Uploads React apps to S3 and invalidates CloudFront caches
- **Deploy API**: Builds Docker image, transfers to EC2, deploys with Docker Compose
- **Notify**: Reports final deployment status

## Deployment Flow

### Production (PR → main)

```
PR merged to main
        ↓
Resolve env → "production"
        ↓
Build all packages
        ↓
┌─────────────────────────┐
│         parallel         │
├─────────────┬────────────┤
│ Deploy SPAs │ Deploy API │
│ (S3 + CF)   │ (EC2)      │
└─────────────┴────────────┘
        ↓
Health check & status report
```

### Demo (PR → dev)

```
PR merged to dev
        ↓
Resolve env → "demo"
        ↓
Build all packages
        ↓
┌─────────────────────────┐
│         parallel         │
├─────────────┬────────────┤
│ Deploy SPAs │ Deploy API │
│ (S3 + CF)   │ (EC2)      │
└─────────────┴────────────┘
        ↓
Health check & status report
```

## GitHub Environments

Secrets and variables are stored per-environment. Same names, different values.

### Secrets (per environment)

| Secret | Description |
|---|---|
| `AWS_ROLE_ARN` | IAM role for AWS OIDC federation |
| `EC2_HOST` | EC2 instance IP or hostname |
| `EC2_SSH_KEY` | SSH private key for EC2 |
| `DB_PASSWORD` | PostgreSQL password |
| `KIOSK_TOKEN` | Kiosk authentication token |

### Variables (per environment)

| Variable | Description |
|---|---|
| `VITE_API_BASE_URL` | API URL baked into SPA builds |
| `S3_CUSTOMER_KIOSK` | S3 bucket for customer kiosk |
| `CF_CUSTOMER_KIOSK` | CloudFront distribution ID |
| `S3_EMPLOYEE_REGISTER` | S3 bucket for employee register |
| `CF_EMPLOYEE_REGISTER` | CloudFront distribution ID |
| `S3_OFFICE_DASHBOARD` | S3 bucket for office dashboard (prod only) |
| `CF_OFFICE_DASHBOARD` | CloudFront distribution ID (prod only) |

## Manual Rollback

```bash
ssh ec2-user@<EC2_HOST>
cd /home/ec2-user/the-clubs
docker compose -f docker-compose.prod.yml logs --tail=50 api
# If needed, restart:
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml --env-file /home/ec2-user/.env up -d
```

## Monitoring

```bash
# Container status
ssh ec2-user@<EC2_HOST>
docker compose -f docker-compose.prod.yml ps

# Logs
docker compose -f docker-compose.prod.yml logs -f api

# Health check
curl http://localhost:3000/health
```

## Troubleshooting

### Workflow won't trigger
- Ensure the PR was **merged** (not just closed)
- Check branch protection rules: Settings → Branches
- For manual deploy: Actions → Deploy → Run workflow

### Deployment fails
- Check workflow logs: GitHub → Actions → Deploy
- SSH into EC2 and check container logs
- Verify all environment secrets/variables are set

### Health check timeout
```bash
ssh ec2-user@<EC2_HOST>
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs api
```
