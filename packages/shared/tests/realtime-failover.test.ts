import { describe, it, expect, vi } from 'vitest';

type Mode = 'cloud' | 'lan';

function createModeController(params: {
  cloudFailToLanThreshold: number;
  cloudSuccessToFailbackThreshold: number;
  lanSuccessThreshold: number;
  onMode: (mode: Mode) => void;
}) {
  let currentMode: Mode = 'cloud';
  let consecutiveCloudFailures = 0;
  let consecutiveCloudSuccesses = 0;
  let consecutiveLanSuccesses = 0;

  const swap = (mode: Mode) => {
    if (mode === currentMode) return;
    currentMode = mode;
    params.onMode(mode);
  };

  const tick = (health: { cloudOk: boolean; appsyncConnected: boolean; lanOk: boolean }) => {
    const cloudHealthy = health.cloudOk && health.appsyncConnected;

    if (cloudHealthy) {
      consecutiveCloudSuccesses += 1;
      consecutiveCloudFailures = 0;
    } else {
      consecutiveCloudFailures += 1;
      consecutiveCloudSuccesses = 0;
    }

    if (health.lanOk) {
      consecutiveLanSuccesses += 1;
    } else {
      consecutiveLanSuccesses = 0;
    }

    if (
      currentMode === 'cloud' &&
      consecutiveCloudFailures >= params.cloudFailToLanThreshold &&
      consecutiveLanSuccesses >= params.lanSuccessThreshold
    ) {
      swap('lan');
      return;
    }

    if (currentMode === 'lan' && consecutiveCloudSuccesses >= params.cloudSuccessToFailbackThreshold) {
      swap('cloud');
    }
  };

  return {
    getMode: () => currentMode,
    tick,
  };
}

describe('realtime failover hysteresis', () => {
  it('switches cloud -> lan after consecutive cloud failures (and lan is healthy)', () => {
    const onMode = vi.fn();
    const controller = createModeController({
      cloudFailToLanThreshold: 3,
      cloudSuccessToFailbackThreshold: 6,
      lanSuccessThreshold: 2,
      onMode,
    });

    controller.tick({ cloudOk: false, appsyncConnected: false, lanOk: true });
    controller.tick({ cloudOk: false, appsyncConnected: false, lanOk: true });
    controller.tick({ cloudOk: false, appsyncConnected: false, lanOk: true });

    expect(controller.getMode()).toBe('lan');
    expect(onMode).toHaveBeenCalledWith('lan');
  });

  it('switches lan -> cloud only after consecutive cloud successes', () => {
    const onMode = vi.fn();
    const controller = createModeController({
      cloudFailToLanThreshold: 3,
      cloudSuccessToFailbackThreshold: 6,
      lanSuccessThreshold: 2,
      onMode,
    });

    // Force lan first.
    controller.tick({ cloudOk: false, appsyncConnected: false, lanOk: true });
    controller.tick({ cloudOk: false, appsyncConnected: false, lanOk: true });
    controller.tick({ cloudOk: false, appsyncConnected: false, lanOk: true });
    expect(controller.getMode()).toBe('lan');

    // Need 6 consecutive cloud successes to fail back.
    for (let i = 0; i < 5; i += 1) {
      controller.tick({ cloudOk: true, appsyncConnected: true, lanOk: true });
    }
    expect(controller.getMode()).toBe('lan');

    controller.tick({ cloudOk: true, appsyncConnected: true, lanOk: true });
    expect(controller.getMode()).toBe('cloud');
    expect(onMode).toHaveBeenCalledWith('cloud');
  });
});

