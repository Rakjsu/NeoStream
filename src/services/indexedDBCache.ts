/**
 * IndexedDB Cache Service for Kids Filter
 * Persists TMDB certification data even when browser cache is cleared
 * Future-ready for migration to Supabase
 */

import { isExpired, KIDS_FILTER_CACHE_TTL_MS } from './cacheExpiry';
import { normalizeContentName } from './contentGate';

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
    /** Nome como o provedor mostra — `name` é a chave normalizada (sem acento). Registros antigos não têm. */
    titulo?: string;
    /**
     * Liberado pelo responsável no Controle Parental (D115). Vale mais que a
     * classificação da TMDB: a busca é por nome e às vezes casa o título
     * errado, e o cache de certificação guardaria o engano por 30 dias.
     */
    liberadoEm?: number;
}

/** Uma linha da lista de títulos escondidos que o Controle Parental mostra. */
export interface EntradaOculta {
    type: 'movie' | 'series';
    /** Chave normalizada — é o que `liberarItem`/`revogarLiberacao` recebem. */
    name: string;
    titulo: string;
    liberado: boolean;
}

/** Leitura em lote das classificações em cache. */
export interface OpcoesDasClassificacoes {
    /**
     * Perfil infantil: tira do mapa a classificação dos títulos que o
     * responsável liberou. Era ela — o engano da TMDB — que o filtro de
     * classificação do parental continuaria usando para esconder o título
     * da grade da criança depois de liberado (D115).
     */
    ignorarLiberados?: boolean;
}

/** Escondido de fato: existe e o responsável não liberou. */
const estaOculto = (item: HiddenItem | undefined): boolean => !!item && !item.liberadoEm;

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

// Chave de nome dos stores. É a MESMA que o portão (contentGate) consulta:
// o que `hideItem` grava aqui é o que `isItemVisibleUnderGate` procura lá.
// Uma cópia local do corpo deixaria o bloqueio infantil rachar no dia em que
// só um dos lados mudasse (D059) — por isso a regra tem um dono só.
const normalizeName = normalizeContentName;

/**
 * Classificações em cache de um tipo, por nome normalizado — a leitura em lote
 * dos portões de grade. Com `ignorarLiberados`, a store de ocultos é lida na
 * MESMA transação e os títulos liberados pelo responsável saem do mapa (D115).
 */
async function lerClassificacoes(
    storeName: string,
    type: 'movie' | 'series',
    opcoes?: OpcoesDasClassificacoes
): Promise<Map<string, string | null>> {
    try {
        const db = await openDB();
        const ignorarLiberados = opcoes?.ignorarLiberados === true;

        return new Promise((resolve) => {
            const tx = db.transaction(ignorarLiberados ? [storeName, HIDDEN_ITEMS_STORE] : storeName, 'readonly');
            const map = new Map<string, string | null>();
            const liberados = new Set<string>();

            const request = tx.objectStore(storeName).getAll();
            request.onsuccess = () => {
                (request.result as CacheItem[]).forEach(item => {
                    if (isExpired(item.cachedAt, KIDS_FILTER_CACHE_TTL_MS)) return;
                    map.set(item.name, item.certification);
                });
            };
            if (ignorarLiberados) {
                const ocultos = tx.objectStore(HIDDEN_ITEMS_STORE).getAll();
                ocultos.onsuccess = () => {
                    (ocultos.result as HiddenItem[]).forEach(item => {
                        if (item.type === type && item.liberadoEm) liberados.add(item.name);
                    });
                };
            }
            tx.oncomplete = () => {
                liberados.forEach(nome => map.delete(nome));
                resolve(map);
            };
            tx.onerror = () => resolve(new Map());
        });
    } catch {
        return new Map();
    }
}

