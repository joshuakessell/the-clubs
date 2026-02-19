export type StorageLike = {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
};
export declare const CLUBOPS_STORAGE_KEYS: {
    readonly staffSession: "clubops.staffSession";
    readonly deviceId: "clubops.deviceId";
    readonly deviceInstanceId: "clubops.deviceInstanceId";
};
export declare const CLUBOPS_STORAGE_LEGACY_KEYS: {
    readonly staffSession: readonly ["staff_session"];
    readonly deviceId: readonly ["deviceId", "device_id"];
    readonly deviceInstanceId: readonly ["deviceInstanceId", "device_instance_id"];
};
export declare function readStorageValueWithMigration(storage: StorageLike, canonicalKey: string, legacyKeys: readonly string[]): string | null;
export declare function writeStorageValue(storage: StorageLike, canonicalKey: string, value: string, legacyKeys?: readonly string[]): void;
export declare function clearStorageValue(storage: StorageLike, canonicalKey: string, legacyKeys?: readonly string[]): void;
//# sourceMappingURL=storageKeys.d.ts.map