#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# AWS Infrastructure Setup for the-clubs
#
# Creates: VPC, Security Group, Key Pair, EC2 t3.micro, Elastic IP,
#          3× S3 buckets (static hosting), IAM deploy user.
#
# Prerequisites:
#   - AWS CLI v2 installed and configured (`aws configure`)
#   - Region set (defaults to us-east-1)
#
# Usage:
#   chmod +x scripts/infra-setup.sh
#   ./scripts/infra-setup.sh
#
# Idempotent: safe to re-run (skips existing resources).
###############################################################################

REGION="${AWS_REGION:-us-east-1}"
PROJECT="the-clubs"
KEY_NAME="${PROJECT}-deploy"
SG_NAME="${PROJECT}-sg"
INSTANCE_TYPE="t3.micro"

# S3 bucket names — must be globally unique, change if taken
S3_CUSTOMER_KIOSK="${PROJECT}-customer-kiosk"
S3_EMPLOYEE_REGISTER="${PROJECT}-employee-register"
S3_OFFICE_DASHBOARD="${PROJECT}-office-dashboard"

echo "=== the-clubs AWS Infrastructure Setup ==="
echo "Region: $REGION"
echo ""

###############################################################################
# 1. Key Pair (for SSH into EC2)
###############################################################################
echo "--- [1/6] Key Pair ---"
if aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region "$REGION" &>/dev/null; then
  echo "Key pair '$KEY_NAME' already exists, skipping."
else
  aws ec2 create-key-pair \
    --key-name "$KEY_NAME" \
    --region "$REGION" \
    --query 'KeyMaterial' \
    --output text > "${KEY_NAME}.pem"
  chmod 400 "${KEY_NAME}.pem"
  echo "✓ Created key pair: ${KEY_NAME}.pem (KEEP THIS SAFE!)"
fi

###############################################################################
# 2. Security Group
###############################################################################
echo ""
echo "--- [2/6] Security Group ---"
VPC_ID=$(aws ec2 describe-vpcs --region "$REGION" --filters "Name=isDefault,Values=true" --query 'Vpcs[0].VpcId' --output text)
echo "Using default VPC: $VPC_ID"

