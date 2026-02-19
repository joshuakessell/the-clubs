import { describe, it, expect, vi } from 'vitest';
import {
  readStorageValueWithMigration,
  writeStorageValue,
  clearStorageValue,
  type StorageLike,
} from '../src/storageKeys';

function createMockStorage(initial: Record<string, string> = {}): StorageLike {
  const store = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
  };
}

describe('readStorageValueWithMigration', () => {
  it('returns canonical value when present', () => {
    const storage = createMockStorage({ 'clubops.staffSession': 'abc123' });
    expect(readStorageValueWithMigration(storage, 'clubops.staffSession', ['staff_session'])).toBe(
      'abc123'
    );
  });

  it('removes legacy keys when canonical key exists', () => {
    const storage = createMockStorage({
      'clubops.staffSession': 'abc123',
      staff_session: 'old',
    });
    readStorageValueWithMigration(storage, 'clubops.staffSession', ['staff_session']);
    expect(storage.removeItem).toHaveBeenCalledWith('staff_session');
  });

  it('migrates from legacy key to canonical key', () => {
    const storage = createMockStorage({ staff_session: 'legacy_val' });
    const result = readStorageValueWithMigration(storage, 'clubops.staffSession', [
      'staff_session',
    ]);
    expect(result).toBe('legacy_val');
    expect(storage.setItem).toHaveBeenCalledWith('clubops.staffSession', 'legacy_val');
  });

  it('tries legacy keys in order, returns first found', () => {
    const storage = createMockStorage({ device_id: 'second_legacy' });
    const result = readStorageValueWithMigration(storage, 'clubops.deviceId', [
      'deviceId',
      'device_id',
    ]);
    expect(result).toBe('second_legacy');
    expect(storage.setItem).toHaveBeenCalledWith('clubops.deviceId', 'second_legacy');
  });

  it('returns null when no value found', () => {
    const storage = createMockStorage({});
    expect(
      readStorageValueWithMigration(storage, 'clubops.staffSession', ['staff_session'])
    ).toBeNull();
  });

  it('handles storage errors gracefully', () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error('quota exceeded');
      },
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    // safeGet swallows errors and returns null
    expect(readStorageValueWithMigration(storage, 'clubops.staffSession', [])).toBeNull();
  });
});

describe('writeStorageValue', () => {
  it('writes to canonical key', () => {
    const storage = createMockStorage({});
    writeStorageValue(storage, 'clubops.deviceId', 'myDevice');
    expect(storage.setItem).toHaveBeenCalledWith('clubops.deviceId', 'myDevice');
  });

  it('removes legacy keys on write', () => {
    const storage = createMockStorage({ deviceId: 'old', device_id: 'old2' });
    writeStorageValue(storage, 'clubops.deviceId', 'newVal', ['deviceId', 'device_id']);
    expect(storage.removeItem).toHaveBeenCalledWith('deviceId');
    expect(storage.removeItem).toHaveBeenCalledWith('device_id');
  });

  it('does not remove canonical key from legacy list', () => {
    const storage = createMockStorage({});
    writeStorageValue(storage, 'clubops.deviceId', 'val', ['clubops.deviceId']);
    // removeItem should NOT be called for the canonical key itself
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});

describe('clearStorageValue', () => {
  it('removes canonical key', () => {
    const storage = createMockStorage({ 'clubops.staffSession': 'val' });
    clearStorageValue(storage, 'clubops.staffSession');
    expect(storage.removeItem).toHaveBeenCalledWith('clubops.staffSession');
  });

  it('removes legacy keys too', () => {
    const storage = createMockStorage({
      'clubops.staffSession': 'val',
      staff_session: 'old',
    });
    clearStorageValue(storage, 'clubops.staffSession', ['staff_session']);
    expect(storage.removeItem).toHaveBeenCalledWith('clubops.staffSession');
    expect(storage.removeItem).toHaveBeenCalledWith('staff_session');
  });

  it('handles storage errors gracefully', () => {
    const storage: StorageLike = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: () => {
        throw new Error('fail');
      },
    };
    // Should not throw
    expect(() => clearStorageValue(storage, 'clubops.staffSession')).not.toThrow();
  });
});
