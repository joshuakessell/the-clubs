# GitHub Actions Setup Guide

This guide walks through configuring GitHub Actions secrets and variables for automated deployment.

## Prerequisites

- GitHub repository with admin access
- AWS account with IAM permissions
- EC2 instance(s) for deployment
- SSH key pair for EC2 access

## Step 1: Create GitHub Secrets

Navigate to **Settings → Secrets and variables → Secrets** and add:

### Production Secrets

| Secret Name | Description | Example |
|---|---|---|
| `AWS_ROLE_ARN` | IAM role ARN for OIDC federation | `arn:aws:iam::123456789:role/GitHubActionsRole` |
| `EC2_HOST` | Production EC2 instance IP/hostname | `prod.example.com` or `54.123.45.67` |
| `EC2_SSH_KEY` | SSH private key for EC2 (multiline) | (paste full private key) |
| `DB_PASSWORD` | PostgreSQL password for production | (secure password) |

### Staging Secrets

| Secret Name | Description | Example |
|---|---|---|
| `STAGING_EC2_HOST` | Staging EC2 instance IP/hostname | `staging.example.com` or `54.123.45.68` |
| `STAGING_DB_PASSWORD` | PostgreSQL password for staging | (secure password) |

## Step 2: Create GitHub Variables

Navigate to **Settings → Secrets and variables → Variables** and add:

### S3 & CloudFront Variables

| Variable Name | Description | Example |
|---|---|---|
| `S3_CUSTOMER_KIOSK` | S3 bucket for customer kiosk app | `my-org-customer-kiosk` |
| `CF_CUSTOMER_KIOSK` | CloudFront distribution ID | `E1234ABCD5678` |
| `S3_EMPLOYEE_REGISTER` | S3 bucket for employee register | `my-org-employee-register` |
| `CF_EMPLOYEE_REGISTER` | CloudFront distribution ID | `E2345BCDE6789` |
| `S3_OFFICE_DASHBOARD` | S3 bucket for office dashboard | `my-org-office-dashboard` |
| `CF_OFFICE_DASHBOARD` | CloudFront distribution ID | `E3456CDEF7890` |

## Step 3: Configure AWS OIDC (for S3/CloudFront Deployment)

### Create IAM Role for GitHub Actions

```bash
# 1. Create trust policy JSON file
cat > trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:YOUR_ORG/the-clubs:ref:refs/heads/main"
        }
      }
    }
  ]
}
EOF

# 2. Create the role
aws iam create-role \
  --role-name GitHubActionsTheClubs \
  --assume-role-policy-document file://trust-policy.json

# 3. Create and attach policy for S3 and CloudFront
cat > policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::my-org-customer-kiosk/*",
        "arn:aws:s3:::my-org-customer-kiosk",
        "arn:aws:s3:::my-org-employee-register/*",
        "arn:aws:s3:::my-org-employee-register",
        "arn:aws:s3:::my-org-office-dashboard/*",
        "arn:aws:s3:::my-org-office-dashboard"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "*"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name GitHubActionsTheClubs \
  --policy-name GitHubActionsPolicy \
  --policy-document file://policy.json
```

### Add AWS_ROLE_ARN to GitHub Secrets

Get the role ARN:
```bash
aws iam get-role --role-name GitHubActionsTheClubs \
  --query 'Role.Arn' --output text
```

Add this as the `AWS_ROLE_ARN` secret in GitHub.

## Step 4: Configure EC2 SSH Access

### Generate SSH Key Pair (if needed)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github-actions -N ""
```

### Add Public Key to EC2

```bash
# Copy public key to EC2
ssh-copy-id -i ~/.ssh/github-actions.pub ec2-user@your-ec2-host

# Or manually add to ~/.ssh/authorized_keys on EC2
cat ~/.ssh/github-actions.pub | ssh ec2-user@your-ec2-host 'cat >> ~/.ssh/authorized_keys'
```

### Add Private Key to GitHub Secrets

Get the private key content:
```bash
cat ~/.ssh/github-actions
```

Add the entire multiline output as the `EC2_SSH_KEY` secret in GitHub.

## Step 5: Configure EC2 Instance

### Install Docker and Docker Compose

```bash
ssh ec2-user@your-ec2-host

# Update system
sudo yum update -y

