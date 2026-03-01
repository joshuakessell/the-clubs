# ─────────────────────────────────────────────────────────────
# Variables for the-clubs AWS infrastructure
# ─────────────────────────────────────────────────────────────

variable "project_name" {
  description = "Project name used for resource naming and tagging"
  type        = string
  default     = "the-clubs"
}

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (e.g. production, staging)"
  type        = string
  default     = "production"
}

# ── EC2 ──────────────────────────────────────────────────────

variable "instance_type" {
  description = "EC2 instance type for the API server"
  type        = string
  default     = "t3.micro"
}

variable "key_pair_name" {
  description = "Name of the SSH key pair for EC2 access. If empty, a new key pair is created."
  type        = string
  default     = ""
}

variable "db_password" {
  description = "PostgreSQL password for the production database"
  type        = string
  sensitive   = true
}

# ── Domain / SSL (optional) ─────────────────────────────────

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for CloudFront HTTPS (must be in us-east-1). Leave empty to use default CloudFront domain."
  type        = string
  default     = ""
}

variable "domain_customer_kiosk" {
  description = "Custom domain for customer kiosk (e.g. kiosk.example.com). Leave empty for default."
  type        = string
  default     = ""
}

variable "domain_employee_register" {
  description = "Custom domain for employee register. Leave empty for default."
  type        = string
  default     = ""
}

variable "domain_office_dashboard" {
  description = "Custom domain for office dashboard. Leave empty for default."
  type        = string
  default     = ""
}

# ── GitHub Actions OIDC ──────────────────────────────────────

variable "github_repo" {
  description = "GitHub repository in owner/repo format (e.g. joshuakessell/the-clubs)"
  type        = string
}