SG_ID=$(aws ec2 describe-security-groups \
  --region "$REGION" \
  --filters "Name=group-name,Values=$SG_NAME" "Name=vpc-id,Values=$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null)

if [ "$SG_ID" != "None" ] && [ -n "$SG_ID" ]; then
  echo "Security group '$SG_NAME' already exists: $SG_ID"
else
  SG_ID=$(aws ec2 create-security-group \
    --group-name "$SG_NAME" \
    --description "the-clubs API + SSH access" \
    --vpc-id "$VPC_ID" \
    --region "$REGION" \
    --query 'GroupId' --output text)

  # SSH
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 22 --cidr 0.0.0.0/0 --region "$REGION"
  # HTTP
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 80 --cidr 0.0.0.0/0 --region "$REGION"
  # HTTPS
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 443 --cidr 0.0.0.0/0 --region "$REGION"
  # API port
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 3000 --cidr 0.0.0.0/0 --region "$REGION"

  echo "✓ Created security group: $SG_ID"
fi

###############################################################################
# 3. EC2 Instance
###############################################################################
echo ""
echo "--- [3/6] EC2 Instance ---"

EXISTING_INSTANCE=$(aws ec2 describe-instances \
  --region "$REGION" \
  --filters "Name=tag:Name,Values=${PROJECT}-api" "Name=instance-state-name,Values=running,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null)

if [ "$EXISTING_INSTANCE" != "None" ] && [ -n "$EXISTING_INSTANCE" ]; then
  INSTANCE_ID="$EXISTING_INSTANCE"
  echo "EC2 instance already exists: $INSTANCE_ID"
else
  # Amazon Linux 2023 AMI (x86_64) — automatically picks the latest
  AMI_ID=$(aws ec2 describe-images \
    --region "$REGION" \
    --owners amazon \
    --filters "Name=name,Values=al2023-ami-2023*-x86_64" "Name=state,Values=available" \
    --query 'sort_by(Images, &CreationDate)[-1].ImageId' --output text)

  echo "Using AMI: $AMI_ID"

  # User data script to install Docker + Docker Compose on first boot
  USER_DATA=$(cat <<'USERDATA'
#!/bin/bash
yum update -y
yum install -y docker git
systemctl enable docker
systemctl start docker
usermod -aG docker ec2-user

# Install Docker Compose v2
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Install Node.js 22 (for pnpm builds)
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
yum install -y nodejs
npm install -g pnpm@10
USERDATA
)

  INSTANCE_ID=$(aws ec2 run-instances \
    --region "$REGION" \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SG_ID" \
    --user-data "$USER_DATA" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${PROJECT}-api}]" \
    --query 'Instances[0].InstanceId' --output text)

  echo "✓ Launched EC2 instance: $INSTANCE_ID"
  echo "  Waiting for instance to be running..."
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"
  echo "  ✓ Instance is running."
fi

###############################################################################
# 4. Elastic IP
###############################################################################
echo ""
echo "--- [4/6] Elastic IP ---"

EXISTING_EIP=$(aws ec2 describe-addresses \
  --region "$REGION" \
  --filters "Name=instance-id,Values=$INSTANCE_ID" \
  --query 'Addresses[0].PublicIp' --output text 2>/dev/null)

if [ "$EXISTING_EIP" != "None" ] && [ -n "$EXISTING_EIP" ]; then
  PUBLIC_IP="$EXISTING_EIP"
  echo "Elastic IP already attached: $PUBLIC_IP"
else
  ALLOC_ID=$(aws ec2 allocate-address --domain vpc --region "$REGION" --query 'AllocationId' --output text)
  aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID" --region "$REGION" >/dev/null
  PUBLIC_IP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC_ID" --region "$REGION" --query 'Addresses[0].PublicIp' --output text)
  echo "✓ Allocated and attached Elastic IP: $PUBLIC_IP"
fi

###############################################################################
# 5. S3 Buckets (static website hosting)
###############################################################################
echo ""
echo "--- [5/6] S3 Buckets ---"

create_static_bucket() {
  local BUCKET_NAME="$1"
  local DISPLAY_NAME="$2"

  if aws s3api head-bucket --bucket "$BUCKET_NAME" --region "$REGION" 2>/dev/null; then
    echo "  Bucket '$BUCKET_NAME' already exists, skipping."
  else
    aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$REGION" \
      $([ "$REGION" != "us-east-1" ] && echo "--create-bucket-configuration LocationConstraint=$REGION") \
      >/dev/null

    # Enable static website hosting
    aws s3 website "s3://${BUCKET_NAME}" --index-document index.html --error-document index.html

    # Public access policy for static hosting
    aws s3api put-public-access-block --bucket "$BUCKET_NAME" \
      --public-access-block-configuration "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

    aws s3api put-bucket-policy --bucket "$BUCKET_NAME" --policy "{
      \"Version\": \"2012-10-17\",
      \"Statement\": [{
        \"Sid\": \"PublicRead\",
        \"Effect\": \"Allow\",
        \"Principal\": \"*\",
        \"Action\": \"s3:GetObject\",
        \"Resource\": \"arn:aws:s3:::${BUCKET_NAME}/*\"
      }]
    }"

    echo "  ✓ Created bucket: $DISPLAY_NAME → http://${BUCKET_NAME}.s3-website-${REGION}.amazonaws.com"
  fi
}

create_static_bucket "$S3_CUSTOMER_KIOSK" "Customer Kiosk"
create_static_bucket "$S3_EMPLOYEE_REGISTER" "Employee Register"
create_static_bucket "$S3_OFFICE_DASHBOARD" "Office Dashboard"

###############################################################################
# 6. IAM Deploy User (for GitHub Actions)
###############################################################################
echo ""
echo "--- [6/6] IAM Deploy User ---"

IAM_USER="${PROJECT}-deployer"

if aws iam get-user --user-name "$IAM_USER" &>/dev/null; then
  echo "IAM user '$IAM_USER' already exists, skipping."
