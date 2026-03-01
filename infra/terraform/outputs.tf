# ─────────────────────────────────────────────────────────────
# Outputs — values needed for GitHub Actions and DNS
# ─────────────────────────────────────────────────────────────

# ── SPA outputs (one per app) ────────────────────────────────

output "spa_bucket_names" {
  description = "S3 bucket names — set as GitHub repo variables"
  value = {
    for k, v in local.spas : k => aws_s3_bucket.spa[k].bucket
  }
}

output "spa_distribution_ids" {
  description = "CloudFront distribution IDs — set as GitHub repo variables"
  value = {
    for k, v in local.spas : k => aws_cloudfront_distribution.spa[k].id
  }
}

output "spa_distribution_domains" {
  description = "CloudFront domain names (for DNS CNAME/alias if needed)"
  value = {
    for k, v in local.spas : k => aws_cloudfront_distribution.spa[k].domain_name
  }
}

# ── EC2 outputs ──────────────────────────────────────────────

output "api_public_ip" {
  description = "Elastic IP of the API server"
  value       = aws_eip.api.public_ip
}

output "api_instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.api.id
}

output "ssh_command" {
  description = "SSH command to access the API server"
  value       = "ssh -i ${var.project_name}-deploy.pem ec2-user@${aws_eip.api.public_ip}"
}

# ── IAM outputs ──────────────────────────────────────────────

output "github_actions_role_arn" {
  description = "IAM role ARN — set as GitHub repo secret AWS_ROLE_ARN"
  value       = aws_iam_role.github_actions_deploy.arn
}

# ── SSH key (if auto-generated) ──────────────────────────────

output "ssh_private_key" {
  description = "SSH private key PEM (only if key_pair_name was empty)"
  value       = var.key_pair_name == "" ? tls_private_key.deploy[0].private_key_pem : "(using existing key pair)"
  sensitive   = true
}

# ── DNS records you need to create ───────────────────────────

output "acm_dns_validation_records" {
  description = "DNS records to add for ACM certificate validation"
  value = var.acm_certificate_arn == "" && local.has_custom_domains ? {
    for dvo in aws_acm_certificate.spa[0].domain_validation_options : dvo.domain_name => {
      type  = dvo.resource_record_type
      name  = dvo.resource_record_name
      value = dvo.resource_record_value
    }
  } : {}
}

output "dns_cname_records" {
  description = "CNAME records to point custom domains to CloudFront"
  value = {
    for k, v in local.spas : v.domain => aws_cloudfront_distribution.spa[k].domain_name
    if v.domain != ""
  }
}
