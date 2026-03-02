terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

locals {
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  # SPA definitions — each gets S3 + CloudFront + IAM policy
  spas = {
    customer-kiosk = {
      name   = "customer-kiosk"
      domain = var.domain_customer_kiosk
    }
    employee-register = {
      name   = "employee-register"
      domain = var.domain_employee_register
    }
    office-dashboard = {
      name   = "office-dashboard"
      domain = var.domain_office_dashboard
    }
  }

  # Whether any SPA uses a custom domain
  has_custom_domains = anytrue([for k, v in local.spas : v.domain != ""])

  # Resolved ACM ARN — user-provided or auto-created
  acm_arn = var.acm_certificate_arn != "" ? var.acm_certificate_arn : (
    local.has_custom_domains ? aws_acm_certificate.spa[0].arn : ""
  )
}


# ══════════════════════════════════════════════════════════════
#  S3 BUCKETS — one per SPA
# ══════════════════════════════════════════════════════════════

resource "aws_s3_bucket" "spa" {
  for_each = local.spas

  bucket = "${var.project_name}-${each.value.name}"

  tags = merge(local.common_tags, {
    Service = each.value.name
  })
}

resource "aws_s3_bucket_public_access_block" "spa" {
  for_each = local.spas

  bucket = aws_s3_bucket.spa[each.key].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "spa" {
  for_each = local.spas

  bucket = aws_s3_bucket.spa[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontOAC"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.spa[each.key].arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.spa[each.key].arn
          }
        }
      }
    ]
  })
}


# ══════════════════════════════════════════════════════════════
#  CLOUDFRONT — CDN + SPA routing per app
# ══════════════════════════════════════════════════════════════

resource "aws_cloudfront_origin_access_control" "spa" {
  for_each = local.spas

  name                              = "${var.project_name}-${each.value.name}-oac"
  description                       = "OAC for ${each.value.name} S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}


# ══════════════════════════════════════════════════════════════
#  ACM CERTIFICATE — auto-created if custom domains are set
# ══════════════════════════════════════════════════════════════

resource "aws_acm_certificate" "spa" {
  count = var.acm_certificate_arn == "" && local.has_custom_domains ? 1 : 0

  domain_name               = var.domain_customer_kiosk   # primary domain
  subject_alternative_names = compact([
    var.domain_employee_register,
    var.domain_office_dashboard,
  ])
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-spa-cert"
  })
}

resource "aws_cloudfront_distribution" "spa" {
  for_each = local.spas

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.project_name} ${each.value.name}"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.spa[each.key].bucket_regional_domain_name
    origin_id                = "S3-${each.value.name}"
    origin_access_control_id = aws_cloudfront_origin_access_control.spa[each.key].id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${each.value.name}"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 31536000
  }

  # SPA routing — serve index.html for 403/404
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  # Immutable hashed assets — 1-year cache
  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${each.value.name}"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 31536000
    default_ttl = 31536000
    max_ttl     = 31536000
  }

  # Custom domain + SSL (optional)
  aliases = each.value.domain != "" ? [each.value.domain] : []

  viewer_certificate {
    acm_certificate_arn            = each.value.domain != "" && local.acm_arn != "" ? local.acm_arn : null
    ssl_support_method             = each.value.domain != "" && local.acm_arn != "" ? "sni-only" : null
    minimum_protocol_version       = each.value.domain != "" && local.acm_arn != "" ? "TLSv1.2_2021" : null
    cloudfront_default_certificate = each.value.domain == "" || local.acm_arn == "" ? true : null
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = merge(local.common_tags, {
    Service = each.value.name
  })
}


# ══════════════════════════════════════════════════════════════
#  EC2 — API + PostgreSQL server
# ══════════════════════════════════════════════════════════════

# SSH key pair (generate if not provided)
resource "tls_private_key" "deploy" {
  count     = var.key_pair_name == "" ? 1 : 0
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "deploy" {
  count      = var.key_pair_name == "" ? 1 : 0
  key_name   = "${var.project_name}-deploy"
  public_key = tls_private_key.deploy[0].public_key_openssh

  tags = local.common_tags
}

# Security group
resource "aws_security_group" "api" {
  name        = "${var.project_name}-api-sg"
  description = "API server - SSH, HTTP/S, API port"

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "API"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-api-sg"
  })
}

# Amazon Linux 2023 AMI
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023*-x86_64"]
  }
  filter {
    name   = "state"
    values = ["available"]
  }
}

# User data: install Docker + Docker Compose + Node.js
locals {
  user_data = <<-USERDATA
    #!/bin/bash
    set -e
    yum update -y
    yum install -y docker git
    systemctl enable docker
    systemctl start docker
    usermod -aG docker ec2-user

    # Docker Compose v2
    mkdir -p /usr/local/lib/docker/cli-plugins
    curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

    # Create production .env
    cat > /home/ec2-user/.env <<EOF
    DB_PASSWORD=${var.db_password}
    DB_NAME=club_operations
    DB_USER=clubops
    NODE_ENV=production
    CORS_ORIGINS=*
    EOF
    chown ec2-user:ec2-user /home/ec2-user/.env
  USERDATA
}

resource "aws_instance" "api" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  key_name               = var.key_pair_name != "" ? var.key_pair_name : aws_key_pair.deploy[0].key_name
  vpc_security_group_ids = [aws_security_group.api.id]
  user_data              = base64encode(local.user_data)

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
  }

  tags = merge(local.common_tags, {
    Name    = "${var.project_name}-api"
    Service = "api"
  })
}

# Elastic IP for stable address
resource "aws_eip" "api" {
  instance = aws_instance.api.id
  domain   = "vpc"

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-api-eip"
  })
}


# ══════════════════════════════════════════════════════════════
#  IAM — GitHub Actions OIDC federation (no long-lived keys)
# ══════════════════════════════════════════════════════════════

# OIDC provider for GitHub Actions
# Look up existing OIDC provider for GitHub Actions
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

# Deploy role assumed by GitHub Actions
resource "aws_iam_role" "github_actions_deploy" {
  name = "${var.project_name}-${var.environment}-github-actions-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = data.aws_iam_openid_connect_provider.github.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:ref:refs/heads/*"
          }
        }
      }
    ]
  })

  tags = local.common_tags
}

# S3 + CloudFront deploy permissions for all SPAs (production + demo)
resource "aws_iam_role_policy" "deploy_spas" {
  name = "DeploySPAs"
  role = aws_iam_role.github_actions_deploy.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3ListBuckets"
        Effect = "Allow"
        Action = "s3:ListBucket"
        Resource = concat(
          [for k, v in local.spas : aws_s3_bucket.spa[k].arn],
          [
            "arn:aws:s3:::${var.project_name}-demo-employee-register",
            "arn:aws:s3:::${var.project_name}-demo-customer-kiosk",
          ]
        )
      },
      {
        Sid    = "S3WriteObjects"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = concat(
          [for k, v in local.spas : "${aws_s3_bucket.spa[k].arn}/*"],
          [
            "arn:aws:s3:::${var.project_name}-demo-employee-register/*",
            "arn:aws:s3:::${var.project_name}-demo-customer-kiosk/*",
          ]
        )
      },
      {
        Sid    = "CloudFrontInvalidate"
        Effect = "Allow"
        Action = "cloudfront:CreateInvalidation"
        Resource = "*"
      }
    ]
  })
}
