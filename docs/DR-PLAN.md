# Disaster Recovery Plan
## the-clubs

**Document Version**: 1.0
**Last Updated**: 2026-03-21
**Owner**: Engineering Team

---

## Executive Summary

This document outlines the disaster recovery plan for the-clubs application, including recovery objectives, backup strategies, and detailed recovery procedures.

---

## Recovery Objectives

| Metric | Target | Description |
|--------|--------|-------------|
| **RTO** | 4 hours | Maximum acceptable downtime |
| **RPO** | 1 hour | Maximum acceptable data loss |
| **Backup Frequency** | Hourly | Database and application state |
| **Backup Retention** | 30 days | Short-term recovery |
| **Long-term Retention** | 7 years | Compliance requirement |

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     CloudFront CDN                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Load Balancer (ALB)                      │
└─────────────────────────────────────────────────────────────┘
                    │                │                │
                    ▼                ▼                ▼
           ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
           │   API Pod 1  │ │   API Pod 2  │ │   API Pod 3  │
           └──────────────┘ └──────────────┘ └──────────────┘
                    │                │                │
                    └────────────────┼────────────────┘
                                       │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
         ┌──────────────────┐               ┌──────────────────┐
         │  RDS PostgreSQL  │               │      S3         │
         │  (Primary + 2   │               │  (Documents,     │
         │   Read Replicas) │               │   Backups)      │
         └──────────────────┘               └──────────────────┘
```

---

## Backup Strategy

### Database Backups

#### Automated Backups
- **Type**: RDS Automated Backups
- **Retention**: 30 days
- **Point-in-Time Recovery**: Enabled
- **Backup Window**: Daily 02:00-03:00 UTC

#### Manual Snapshots
- **Frequency**: Weekly (Sunday 03:00 UTC)
- **Retention**: 90 days
- **Trigger**: Before major deployments

#### Cross-Region Replication
- **Destination**: Secondary region (us-west-2)
- **Replication Lag**: < 1 hour
- **Purpose**: Regional failure recovery

### Application Backups

#### Docker Images
- **Registry**: Amazon ECR
- **Retention**: Last 30 images per tag
- **Scanning**: Enabled on push

#### Configuration
- **Storage**: S3 with versioning
- **Encryption**: AES-256
- **Access**: IAM role-based

#### Environment Variables
- **Storage**: AWS Secrets Manager
- **Rotation**: Manual with 90-day review
- **Audit**: CloudTrail enabled

---

## Recovery Procedures

### Database Recovery

#### 1. Point-in-Time Recovery (PITR)

```bash
# 1. Identify the recovery point
aws rds describe-db-instances \
  --db-instance-identifier the-clubs-db \
  --query 'DBInstances[0].LatestRestorableTime'

# 2. Create a new instance from PITR
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier the-clubs-db \
  --target-db-instance-identifier the-clubs-db-recovered \
  --restore-time "2026-03-21T10:00:00Z"

# 3. Wait for instance to be available
aws rds wait db-instance-available \
  --db-instance-identifier the-clubs-db-recovered

# 4. Update application connection string
aws ssm put-parameter \
  --name /the-clubs/database/url \
  --value "postgresql://user:pass@the-clubs-db-recovered:5432/club_operations" \
  --type SecureString

# 5. Verify data integrity
psql $DATABASE_URL -c "SELECT COUNT(*) FROM customers;"
```

#### 2. Full Snapshot Recovery

```bash
# 1. List available snapshots
aws rds describe-db-snapshots \
  --db-instance-identifier the-clubs-db \
  --query 'DBSnapshots[*].[DBSnapshotIdentifier,SnapshotCreateTime]'

# 2. Create instance from snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier the-clubs-db-recovered \
  --db-snapshot-identifier my-snapshot-identifier

# 3. Wait and configure
aws rds wait db-instance-available --db-instance-identifier the-clubs-db-recovered
```

### Application Recovery

#### Kubernetes Deployment

```bash
# 1. Verify cluster health
kubectl get nodes
kubectl get pods -n the-clubs

# 2. Rollback to previous deployment
kubectl rollout undo deployment/the-clubs-api -n the-clubs

# 3. Or deploy specific version
kubectl set image deployment/the-clubs-api \
  the-clubs-api=123456789.dkr.ecr.us-east-1.amazonaws.com/the-clubs-api:v1.2.3

# 4. Verify deployment
kubectl rollout status deployment/the-clubs-api -n the-clubs
```

### Full System Recovery

#### 1. Infrastructure Provisioning

```bash
# Using Terraform
cd infrastructure/
terraform plan -out=recovery.plan
terraform apply recovery.plan

# Verify resources
terraform show
```

#### 2. Database Restore

```bash
# Restore from cross-region replica
aws rds create-db-instance-read-replica \
  --db-instance-identifier the-clubs-db-replica \
  --source-db-instance-identifier the-clubs-db \
  --source-region us-east-1 \
  --region us-west-2
```

#### 3. Application Deployment

```bash
# Deploy using CI/CD
git tag recovery-$(date +%Y%m%d)
git push origin recovery-$(date +%Y%m%d)

# Monitor deployment
kubectl get pods -n the-clubs -w
```

#### 4. DNS Cutover

```bash
# Update Route 53
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch file://dns-cutover.json

# Verify propagation
dig api.the-clubs.com +short
```

---

## Incident Response

### Severity Levels

| Severity | Definition | Response Time | Examples |
|----------|------------|---------------|----------|
| **SEV1** | Complete outage | 15 minutes | Database down, all services unavailable |
| **SEV2** | Major feature broken | 30 minutes | Payment processing failing |
| **SEV3** | Minor feature broken | 4 hours | Non-critical feature degraded |
| **SEV4** | Cosmetic issue | 24 hours | UI glitch, no functional impact |

### Incident Response Process

```
┌─────────────┐
│  Detected   │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Assess    │──► SEV1/SEV2 → Page on-call immediately
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Communicate│──► Update status page
└──────┬──────┘     Notify stakeholders
       │
       ▼
┌─────────────┐
│   Mitigate  │──► Apply fix or rollback
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Resolve   │──► Confirm service restored
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Post-mortem│──► Document, blameless review
└─────────────┘
```

---

## Testing Schedule

| Test | Frequency | Team | Last Test |
|------|-----------|------|----------|
| Backup restoration | Monthly | DBA | 2026-03-01 |
| Full DR drill | Quarterly | Engineering | 2026-01-15 |
| Failover test | Monthly | DevOps | 2026-02-20 |
| Restore time measurement | Quarterly | Engineering | 2026-01-15 |

---

## Contact Information

| Role | Name | Phone | Email |
|------|------|-------|-------|
| Primary On-Call | On-call rotation | +1-XXX-XXX-XXXX | oncall@the-clubs.com |
| Engineering Manager | TBD | +1-XXX-XXX-XXXX | engineering@the-clubs.com |
| DBA | TBD | +1-XXX-XXX-XXXX | dba@the-clubs.com |

---

## Appendix

### A. Runbooks

See [RUNBOOKS.md](./RUNBOOKS.md) for detailed operational procedures.

### B. Architecture Diagrams

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system architecture details.

### C. Emergency Contacts

- AWS Support: 1-866-726-3392
- Datadog Support: support@datadoghq.com
- PagerDuty: Emergency escalation
