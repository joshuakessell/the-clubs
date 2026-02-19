export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export const CLUBOPS_STORAGE_KEYS = {
  staffSession: 'clubops.staffSession',
  deviceId: 'clubops.deviceId',
  deviceInstanceId: 'clubops.deviceInstanceId',
} as const;

export const CLUBOPS_STORAGE_LEGACY_KEYS = {
  staffSession: ['staff_session'] as const,
  deviceId: ['deviceId', 'device_id'] as const,
  deviceInstanceId: ['deviceInstanceId', 'device_instance_id'] as const,
} as const;

function safeGet(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: StorageLike, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // best-effort
  }
}

function safeRemove(storage: StorageLike, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // best-effort
  }
}

export function readStorageValueWithMigration(
  storage: StorageLike,
  canonicalKey: string,
  legacyKeys: readonly string[]
): string | null {
  const canonicalValue = safeGet(storage, canonicalKey);
  if (canonicalValue) {
    legacyKeys.forEach((k) => {
      if (k !== canonicalKey) safeRemove(storage, k);
    });
    return canonicalValue;
  }

  for (const legacyKey of legacyKeys) {
    const legacyValue = safeGet(storage, legacyKey);
    if (!legacyValue) continue;
    safeSet(storage, canonicalKey, legacyValue);
    legacyKeys.forEach((k) => {
      if (k !== canonicalKey) safeRemove(storage, k);
    });
    return legacyValue;
  }

  return null;
}

export function writeStorageValue(
  storage: StorageLike,
  canonicalKey: string,
  value: string,
  legacyKeys: readonly string[] = []
): void {
  safeSet(storage, canonicalKey, value);
  legacyKeys.forEach((k) => {
    if (k !== canonicalKey) safeRemove(storage, k);
  });
}

export function clearStorageValue(
  storage: StorageLike,
  canonicalKey: string,
  legacyKeys: readonly string[] = []
): void {
  safeRemove(storage, canonicalKey);
  legacyKeys.forEach((k) => {
    if (k !== canonicalKey) safeRemove(storage, k);
  });
}

