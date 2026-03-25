import { meter } from './index';

export const httpRequestsTotal = meter.createCounter('http_requests_total', {
  description: 'Total number of HTTP requests',
});

export const httpRequestDuration = meter.createHistogram('http_request_duration_ms', {
  description: 'HTTP request duration in milliseconds',
  unit: 'ms',
});

export const dbQueryDuration = meter.createHistogram('db_query_duration_ms', {
  description: 'Database query duration in milliseconds',
  unit: 'ms',
});

export const activeConnections = meter.createUpDownCounter('active_connections', {
  description: 'Number of active connections',
});

export const backgroundJobsTotal = meter.createCounter('background_jobs_total', {
  description: 'Total number of background jobs executed',
});

export const backgroundJobDuration = meter.createHistogram('background_job_duration_ms', {
  description: 'Background job duration in milliseconds',
  unit: 'ms',
});

export const waitlistEntries = meter.createUpDownCounter('waitlist_entries', {
  description: 'Number of waitlist entries',
});

export const activeCheckins = meter.createUpDownCounter('active_checkins', {
  description: 'Number of active check-ins',
});

export const laneSessionStatus = meter.createUpDownCounter('lane_session_status', {
  description: 'Lane session status changes',
});

export function recordHttpRequest(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number
): void {
  httpRequestsTotal.add(1, {
    method,
    path,
    status_code: String(statusCode),
  });
  httpRequestDuration.record(durationMs, {
    method,
    path,
    status_code: String(statusCode),
  });
}

export function recordDbQuery(durationMs: number, operation: string): void {
  dbQueryDuration.record(durationMs, { operation });
}

export function recordBackgroundJob(
  jobName: string,
  success: boolean,
  durationMs: number
): void {
  backgroundJobsTotal.add(1, {
    job_name: jobName,
    success: String(success),
  });
  backgroundJobDuration.record(durationMs, {
    job_name: jobName,
    success: String(success),
  });
}
