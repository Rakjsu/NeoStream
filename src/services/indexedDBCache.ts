/**
 * IndexedDB Cache Service for Kids Filter
 * Persists TMDB certification data even when browser cache is cleared
 * Future-ready for migration to Supabase
 */

const DB_NAME = 'iptv_kids_filter';
const DB_VERSION = 1;
const MOVIES_STORE = 'movies_cache';
const SERIES_STORE = 'series_cache';
const HIDDEN_ITEMS_STORE = 'hidden_items';

interface CacheItem {
    name: string; // normalized name as key
    certification: string | null;
    genres: string[];
    cachedAt: number;
}

interface HiddenItem {
    id: string; // "movie_<name>" or "series_<name>"
    type: 'movie' | 'series';
    name: string;
    hiddenAt: number;
}

let dbInstance: IDBDatabase | null = null;

// Open/create the IndexedDB database
async function openDB(): Promise<IDBDatabase> {
    if (dbInstance) return dbInstance;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            dbInstance = request.result;
            resolve(dbInstance);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            // Movies cache store
            if (!db.objectStoreNames.contains(MOVIES_STORE)) {
                db.createObjectStore(MOVIES_STORE, { keyPath: 'name' });
            }

            // Series cache store
            if (!db.objectStoreNames.contains(SERIES_STORE)) {
                db.createObjectStore(SERIES_STORE, { keyPath: 'name' });
            }

            // Hidden items store (for Kids profile)
            if (!db.objectStoreNames.contains(HIDDEN_ITEMS_STORE)) {
                db.createObjectStore(HIDDEN_ITEMS_STORE, { keyPath: 'id' });
            }
        };
    });
}

// Normalize name for consistent keys
function normalizeName(name: string): string {
    return name.toLowerCase().trim().replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ');
}

