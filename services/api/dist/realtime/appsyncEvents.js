"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAppSyncEventsEnabled = isAppSyncEventsEnabled;
exports.getAppSyncChannelNamespace = getAppSyncChannelNamespace;
exports.buildChannelPath = buildChannelPath;
exports.isValidChannel = isValidChannel;
exports.getAppSyncHttpEndpoint = getAppSyncHttpEndpoint;
exports.getAppSyncRealtimeEndpoint = getAppSyncRealtimeEndpoint;
exports.signAppSyncEventRequest = signAppSyncEventRequest;
exports.publishAppSyncEvent = publishAppSyncEvent;
const sha256_js_1 = require("@aws-crypto/sha256-js");
const credential_provider_node_1 = require("@aws-sdk/credential-provider-node");
const protocol_http_1 = require("@aws-sdk/protocol-http");
const signature_v4_1 = require("@aws-sdk/signature-v4");
const CHANNEL_SEGMENT_REGEX = /^[A-Za-z0-9-]+$/;
function isAppSyncEventsEnabled() {
    return Boolean(process.env.APPSYNC_EVENTS_HTTP_ENDPOINT);
}
function getAppSyncChannelNamespace() {
    return process.env.APPSYNC_EVENTS_CHANNEL_NAMESPACE?.trim() || 'club-ops';
}
function buildChannelPath(...segments) {
    const normalized = segments
        .map((segment) => segment.trim())
        .filter(Boolean);
    return `/${normalized.join('/')}`;
}
function isValidChannel(channel) {
    if (!channel)
        return false;
    const trimmed = channel.startsWith('/') ? channel.slice(1) : channel;
    const segments = trimmed.split('/').filter(Boolean);
    if (segments.length === 0 || segments.length > 5)
        return false;
    return segments.every((segment) => CHANNEL_SEGMENT_REGEX.test(segment));
}
function normalizeHttpEndpoint(raw) {
    const url = new URL(raw);
    if (!url.pathname || url.pathname === '/')
        url.pathname = '/event';
    return url;
}
function getRegionFromHost(host) {
    const match = host.match(/appsync-api\\.([a-z0-9-]+)\\.amazonaws\\.com$/);
    return match?.[1];
}
function getAppSyncRegion(httpEndpoint) {
    const fromEnv = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
    if (fromEnv)
        return fromEnv;
    const inferred = getRegionFromHost(httpEndpoint.host);
    return inferred || 'us-east-1';
}
function getAppSyncHttpEndpoint() {
    const raw = process.env.APPSYNC_EVENTS_HTTP_ENDPOINT?.trim();
    if (!raw) {
        throw new Error('APPSYNC_EVENTS_HTTP_ENDPOINT is not configured');
    }
    return normalizeHttpEndpoint(raw);
}
function getAppSyncRealtimeEndpoint() {
    const httpEndpoint = getAppSyncHttpEndpoint();
    const host = httpEndpoint.host.replace('appsync-api.', 'appsync-realtime-api.');
    return `wss://${host}/event/realtime`;
}
async function signAppSyncEventRequest(body) {
    const httpEndpoint = getAppSyncHttpEndpoint();
    const region = getAppSyncRegion(httpEndpoint);
    const signer = new signature_v4_1.SignatureV4({
        credentials: (0, credential_provider_node_1.defaultProvider)(),
        service: 'appsync',
        region,
        sha256: sha256_js_1.Sha256,
    });
    const request = new protocol_http_1.HttpRequest({
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
    const headers = signed.headers;
    const requiredHeaders = [
        'accept',
        'content-encoding',
        'content-type',
        'host',
        'x-amz-content-sha256',
        'x-amz-date',
        'authorization',
    ];
    const filtered = {};
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
async function publishAppSyncEvent(channel, eventPayload) {
    if (!isAppSyncEventsEnabled())
        return;
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
