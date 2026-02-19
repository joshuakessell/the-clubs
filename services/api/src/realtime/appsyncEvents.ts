import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@aws-sdk/protocol-http';
import { SignatureV4 } from '@aws-sdk/signature-v4';

const CHANNEL_SEGMENT_REGEX = /^[A-Za-z0-9-]+$/;

export function isAppSyncEventsEnabled(): boolean {
  return Boolean(process.env.APPSYNC_EVENTS_HTTP_ENDPOINT);
}

export function getAppSyncChannelNamespace(): string {
  return process.env.APPSYNC_EVENTS_CHANNEL_NAMESPACE?.trim() || 'club-ops';
}

export function buildChannelPath(...segments: string[]): string {
  const normalized = segments
    .map((segment) => segment.trim())
    .filter(Boolean);
  return `/${normalized.join('/')}`;
}

export function isValidChannel(channel: string): boolean {
  if (!channel) return false;
  const trimmed = channel.startsWith('/') ? channel.slice(1) : channel;
  const segments = trimmed.split('/').filter(Boolean);
  if (segments.length === 0 || segments.length > 5) return false;
  return segments.every((segment) => CHANNEL_SEGMENT_REGEX.test(segment));
}

function normalizeHttpEndpoint(raw: string): URL {
  const url = new URL(raw);
  if (!url.pathname || url.pathname === '/') url.pathname = '/event';
  return url;
}

function getRegionFromHost(host: string): string | undefined {
  const match = host.match(/appsync-api\\.([a-z0-9-]+)\\.amazonaws\\.com$/);
  return match?.[1];
}

function getAppSyncRegion(httpEndpoint: URL): string {
  const fromEnv = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (fromEnv) return fromEnv;
  const inferred = getRegionFromHost(httpEndpoint.host);
  return inferred || 'us-east-1';
}

export function getAppSyncHttpEndpoint(): URL {
  const raw = process.env.APPSYNC_EVENTS_HTTP_ENDPOINT?.trim();
  if (!raw) {
    throw new Error('APPSYNC_EVENTS_HTTP_ENDPOINT is not configured');
  }
  return normalizeHttpEndpoint(raw);
}

export function getAppSyncRealtimeEndpoint(): string {
  const httpEndpoint = getAppSyncHttpEndpoint();
  const host = httpEndpoint.host.replace('appsync-api.', 'appsync-realtime-api.');
  return `wss://${host}/event/realtime`;
}

export async function signAppSyncEventRequest(
  body: string
): Promise<Record<string, string>> {
  const httpEndpoint = getAppSyncHttpEndpoint();
  const region = getAppSyncRegion(httpEndpoint);

  const signer = new SignatureV4({
    credentials: defaultProvider(),
    service: 'appsync',
    region,
    sha256: Sha256,
  });

  const request = new HttpRequest({
    protocol: httpEndpoint.protocol,
    method: 'POST',
    hostname: httpEndpoint.host,
    path: httpEndpoint.pathname,
    headers: {
      accept: 'application/json, text/javascript',
      'content-encoding': 'amz-1.0',
      'content-type': 'application/json; charset=UTF-8',
      host: httpEndpoint.host,
    },
    body,
  });

  const signed = await signer.sign(request);
  const headers = signed.headers as Record<string, string>;

  const requiredHeaders = [
    'accept',
    'content-encoding',
    'content-type',
    'host',
    'x-amz-content-sha256',
    'x-amz-date',
    'authorization',
  ] as const;

  const filtered: Record<string, string> = {};
  for (const key of requiredHeaders) {
    const value = headers[key];
    if (!value) {
      throw new Error(`Missing required signed header: ${key}`);
    }
    filtered[key] = value;
  }

  if (headers['x-amz-security-token']) {
    filtered['x-amz-security-token'] = headers['x-amz-security-token'];
  }

  return filtered;
}

export async function publishAppSyncEvent(
  channel: string,
  eventPayload: unknown
): Promise<void> {
  if (!isAppSyncEventsEnabled()) return;
  if (!isValidChannel(channel)) {
    throw new Error(`Invalid AppSync Events channel: ${channel}`);
  }

  const body = JSON.stringify({
    channel,
    events: [JSON.stringify(eventPayload ?? {})],
  });
  const headers = await signAppSyncEventRequest(body);
  const httpEndpoint = getAppSyncHttpEndpoint().toString();

  const response = await fetch(httpEndpoint, {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`AppSync Events publish failed (${response.status}): ${text}`);
  }
}