else
  aws iam create-user --user-name "$IAM_USER" >/dev/null

  # Policy: S3 deploy + ECR (future)
  aws iam put-user-policy --user-name "$IAM_USER" --policy-name "${PROJECT}-deploy-policy" --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {
        \"Sid\": \"S3Deploy\",
        \"Effect\": \"Allow\",
        \"Action\": [\"s3:PutObject\", \"s3:DeleteObject\", \"s3:ListBucket\", \"s3:GetBucketLocation\"],
        \"Resource\": [
          \"arn:aws:s3:::${S3_CUSTOMER_KIOSK}\",
          \"arn:aws:s3:::${S3_CUSTOMER_KIOSK}/*\",
          \"arn:aws:s3:::${S3_EMPLOYEE_REGISTER}\",
          \"arn:aws:s3:::${S3_EMPLOYEE_REGISTER}/*\",
          \"arn:aws:s3:::${S3_OFFICE_DASHBOARD}\",
          \"arn:aws:s3:::${S3_OFFICE_DASHBOARD}/*\"
        ]
      }
    ]
  }"

  # Create access keys for GitHub Actions
  KEYS=$(aws iam create-access-key --user-name "$IAM_USER")
  ACCESS_KEY=$(echo "$KEYS" | python3 -c "import sys,json; print(json.load(sys.stdin)['AccessKey']['AccessKeyId'])")
  SECRET_KEY=$(echo "$KEYS" | python3 -c "import sys,json; print(json.load(sys.stdin)['AccessKey']['SecretAccessKey'])")

  echo "✓ Created IAM user: $IAM_USER"
  echo ""
  echo "╔═══════════════════════════════════════════════════════════════╗"
  echo "║  SAVE THESE — Add as GitHub Actions Secrets:                 ║"
  echo "║                                                              ║"
  echo "║  AWS_ACCESS_KEY_ID:     $ACCESS_KEY"
  echo "║  AWS_SECRET_ACCESS_KEY: $SECRET_KEY"
  echo "║                                                              ║"
  echo "╚═══════════════════════════════════════════════════════════════╝"
fi

###############################################################################
# Summary
###############################################################################
echo ""
echo "============================================================"
echo "  ✅ Infrastructure Setup Complete"
echo "============================================================"
echo ""
echo "  EC2 Instance:      $INSTANCE_ID"
echo "  Public IP:         $PUBLIC_IP"
echo "  API URL:           http://${PUBLIC_IP}:3000"
echo ""
echo "  Customer Kiosk:    http://${S3_CUSTOMER_KIOSK}.s3-website-${REGION}.amazonaws.com"
echo "  Employee Register: http://${S3_EMPLOYEE_REGISTER}.s3-website-${REGION}.amazonaws.com"
echo "  Office Dashboard:  http://${S3_OFFICE_DASHBOARD}.s3-website-${REGION}.amazonaws.com"
echo ""
echo "  SSH:               ssh -i ${KEY_NAME}.pem ec2-user@${PUBLIC_IP}"
echo ""
echo "  ┌─────────────────────────────────────────────────────────┐"
echo "  │  NEXT STEPS:                                            │"
echo "  │                                                         │"
echo "  │  1. Add GitHub Secrets (Settings → Secrets → Actions):  │"
echo "  │     • AWS_ACCESS_KEY_ID                                 │"
echo "  │     • AWS_SECRET_ACCESS_KEY                             │"
echo "  │     • EC2_HOST = $PUBLIC_IP"
echo "  │     • EC2_SSH_KEY = contents of ${KEY_NAME}.pem"
echo "  │     • DB_PASSWORD = (choose a strong password)          │"
echo "  │                                                         │"
echo "  │  2. SSH into EC2 and create .env:                       │"
echo "  │     ssh -i ${KEY_NAME}.pem ec2-user@${PUBLIC_IP}"
echo "  │     echo 'DB_PASSWORD=your-strong-password' > .env      │"
echo "  │                                                         │"
echo "  │  3. Push to main — GitHub Actions will deploy!          │"
echo "  └─────────────────────────────────────────────────────────┘"
echo ""
