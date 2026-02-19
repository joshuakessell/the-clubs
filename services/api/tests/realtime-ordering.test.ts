import { describe, it, expect, vi } from 'vitest';

import { createBroadcaster } from '../src/realtime/broadcaster.js';

describe('Realtime ordering', () => {
  it('drops stale SESSION_UPDATED events by flowVersion per lane', () => {
    const publishSpy = vi.fn();

    process.env.APPSYNC_EVENTS_HTTP_ENDPOINT = 'https://example.com';
    process.env.APPSYNC_EVENTS_CHANNEL_NAMESPACE = 'club-ops';
    process.env.APPSYNC_EVENTS_API_KEY = 'test';
    process.env.LAN_FALLBACK = 'false';

    const broadcaster = createBroadcaster();

    // Monkey patch publishAppSyncEvent via global fetch side effects isn't stable here;
    // instead validate ordering behavior by wrapping broadcastToLane and counting local publish attempts.
    // We do this by calling broadcastToLane with a fake appSyncEnabled path disabled, and checking that
    // the monotonic guard returns early by observing side effects on a local hook.
    //
    // createBroadcaster doesn't expose internals, so we validate via publishToLaneLocal by enabling LAN fallback
    // and providing a localLaneSockets stub.
    const localLaneSockets = {
      publishToLane: publishSpy,
    } as any;

    process.env.LAN_FALLBACK = 'true';
    const broadcasterWithLocal = createBroadcaster({ localLaneSockets });

    const lane = 'lane-1';

    broadcasterWithLocal.broadcastSessionUpdated({ flowVersion: 2 } as any, lane);
    broadcasterWithLocal.broadcastSessionUpdated({ flowVersion: 1 } as any, lane);
    broadcasterWithLocal.broadcastSessionUpdated({ flowVersion: 3 } as any, lane);

    expect(publishSpy).toHaveBeenCalledTimes(2);
    const first = publishSpy.mock.calls[0]![1];
    const second = publishSpy.mock.calls[1]![1];
    expect(first.type).toBe('SESSION_UPDATED');
    expect(first.payload.flowVersion).toBe(2);
    expect(second.payload.flowVersion).toBe(3);
  });
});

