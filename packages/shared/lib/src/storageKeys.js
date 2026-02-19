export const CLUBOPS_STORAGE_KEYS = {
    staffSession: 'clubops.staffSession',
    deviceId: 'clubops.deviceId',
    deviceInstanceId: 'clubops.deviceInstanceId',
};
export const CLUBOPS_STORAGE_LEGACY_KEYS = {
    staffSession: ['staff_session'],
    deviceId: ['deviceId', 'device_id'],
    deviceInstanceId: ['deviceInstanceId', 'device_instance_id'],
};
function safeGet(storage, key) {
    try {
        return storage.getItem(key);
    }
    catch {
        return null;
    }
}
function safeSet(storage, key, value) {
    try {
        storage.setItem(key, value);
    }
    catch {
        // best-effort
    }
}
function safeRemove(storage, key) {
    try {
        storage.removeItem(key);
    }
    catch {
        // best-effort
    }
}
export function readStorageValueWithMigration(storage, canonicalKey, legacyKeys) {
    const canonicalValue = safeGet(storage, canonicalKey);
    if (canonicalValue) {
        legacyKeys.forEach((k) => {
            if (k !== canonicalKey)
                safeRemove(storage, k);
        });
        return canonicalValue;
    }
    for (const legacyKey of legacyKeys) {
        const legacyValue = safeGet(storage, legacyKey);
        if (!legacyValue)
            continue;
        safeSet(storage, canonicalKey, legacyValue);
        legacyKeys.forEach((k) => {
            if (k !== canonicalKey)
                safeRemove(storage, k);
        });
        return legacyValue;
    }
    return null;
}
export function writeStorageValue(storage, canonicalKey, value, legacyKeys = []) {
    safeSet(storage, canonicalKey, value);
    legacyKeys.forEach((k) => {
        if (k !== canonicalKey)
            safeRemove(storage, k);
    });
}
export function clearStorageValue(storage, canonicalKey, legacyKeys = []) {
    safeRemove(storage, canonicalKey);
    legacyKeys.forEach((k) => {
        if (k !== canonicalKey)
            safeRemove(storage, k);
    });
}
//# sourceMappingURL=storageKeys.js.map