# Install Docker
sudo amazon-linux-extras install docker -y
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -a -G docker ec2-user

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install Docker Buildx
mkdir -p ~/.docker/cli-plugins
curl -L https://github.com/docker/buildx/releases/download/v0.21.2/buildx-v0.21.2.linux-amd64 -o ~/.docker/cli-plugins/docker-buildx
chmod +x ~/.docker/cli-plugins/docker-buildx
```

### Create Deployment Directory

```bash
mkdir -p /home/ec2-user/the-clubs
cd /home/ec2-user/the-clubs
```

### Create Initial .env File

```bash
cat > /home/ec2-user/.env << 'EOF'
DB_NAME=club_operations
DB_USER=clubops
DB_PASSWORD=your-secure-password-here
CORS_ORIGINS=*
EOF
```

## Step 6: Verify Configuration

### Test GitHub Actions Access

```bash
# Check workflow runs in GitHub Actions tab
# Settings → Workflows and Actions → All Workflows
```

### Test EC2 Connectivity

```bash
# From your local machine, verify SSH works
ssh -i ~/.ssh/github-actions ec2-user@your-ec2-host "docker --version"
```

### Test Docker Image Registry

```bash
# Login to GitHub Container Registry
echo ${{ secrets.GITHUB_TOKEN }} | docker login ghcr.io -u ${{ github.actor }} --password-stdin

# Pull a test image to verify
docker pull ghcr.io/your-org/the-clubs-api:latest
```

## Step 7: Test Full Deployment Pipeline

### Trigger Demo Deployment

```bash
# Create and merge a PR targeting dev to trigger demo deployment
# Or use workflow_dispatch for manual trigger

# Monitor in GitHub Actions tab
# GitHub → Actions → Deploy to Demo
```

### Monitor Logs

```bash
# View workflow logs
# GitHub → Actions → Deploy to Demo → View logs

# SSH into demo server and check container
ssh -i ~/.ssh/github-actions ec2-user@your-staging-host
docker compose -f docker-compose.prod.yml logs
```

### Trigger Production Deployment

```bash
# Create and merge a PR targeting main to trigger production deployment

# Monitor deployment
# GitHub → Actions → Deploy to Production

# Verify in production
ssh -i ~/.ssh/github-actions ec2-user@your-prod-host
docker compose -f docker-compose.prod.yml ps
curl http://localhost:3000/health
```

## Troubleshooting

### Workflow Fails to Start

**Issue**: Workflow not triggering on push
- **Solution**: Ensure branch protection rules allow Actions
- Check: Settings → Branches → Branch protection rules

### AWS OIDC Authentication Failed

**Issue**: `InvalidIdentityToken` error
- **Solution**: Verify trust policy in IAM role
- Check: AWS Console → IAM → Roles → GitHubActionsTheClubs

### SSH Connection Refused

**Issue**: Can't connect to EC2
- **Solution**: Check security group allows SSH (port 22)
- Verify: EC2 → Security Groups → Inbound Rules

### Docker Image Build Fails

**Issue**: `docker buildx` not found on EC2
- **Solution**: Re-run EC2 setup script or manually install buildx
- Command: `curl -L https://github.com/docker/buildx/releases/download/v0.21.2/buildx-v0.21.2.linux-amd64 -o ~/.docker/cli-plugins/docker-buildx && chmod +x ~/.docker/cli-plugins/docker-buildx`

### Health Check Timeout

**Issue**: Deployment succeeds but health check fails
- **Solution**: Check container logs and database connectivity
- Debug:
  ```bash
  ssh ec2-user@your-host
  docker compose -f docker-compose.prod.yml logs api
  docker compose -f docker-compose.prod.yml exec db pg_isready -U clubops
  ```

## Security Best Practices

1. **Rotate secrets regularly**
   - SSH keys: Every 6-12 months
   - DB passwords: Every quarter

2. **Use branch protection rules**
   - Require PR reviews before merge to `main`
   - Enable status checks

3. **Monitor deployments**
   - Check GitHub Actions logs
   - Set up CloudWatch alarms for EC2 instances
   - Monitor container health endpoints

4. **Limit permissions**
   - IAM role scoped to specific S3 buckets and distributions
   - SSH key access limited to deployment servers only

5. **Audit changes**
   - Review commits before merging to `main`
   - Keep deployment logs for compliance