export const indexedDBCache = {
    // ==================== MOVIE CACHE ====================

    async getCachedMovie(name: string): Promise<CacheItem | null> {
        try {
            const db = await openDB();
            const key = normalizeName(name);

            return new Promise((resolve) => {
                const tx = db.transaction(MOVIES_STORE, 'readonly');
                const store = tx.objectStore(MOVIES_STORE);
                const request = store.get(key);

                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => resolve(null);
            });
        } catch {
            return null;
        }
    },

    async setCacheMovie(name: string, certification: string | null, genres: string[]): Promise<void> {
        try {
            const db = await openDB();
            const key = normalizeName(name);

            const item: CacheItem = {
                name: key,
                certification,
                genres,
                cachedAt: Date.now()
            };

            return new Promise((resolve) => {
                const tx = db.transaction(MOVIES_STORE, 'readwrite');
                const store = tx.objectStore(MOVIES_STORE);
                store.put(item);
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });
        } catch {
            // Silently fail
        }
    },

    // ==================== SERIES CACHE ====================

    async getCachedSeries(name: string): Promise<CacheItem | null> {
        try {
            const db = await openDB();
            const key = normalizeName(name);

            return new Promise((resolve) => {
                const tx = db.transaction(SERIES_STORE, 'readonly');
                const store = tx.objectStore(SERIES_STORE);
                const request = store.get(key);

                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => resolve(null);
            });
        } catch {
            return null;
        }
    },

    async setCacheSeries(name: string, certification: string | null, genres: string[]): Promise<void> {
        try {
            const db = await openDB();
            const key = normalizeName(name);

            const item: CacheItem = {
                name: key,
                certification,
                genres,
                cachedAt: Date.now()
            };

            return new Promise((resolve) => {
                const tx = db.transaction(SERIES_STORE, 'readwrite');
                const store = tx.objectStore(SERIES_STORE);
                store.put(item);
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });
        } catch {
            // Silently fail
        }
    },

    // ==================== HIDDEN ITEMS ====================

    async hideItem(type: 'movie' | 'series', name: string): Promise<void> {
        try {
            const db = await openDB();
            const key = normalizeName(name);
            const id = `${type}_${key}`;

            const item: HiddenItem = {
                id,
                type,
                name: key,
                hiddenAt: Date.now()
            };

            return new Promise((resolve) => {
                const tx = db.transaction(HIDDEN_ITEMS_STORE, 'readwrite');
                const store = tx.objectStore(HIDDEN_ITEMS_STORE);
                store.put(item);
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });
        } catch {
            // Silently fail
        }
    },

    async isItemHidden(type: 'movie' | 'series', name: string): Promise<boolean> {
        try {
            const db = await openDB();
            const key = normalizeName(name);
            const id = `${type}_${key}`;

            return new Promise((resolve) => {
                const tx = db.transaction(HIDDEN_ITEMS_STORE, 'readonly');
                const store = tx.objectStore(HIDDEN_ITEMS_STORE);
                const request = store.get(id);

                request.onsuccess = () => resolve(!!request.result);
                request.onerror = () => resolve(false);
            });
        } catch {
            return false;
        }
    },

    async getHiddenItems(type: 'movie' | 'series'): Promise<string[]> {
        try {
            const db = await openDB();

            return new Promise((resolve) => {
                const tx = db.transaction(HIDDEN_ITEMS_STORE, 'readonly');
                const store = tx.objectStore(HIDDEN_ITEMS_STORE);
                const request = store.getAll();

                request.onsuccess = () => {
                    const items = request.result as HiddenItem[];
                    const filtered = items
                        .filter(item => item.type === type)
                        .map(item => item.name);
                    resolve(filtered);
                };
                request.onerror = () => resolve([]);
            });
        } catch {
            return [];
        }
    },

    // ==================== UTILITIES ====================

    async clearAll(): Promise<void> {
        try {
            const db = await openDB();

            await Promise.all([
                new Promise<void>((resolve) => {
                    const tx = db.transaction(MOVIES_STORE, 'readwrite');
                    tx.objectStore(MOVIES_STORE).clear();
                    tx.oncomplete = () => resolve();
                }),
                new Promise<void>((resolve) => {
                    const tx = db.transaction(SERIES_STORE, 'readwrite');
                    tx.objectStore(SERIES_STORE).clear();
                    tx.oncomplete = () => resolve();
                }),
                new Promise<void>((resolve) => {
                    const tx = db.transaction(HIDDEN_ITEMS_STORE, 'readwrite');
                    tx.objectStore(HIDDEN_ITEMS_STORE).clear();
                    tx.oncomplete = () => resolve();
                })
            ]);
        } catch {
            // Silently fail
        }
    },

    // ==================== BULK OPERATIONS FOR PARENTAL CONTROL ====================

    async getAllCachedMovies(): Promise<Map<string, string | null>> {
        try {
            const db = await openDB();

            return new Promise((resolve) => {
                const tx = db.transaction(MOVIES_STORE, 'readonly');
                const store = tx.objectStore(MOVIES_STORE);
                const request = store.getAll();

                request.onsuccess = () => {
                    const items = request.result as CacheItem[];
                    const map = new Map<string, string | null>();
                    items.forEach(item => {
                        map.set(item.name, item.certification);
                    });
                    resolve(map);
                };
                request.onerror = () => resolve(new Map());
            });
        } catch {
            return new Map();
        }
    },

    async getAllCachedSeries(): Promise<Map<string, string | null>> {
        try {
            const db = await openDB();

            return new Promise((resolve) => {
                const tx = db.transaction(SERIES_STORE, 'readonly');
                const store = tx.objectStore(SERIES_STORE);
                const request = store.getAll();

                request.onsuccess = () => {
                    const items = request.result as CacheItem[];
                    const map = new Map<string, string | null>();
                    items.forEach(item => {
                        map.set(item.name, item.certification);
                    });
                    resolve(map);
                };
                request.onerror = () => resolve(new Map());
            });
        } catch {
            return new Map();
        }
    }
};
