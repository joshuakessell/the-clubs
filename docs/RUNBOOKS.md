# Operational Runbooks
## the-clubs

**Document Version**: 1.0
**Last Updated**: 2026-03-21

---

## Table of Contents

1. [Common Procedures](#common-procedures)
2. [Alert Responses](#alert-responses)
3. [Maintenance Tasks](#maintenance-tasks)
4. [Emergency Procedures](#emergency-procedures)

---

## Common Procedures

### 1. Deployment

#### Standard Deployment

```bash
# 1. Ensure you have the correct AWS credentials
aws sts get-caller-identity

# 2. Build and push Docker image
cd services/api
docker build -t the-clubs-api:latest .
docker tag the-clubs-api:latest 123456789.dkr.ecr.us-east-1.amazonaws.com/the-clubs-api:latest
docker push 123456789.dkr.ecr.us-east-1.amazonaws.com/the-clubs-api:latest

# 3. Update Kubernetes deployment
kubectl set image deployment/the-clubs-api the-clubs-api=123456789.dkr.ecr.us-east-1.amazonaws.com/the-clubs-api:latest

# 4. Monitor rollout
kubectl rollout status deployment/the-clubs-api -n the-clubs

# 5. Verify
kubectl get pods -n the-clubs
curl -s https://api.the-clubs.com/health | jq .
```

#### Rollback Deployment

```bash
# Rollback to previous version
kubectl rollout undo deployment/the-clubs-api -n the-clubs

# Or rollback to specific revision
kubectl rollout undo deployment/the-clubs-api -n the-clubs --to-revision=3

# Verify rollback
kubectl rollout status deployment/the-clubs-api -n the-clubs
```

### 2. Database Operations

#### Connect to Database

```bash
# Get connection string from Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id /the-clubs/database/url \
  --query SecretString \
  --output text

# Connect using psql (port-forward if needed)
kubectl port-forward svc/the-clubs-db 5432:5432 -n the-clubs &
psql "postgresql://user:password@localhost:5432/club_operations"
```

#### Check Active Connections

```sql
SELECT 
  pid,
  usename,
  application_name,
  client_addr,
  state,
  query_start,
  state_change,
  (now() - query_start) AS duration
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY duration DESC;
```

#### Long-Running Queries

```sql
-- Find queries running longer than 5 minutes
SELECT 
  pid,
  usename,
  now() - query_start AS running_time,
  state,
  query
FROM pg_stat_activity
WHERE (now() - query_start) > interval '5 minutes'
  AND state = 'active'
ORDER BY running_time DESC;

-- Cancel a long-running query (replace pid)
SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE pid = 12345;
```

### 3. Log Analysis

#### Application Logs

```bash
# View recent logs
kubectl logs -n the-clubs -l app=the-clubs-api --tail=100

# Follow logs in real-time
kubectl logs -n the-clubs -l app=the-clubs-api -f

# Search for errors
kubectl logs -n the-clubs -l app=the-clubs-api | grep -i error

# Export logs for analysis
kubectl logs -n the-clubs -l app=the-clubs-api --since=1h > app-logs.txt
```

---

## Alert Responses

### 1. High CPU Alert

**Alert**: `HighCPUUtilization > 80% for 5 minutes`

**Symptoms**:
- Application response times degraded
- Increased error rates

**Investigation**:
```bash
# 1. Check which pods are affected
kubectl top pods -n the-clubs

# 2. Identify the cause
kubectl logs -n the-clubs -l app=the-clubs-api --since=30m | grep -E "(ERROR|timeout|slow)"

# 3. Check database connections
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"

# 4. Look for long-running queries
psql $DATABASE_URL -c "SELECT * FROM pg_stat_activity WHERE state = 'active' LIMIT 10;"
```

**Resolution**:
1. If DB-related: Kill long-running queries or scale database
2. If application-related: Check for infinite loops, memory leaks
3. Scale horizontally if needed: `kubectl scale deployment/the-clubs-api --replicas=5`

### 2. Payment Service Down

**Alert**: `PaymentServiceUnavailable > 2 minutes`

**Symptoms**:
- Check-in flow fails at payment step
- Customers cannot complete transactions

**Investigation**:
```bash
# 1. Check Square API status
curl -s https://status.squareup.com/api/v2/status.json

# 2. Verify circuit breaker status (check application logs)
kubectl logs -n the-clubs -l app=the-clubs-api | grep -i "circuit"

# 3. Check Square credentials
aws secretsmanager get-secret-value --secret-id /the-clubs/square/api-key
```

**Resolution**:
1. If Square is down: Enable manual payment mode in configuration
2. If credentials issue: Rotate and update in Secrets Manager
3. If circuit breaker open: Wait for reset or manually reset via API

### 3. Database Connection Pool Exhausted

**Alert**: `DBConnectionPoolExhausted > 1 minute`

**Symptoms**:
- New connections fail
- Application returns 500 errors
- Health check fails

**Investigation**:
```bash
# 1. Check current connection count
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"

# 2. Find connections by state
psql $DATABASE_URL -c "SELECT state, count(*) FROM pg_stat_activity GROUP BY state;"

# 3. Check for idle in transaction
psql $DATABASE_URL -c "SELECT pid, usename, now() - query_start AS duration FROM pg_stat_activity WHERE state = 'idle in transaction';"
```

**Resolution**:
1. If many idle connections: Reduce application connection pool size
2. If long-running queries: Cancel or optimize them
3. Scale database: Increase `max_connections` parameter

### 4. Memory Alert

**Alert**: `HighMemoryUsage > 85% for 10 minutes`

**Investigation**:
```bash
# 1. Check pod memory usage
kubectl top pods -n the-clubs

# 2. Check node memory
kubectl describe nodes | grep -A 5 "Allocated resources"

# 3. Look for memory leaks in logs
kubectl logs -n the-clubs -l app=the-clubs-api --since=1h | grep -i "memory"
```

**Resolution**:
1. Restart affected pods: `kubectl delete pod <pod-name> -n the-clubs`
2. Scale down temporarily
3. Investigate memory leak in application

---

## Maintenance Tasks

### 1. Database Maintenance

#### VACUUM and ANALYZE

```bash
# Run manually (usually automated, but useful after bulk deletes)
psql $DATABASE_URL -c "VACUUM (VERBOSE, ANALYZE);"

# Check table bloat
psql $DATABASE_URL -c "SELECT tablename, pg_size_pretty(pg_total_relation_size(tablename::regclass)) AS size FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(tablename::regclass) DESC LIMIT 10;"
```

#### Index Maintenance

```sql
-- Find unused indexes
SELECT indexrelname, idx_scan, idx_tup_read, idx_tup_fetch 
FROM pg_stat_user_indexes 
WHERE idx_scan = 0 
ORDER BY pg_relation_size(indexrelid) DESC;

-- Check index size
SELECT indexname, pg_size_pretty(pg_relation_size(indexrelid)) 
FROM pg_stat_user_indexes 
ORDER BY pg_relation_size(indexrelid) DESC LIMIT 10;
```

### 2. Log Rotation

```bash
# Configure log retention in PostgreSQL
psql $DATABASE_URL -c "ALTER SYSTEM SET log_rotation_age = '1d';"
psql $DATABASE_URL -c "ALTER SYSTEM SET log_rotation_size = '100MB';"
psql $DATABASE_URL -c "ALTER SYSTEM SET log_min_duration_statement = '1000';"
```

### 3. Backup Verification

```bash
# 1. List recent backups
aws rds describe-db-snapshots \
  --db-instance-identifier the-clubs-db \
  --query 'DBSnapshots[*].[DBSnapshotIdentifier,SnapshotCreateTime,Status]' \
  --output table

# 2. Verify latest backup
aws rds describe-db-snapshots \
  --db-instance-identifier the-clubs-db \
  --query 'DBSnapshots[-1:]'

# 3. Test restore to isolated environment
# (See DR-PLAN.md for detailed procedure)
```

### 4. Secret Rotation

```bash
# Rotate a secret
aws secretsmanager rotate-secret \
  --secret-id /the-clubs/database/password

# Verify rotation completed
aws secretsmanager describe-secret \
  --secret-id /the-clubs/database/password \
  --query 'RotationEnabled,RotationLambdaARN,LastRotatedDate'
```

---

## Emergency Procedures

### 1. Service Outage

```bash
# 1. Assess scope - is it one pod or all?
kubectl get pods -n the-clubs
kubectl get events -n the-clubs --sort-by='.lastTimestamp'

# 2. Check recent deployments
kubectl rollout history deployment/the-clubs-api -n the-clubs

# 3. If deployment-related, rollback
kubectl rollout undo deployment/the-clubs-api -n the-clubs

# 4. If not deployment-related, restart all pods
kubectl delete pods -n the-clubs -l app=the-clubs-api

# 5. Scale if needed
kubectl scale deployment/the-clubs-api --replicas=5 -n the-clubs
```

### 2. Data Corruption

```bash
# 1. STOP all application writes immediately
kubectl scale deployment/the-clubs-api --replicas=0 -n the-clubs

# 2. Identify affected tables
psql $DATABASE_URL -c "SELECT * FROM pg_stat_activity WHERE state != 'idle';"

# 3. Restore from backup (see DR-PLAN.md)

# 4. Verify data integrity after restore
psql $DATABASE_URL -c "SELECT COUNT(*) FROM customers;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM orders;"

# 5. Resume application
kubectl scale deployment/the-clubs-api --replicas=3 -n the-clubs
```

### 3. Security Incident

```bash
# 1. Isolate affected systems
kubectl scale deployment/the-clubs-api --replicas=0 -n the-clubs

# 2. Preserve logs
kubectl logs -n the-clubs -l app=the-clubs-api --since=24h > security-logs-$(date +%Y%m%d).txt

# 3. Rotate all credentials
aws secretsmanager rotate-secret --secret-id /the-clubs/database/password
aws secretsmanager rotate-secret --secret-id /the-clubs/api-keys

# 4. Review access logs
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=ConsoleLogin \
  --start-time "2026-03-20T00:00:00Z"

# 5. Restore service with new credentials
kubectl scale deployment/the-clubs-api --replicas=3 -n the-clubs
```

### 4. Network Issues

```bash
# 1. Check DNS resolution
nslookup api.the-clubs.com
dig api.the-clubs.com

# 2. Test connectivity
kubectl exec -it <pod-name> -n the-clubs -- sh
curl -v https://api.the-clubs.com/health

# 3. Check ingress status
kubectl get ingress -n the-clubs
kubectl describe ingress -n the-clubs

# 4. Check AWS ALB
aws elbv2 describe-load-balancers --names the-clubs-alb
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Restart all pods | `kubectl delete pods -n the-clubs -l app=the-clubs-api` |
| Rollback deployment | `kubectl rollout undo deployment/the-clubs-api -n the-clubs` |
| Scale up | `kubectl scale deployment/the-clubs-api --replicas=5 -n the-clubs` |
| View logs | `kubectl logs -n the-clubs -l app=the-clubs-api --tail=100 -f` |
| Check pod status | `kubectl get pods -n the-clubs` |
| Port forward DB | `kubectl port-forward svc/the-clubs-db 5432:5432 -n the-clubs` |
