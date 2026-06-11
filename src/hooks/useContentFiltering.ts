import { useState, useEffect } from 'react';
import { indexedDBCache } from '../services/indexedDBCache';
import { parentalService } from '../services/parentalService';
import { searchMovieByName, searchSeriesByName, isKidsFriendly } from '../services/tmdb';

const BLOCKED_CATEGORY_PATTERNS = ['adult', 'adulto', '+18', '18+', 'xxx', 'terror', 'horror', 'erotic', 'erótico'];

export type FilterableContentType = 'movie' | 'series';

interface UseContentFilteringOptions<T> {
    /** Content type ('movie' for VOD, 'series' for Series) */
    contentType: FilterableContentType;
    /** Whether the active profile is a Kids profile */
    isKidsProfile: boolean;
    /** Content list; cached ratings are reloaded when it changes */
    items: T[];
    /** Display name of an item (used for caching/hiding/normalization) */
    getItemName: (item: T) => string;
    /** Category ids an item belongs to */
    getItemCategoryIds: (item: T) => string[];
    /** Called when a clicked item passes the Kids/Parental checks */
    onAllowed: (item: T) => void;
}

const normalizeName = (name: string): string =>
    name.toLowerCase().trim().replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ');

/**
 * Kids-profile + Parental Control filtering and click-gating, generic over
 * content type (movies and series share the exact same flow).
 */