// Read a cache entry, treating expired/legacy records as misses (and
// deleting them opportunistically so the store doesn't grow forever).
async function getFreshCacheItem(storeName: string, name: string): Promise<CacheItem | null> {
    try {
        const db = await openDB();
        const key = normalizeName(name);

        return new Promise((resolve) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.get(key);

            request.onsuccess = () => {
                const item = (request.result as CacheItem | undefined) || null;
                if (item && isExpired(item.cachedAt, KIDS_FILTER_CACHE_TTL_MS)) {
                    store.delete(key);
                    resolve(null);
                    return;
                }
                resolve(item);
            };
            request.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}

export const indexedDBCache = {
    // ==================== MOVIE CACHE ====================

    async getCachedMovie(name: string): Promise<CacheItem | null> {
        return getFreshCacheItem(MOVIES_STORE, name);
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
        return getFreshCacheItem(SERIES_STORE, name);
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
                hiddenAt: Date.now(),
                titulo: name.trim()
            };

            return new Promise((resolve) => {
                const tx = db.transaction(HIDDEN_ITEMS_STORE, 'readwrite');
                const store = tx.objectStore(HIDDEN_ITEMS_STORE);
                const atual = store.get(id);
                atual.onsuccess = () => {
                    // O responsável liberou este título: a classificação
                    // automática (inclusive o caminho de fundo do perfil
                    // adulto) não passa por cima da decisão dele.
                    if ((atual.result as HiddenItem | undefined)?.liberadoEm) return;
                    store.put(item);
                };
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });
        } catch {
            // Silently fail
        }
    },

    /**
     * O responsável conferiu e libera o título para o perfil infantil (D115).
     *
     * Zerar a lista não bastava: a certificação errada continua no cache e o
     * primeiro clique da criança escondia o título de novo. A liberação fica
     * gravada no próprio registro e é consultada pelos portões de clique.
     */
    async liberarItem(type: 'movie' | 'series', name: string): Promise<void> {
        try {
            const db = await openDB();
            const key = normalizeName(name);
            const id = `${type}_${key}`;

            return new Promise((resolve) => {
                const tx = db.transaction(HIDDEN_ITEMS_STORE, 'readwrite');
                const store = tx.objectStore(HIDDEN_ITEMS_STORE);
                const atual = store.get(id);
                atual.onsuccess = () => {
                    const anterior = atual.result as HiddenItem | undefined;
                    const agora = Date.now();
                    const item: HiddenItem = {
                        id,
                        type,
                        name: key,
                        hiddenAt: anterior?.hiddenAt ?? agora,
                        titulo: anterior?.titulo ?? name.trim(),
                        liberadoEm: agora
                    };
                    store.put(item);
                };
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });
        } catch {
            // Silently fail
        }
    },

    /** Desfaz a liberação: o título volta a ficar escondido no perfil infantil. */
    async revogarLiberacao(type: 'movie' | 'series', name: string): Promise<void> {
        try {
            const db = await openDB();
            const key = normalizeName(name);
            const id = `${type}_${key}`;

            return new Promise((resolve) => {
                const tx = db.transaction(HIDDEN_ITEMS_STORE, 'readwrite');
                const store = tx.objectStore(HIDDEN_ITEMS_STORE);
                const atual = store.get(id);
                atual.onsuccess = () => {
                    const anterior = atual.result as HiddenItem | undefined;
                    const item: HiddenItem = {
                        id,
                        type,
                        name: key,
                        hiddenAt: Date.now(),
                        titulo: anterior?.titulo ?? name.trim()
                    };
                    store.put(item);
                };
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });
        } catch {
            // Silently fail
        }
    },

    async isItemLiberado(type: 'movie' | 'series', name: string): Promise<boolean> {
        try {
            const db = await openDB();
            const id = `${type}_${normalizeName(name)}`;

            return new Promise((resolve) => {
                const tx = db.transaction(HIDDEN_ITEMS_STORE, 'readonly');
                const request = tx.objectStore(HIDDEN_ITEMS_STORE).get(id);
                request.onsuccess = () => resolve(!!(request.result as HiddenItem | undefined)?.liberadoEm);
                request.onerror = () => resolve(false);
            });
        } catch {
            return false;
        }
    },

    /** Escondidos e liberados, com o nome legível, para o Controle Parental. */
    async listHiddenEntries(): Promise<EntradaOculta[]> {
        try {
            const db = await openDB();

            return new Promise((resolve) => {
                const tx = db.transaction(HIDDEN_ITEMS_STORE, 'readonly');
                const request = tx.objectStore(HIDDEN_ITEMS_STORE).getAll();
                request.onsuccess = () => {
                    const entradas = (request.result as HiddenItem[]).map((item): EntradaOculta => ({
                        type: item.type,
                        name: item.name,
                        titulo: item.titulo || item.name,
                        liberado: !!item.liberadoEm
                    }));
                    entradas.sort((a, b) => a.titulo.localeCompare(b.titulo));
                    resolve(entradas);
                };
                request.onerror = () => resolve([]);
            });
        } catch {
            return [];
        }
    },

    /**
     * Desfaz um "ocultar".
     *
     * A store só sabia esconder. Um título escondido por engano — e sem chave
     * da TMDB isso acontecia a cada clique, porque "sem resposta" era tratado
     * como "não é infantil" — ficava fora do catálogo para sempre, em TODOS os
     * perfis (a store é global), e pôr a chave depois não desfazia nada.
     */
    async unhideItem(type: 'movie' | 'series', name: string): Promise<void> {
        try {
            const db = await openDB();
            const id = `${type}_${normalizeName(name)}`;

            return new Promise((resolve) => {
                const tx = db.transaction(HIDDEN_ITEMS_STORE, 'readwrite');
                tx.objectStore(HIDDEN_ITEMS_STORE).delete(id);
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });
        } catch {
            // Silently fail
        }
    },

    /**
     * Limpa a lista de ocultos (o "Mostrar todos" do controle parental).
     * Preserva o que o responsável liberou título a título: zerar os
     * automáticos não pode desfazer uma decisão dele.
     */
    async clearHiddenItems(): Promise<void> {
        try {
            const db = await openDB();

            return new Promise((resolve) => {
                const tx = db.transaction(HIDDEN_ITEMS_STORE, 'readwrite');
                const request = tx.objectStore(HIDDEN_ITEMS_STORE).openCursor();
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor) return;
                    if (estaOculto(cursor.value as HiddenItem)) cursor.delete();
                    cursor.continue();
                };
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

                request.onsuccess = () => resolve(estaOculto(request.result as HiddenItem | undefined));
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
                        .filter(item => item.type === type && estaOculto(item))
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

    /**
     * Delete expired certification entries from both stores. Called once at
     * app startup; without it the cache grew unbounded across sessions.
     */
    async cleanupExpired(): Promise<number> {
        let removed = 0;
        try {
            const db = await openDB();

            const sweep = (storeName: string) => new Promise<void>((resolve) => {
                const tx = db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                const request = store.openCursor();

                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor) return;
                    const item = cursor.value as CacheItem;
                    if (isExpired(item.cachedAt, KIDS_FILTER_CACHE_TTL_MS)) {
                        cursor.delete();
                        removed += 1;
                    }
                    cursor.continue();
                };
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });

            await Promise.all([sweep(MOVIES_STORE), sweep(SERIES_STORE)]);
        } catch {
            // Silently fail — cleanup is best-effort.
        }
        return removed;
    },

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

    async getAllCachedMovies(opcoes?: OpcoesDasClassificacoes): Promise<Map<string, string | null>> {
        return lerClassificacoes(MOVIES_STORE, 'movie', opcoes);
    },

    async getAllCachedSeries(opcoes?: OpcoesDasClassificacoes): Promise<Map<string, string | null>> {
        return lerClassificacoes(SERIES_STORE, 'series', opcoes);
    }
};
