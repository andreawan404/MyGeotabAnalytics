// Small key-value cache with TTL, backed by IndexedDB (per root CLAUDE.md: cache
// scoped per database, not per user — callers achieve that via buildCacheKey).

const DB_NAME = 'fleet-analytics-cache';
const STORE_NAME = 'cache';
const DB_VERSION = 1;

interface CacheRecord<T> {
  value: T;
  expiresAt: number;
}

// ponytail: indexedDB doesn't exist under plain Node/tsx (used to run the .check.ts
// script outside a browser). Tiny in-memory Map covers that case so the check is
// honest and runnable; the real IndexedDB path below is what ships to the add-in.
const hasIndexedDB = typeof indexedDB !== 'undefined';
const memoryFallback = new Map<string, CacheRecord<any>>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCached<T>(key: string): Promise<T | null> {
  if (!hasIndexedDB) {
    const rec = memoryFallback.get(key);
    if (!rec || Date.now() >= rec.expiresAt) return null;
    return rec.value as T;
  }

  const db = await openDb();
  return new Promise<T | null>((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
    req.onsuccess = () => {
      const rec: CacheRecord<T> | undefined = req.result;
      resolve(!rec || Date.now() >= rec.expiresAt ? null : rec.value);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function setCached<T>(key: string, value: T, ttlMs: number): Promise<void> {
  const rec: CacheRecord<T> = { value, expiresAt: Date.now() + ttlMs };

  if (!hasIndexedDB) {
    memoryFallback.set(key, rec);
    return;
  }

  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(rec, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function buildCacheKey(database: string, ...parts: Array<string | number>): string {
  return [database, ...parts].join(':');
}
