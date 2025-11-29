// Watch Later localStorage utility

export interface WatchLaterItem {
    id: string;
    type: 'series' | 'movie';
    name: string;
    cover: string;
    tmdb_id?: string;
    category_id?: string;
}

const WATCH_LATER_KEY = 'neostream_watch_later';

export const watchLaterService = {
    // Get all watch later items
    getAll(): WatchLaterItem[] {
        try {
            const data = localStorage.getItem(WATCH_LATER_KEY);
            return data ? JSON.parse(data) : [];
        } catch (error) {
            console.error('Error reading watch later:', error);
            return [];
        }
    },

    // Add item to watch later
    add(item: WatchLaterItem): boolean {
        try {
            const items = this.getAll();
            // Check if already exists
            if (items.some(i => i.id === item.id && i.type === item.type)) {
                return false; // Already in list
            }
            items.push(item);
            localStorage.setItem(WATCH_LATER_KEY, JSON.stringify(items));
            return true;
        } catch (error) {
            console.error('Error adding to watch later:', error);
            return false;
        }
    },

    // Remove item from watch later
    remove(id: string, type: 'series' | 'movie'): boolean {
        try {
            const items = this.getAll();
            const filtered = items.filter(i => !(i.id === id && i.type === type));
            localStorage.setItem(WATCH_LATER_KEY, JSON.stringify(filtered));
            return true;
        } catch (error) {
            console.error('Error removing from watch later:', error);
            return false;
        }
    },

    // Check if item is in watch later
    has(id: string, type: 'series' | 'movie'): boolean {
        const items = this.getAll();
        return items.some(i => i.id === id && i.type === type);
    },

    // Clear all
    clear(): void {
        localStorage.removeItem(WATCH_LATER_KEY);
    }
};
