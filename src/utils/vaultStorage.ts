/**
 * Unified storage adapter for 0arc.
 * Uses IndexedDB on web/PWA/desktop WebView to bypass the ~5 MB localStorage limit,
 * with transparent migration from legacy localStorage keys and graceful fallback
 * if IndexedDB is blocked by the environment.
 */

const DB_NAME = '0arc_vault_db';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

export const VAULT_STORAGE_KEYS = [
  '0arc_vault_tools',
  '0arc_vault_notes',
  '0arc_vault_media',
  '0arc_vault_settings',
  '0arc_vault_passwords',
  '0arc_vault_passwords_lock',
  '0arc_vault_passwords_dk',
] as const;

export type StorageBackendKind = 'indexeddb' | 'localStorage';

export interface StorageEstimateInfo {
  backend: StorageBackendKind;
  usedBytesByVault: number;
  browserUsageBytes: number | null;
  browserQuotaBytes: number | null;
  keyBytes: Record<string, number>;
}

const memoryFallback = new Map<string, string>();
let dbPromise: Promise<IDBDatabase | null> | null = null;
let detectedBackend: StorageBackendKind = 'indexeddb';

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    detectedBackend = 'localStorage';
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => {
        detectedBackend = 'indexeddb';
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        detectedBackend = 'localStorage';
        resolve(null);
      };

      request.onblocked = () => {
        detectedBackend = 'localStorage';
        resolve(null);
      };
    } catch {
      detectedBackend = 'localStorage';
      resolve(null);
    }
  });

  return dbPromise;
}

function readLocalFallback(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

function writeLocalFallback(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    memoryFallback.set(key, value);
  }
}

function removeLocalFallback(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
  memoryFallback.delete(key);
}

export async function getVaultItem(key: string): Promise<string | null> {
  const db = await openDatabase();
  if (!db) {
    return readLocalFallback(key);
  }

  return new Promise<string | null>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);

      req.onsuccess = () => {
        const result = typeof req.result === 'string' ? req.result : null;
        if (result !== null) {
          resolve(result);
          return;
        }
        // Fallback check in case localStorage still holds an unmigrated value
        resolve(readLocalFallback(key));
      };

      req.onerror = () => {
        resolve(readLocalFallback(key));
      };
    } catch {
      resolve(readLocalFallback(key));
    }
  });
}

export async function setVaultItem(key: string, value: string): Promise<void> {
  const db = await openDatabase();
  if (!db) {
    writeLocalFallback(key, value);
    return;
  }

  return new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(value, key);

      tx.oncomplete = () => {
        // Once persisted to IndexedDB, clear any legacy localStorage copy so we aren't capped at 5 MB
        removeLocalFallback(key);
        resolve();
      };
      tx.onerror = () => {
        writeLocalFallback(key, value);
        reject(tx.error || new Error('IndexedDB write failed'));
      };
    } catch (err) {
      writeLocalFallback(key, value);
      reject(err);
    }
  });
}

export async function removeVaultItem(key: string): Promise<void> {
  removeLocalFallback(key);
  const db = await openDatabase();
  if (!db) return;

  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Migrates any existing localStorage keys into IndexedDB once and returns loaded map.
 */
export async function hydrateAndMigrateVaultKeys(
  keys: readonly string[] = VAULT_STORAGE_KEYS
): Promise<Record<string, string | null>> {
  const db = await openDatabase();
  const output: Record<string, string | null> = {};

  for (const key of keys) {
    if (!db) {
      output[key] = readLocalFallback(key);
      continue;
    }

    const idbVal = await new Promise<string | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });

    if (idbVal !== null) {
      output[key] = idbVal;
      removeLocalFallback(key);
      continue;
    }

    const legacyVal = readLocalFallback(key);
    if (legacyVal !== null) {
      await setVaultItem(key, legacyVal).catch(() => {});
      output[key] = legacyVal;
    } else {
      output[key] = null;
    }
  }

  return output;
}

export async function getStorageEstimate(
  keys: readonly string[] = VAULT_STORAGE_KEYS
): Promise<StorageEstimateInfo> {
  await openDatabase();
  const encoder = new TextEncoder();
  const keyBytes: Record<string, number> = {};
  let usedBytesByVault = 0;

  for (const key of keys) {
    const val = await getVaultItem(key);
    const bytes = val ? encoder.encode(val).length : 0;
    keyBytes[key] = bytes;
    usedBytesByVault += bytes;
  }

  let browserUsageBytes: number | null = null;
  let browserQuotaBytes: number | null = null;

  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      browserUsageBytes = typeof est.usage === 'number' ? est.usage : null;
      browserQuotaBytes = typeof est.quota === 'number' ? est.quota : null;
    } catch {
      // ignore unsupported estimate()
    }
  }

  return {
    backend: detectedBackend,
    usedBytesByVault,
    browserUsageBytes,
    browserQuotaBytes,
    keyBytes,
  };
}