export function useContentFiltering<T>({
    contentType,
    isKidsProfile,
    items,
    getItemName,
    getItemCategoryIds,
    onAllowed
}: UseContentFilteringOptions<T>) {
    const [hiddenItems, setHiddenItems] = useState<Set<string>>(new Set());
    const [blockedCategoryIds, setBlockedCategoryIds] = useState<Set<string>>(new Set());
    const [checkingItem, setCheckingItem] = useState<string | null>(null);
    const [blockMessage, setBlockMessage] = useState<string | null>(null);
    const [cachedRatings, setCachedRatings] = useState<Map<string, string | null>>(new Map());

    const getCachedItem = (name: string) => contentType === 'series'
        ? indexedDBCache.getCachedSeries(name)
        : indexedDBCache.getCachedMovie(name);

    const setCachedItem = (name: string, certification: string | null, genres: string[]) => contentType === 'series'
        ? indexedDBCache.setCacheSeries(name, certification, genres)
        : indexedDBCache.setCacheMovie(name, certification, genres);

    const searchTmdb = contentType === 'series' ? searchSeriesByName : searchMovieByName;

    // Load hidden items from IndexedDB on mount (for Kids profile)
    useEffect(() => {
        if (!isKidsProfile) return;

        const loadHiddenItems = async () => {
            const hidden = await indexedDBCache.getHiddenItems(contentType);
            setHiddenItems(new Set(hidden));
        };
        loadHiddenItems();
    }, [isKidsProfile, contentType]);

    // Load cached ratings for parental control filtering
    useEffect(() => {
        const loadCachedRatings = async () => {
            const ratings = contentType === 'series'
                ? await indexedDBCache.getAllCachedSeries()
                : await indexedDBCache.getAllCachedMovies();
            setCachedRatings(ratings);
        };
        loadCachedRatings();
    }, [items, contentType]);

    // Fetch blocked category IDs for Kids profile OR Parental Control
    useEffect(() => {
        const fetchBlockedCategories = async () => {
            try {
                const channel = contentType === 'series' ? 'categories:get-series' : 'categories:get-vod';
                const result = await window.ipcRenderer.invoke(channel);
                if (result.success) {
                    const parentalConfig = parentalService.getConfig();
                    const shouldBlockCategories = isKidsProfile || (parentalConfig.enabled && parentalConfig.blockAdultCategories && !parentalService.isSessionUnlocked());

                    if (shouldBlockCategories) {
                        const blockedIds = new Set<string>();
                        (result.data || []).forEach((cat: { category_id: string; category_name: string }) => {
                            const lowerName = cat.category_name.toLowerCase();
                            if (BLOCKED_CATEGORY_PATTERNS.some(p => lowerName.includes(p))) {
                                blockedIds.add(cat.category_id);
                            }
                        });
                        setBlockedCategoryIds(blockedIds);
                    } else {
                        setBlockedCategoryIds(new Set());
                    }
                }
            } catch (err) {
                console.error('Failed to fetch categories for filter:', err);
            }
        };
        fetchBlockedCategories();
    }, [isKidsProfile, contentType]);

    // Kids/Parental portion of the grid filter (search/category filtering stays in the page)
    const isItemVisible = (item: T): boolean => {
        const normalizedName = normalizeName(getItemName(item));

        // Parental Control filtering (applies to all profiles)
        if (getItemCategoryIds(item).some(catId => blockedCategoryIds.has(catId))) {
            return false;
        }

        // Parental Control: Filter by cached rating
        const parentalConfig = parentalService.getConfig();
        if (parentalConfig.enabled && !parentalService.isSessionUnlocked()) {
            const cachedRating = cachedRatings.get(normalizedName);
            if (cachedRating && parentalService.isContentBlocked(cachedRating)) {
                return false;
            }
        }

        // Kids profile filtering (additional checks)
        if (isKidsProfile) {
            // Block items that have been marked as hidden
            if (hiddenItems.has(normalizedName)) {
                return false;
            }
        }

        return true;
    };

    // Handle content card click - check Kids filter and Parental Control, always cache for future use
    const handleItemClick = async (item: T): Promise<void> => {
        const name = getItemName(item);
        const normalizedName = normalizeName(name);

        // Check if already hidden for Kids profile
        if (isKidsProfile && hiddenItems.has(normalizedName)) {
            return;
        }

        // Get parental control config
        const parentalConfig = parentalService.getConfig();
        const isParentalActive = parentalConfig.enabled && !parentalService.isSessionUnlocked();

        // If no restrictions, just open and cache in background
        if (!isKidsProfile && !isParentalActive) {
            onAllowed(item);

            // Background caching for cross-profile benefit
            (async () => {
                const cached = await getCachedItem(name);
                if (!cached) {
                    const yearMatch = name.match(/\((\d{4})\)/);
                    const year = yearMatch ? yearMatch[1] : undefined;
                    const tmdbResult = await searchTmdb(name, year);
                    if (tmdbResult) {
                        await setCachedItem(
                            name,
                            tmdbResult.certification || null,
                            tmdbResult.genres?.map(g => g.name) || []
                        );
                        // If not kids-friendly, hide it for future Kids sessions
                        if (!isKidsFriendly(tmdbResult.certification)) {
                            await indexedDBCache.hideItem(contentType, name);
                        }
                    }
                }
            })();
            return;
        }

        // Need to check rating - show loading
        setCheckingItem(name);

        try {
            const cached = await getCachedItem(name);
            let certification: string | null = null;

            if (cached) {
                certification = cached.certification;
            } else {
                const yearMatch = name.match(/\((\d{4})\)/);
                const year = yearMatch ? yearMatch[1] : undefined;
                const tmdbResult = await searchTmdb(name, year);

                if (tmdbResult) {
                    certification = tmdbResult.certification || null;
                    await setCachedItem(
                        name,
                        certification,
                        tmdbResult.genres?.map(g => g.name) || []
                    );
                    // Update local cache for immediate filtering
                    setCachedRatings(prev => new Map(prev).set(normalizedName, certification));
                }
            }

            // Check Kids profile restriction
            if (isKidsProfile) {
                if (isKidsFriendly(certification)) {
                    onAllowed(item);
                } else {
                    setBlockMessage(`"${name}" não está disponível para este perfil`);
                    await indexedDBCache.hideItem(contentType, name);
                    setHiddenItems(prev => new Set(prev).add(normalizedName));
                    setTimeout(() => setBlockMessage(null), 3000);
                }
                return;
            }

            // Check Parental Control restriction
            if (isParentalActive && certification) {
                if (parentalService.isContentBlocked(certification)) {
                    setBlockMessage(`"${name}" está bloqueado pelo controle parental (${certification})`);
                    setTimeout(() => setBlockMessage(null), 3000);
                    return;
                }
            }

            // Allow access
            onAllowed(item);
        } catch (error) {
            console.error(`Error checking ${contentType} rating:`, error);
            onAllowed(item);
        } finally {
            setCheckingItem(null);
        }
    };

    return {
        hiddenItems,
        blockedCategoryIds,
        cachedRatings,
        checkingItem,
        blockMessage,
        isItemVisible,
        handleItemClick
    };
}
