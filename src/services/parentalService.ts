/**
 * Parental Control Service
 * Manages PIN access and content restrictions
 */

export interface ParentalConfig {
    enabled: boolean;
    pin: string | null;
    maxRating: 'L' | '10' | '12' | '14' | '16' | '18';
    blockAdultCategories: boolean;
    filterByTMDB: boolean;
}

const DEFAULT_CONFIG: ParentalConfig = {
    enabled: false,
    pin: null,
    maxRating: '18',
    blockAdultCategories: true,
    filterByTMDB: true
};

const STORAGE_KEY = 'parentalConfig';
const UNLOCK_KEY = 'parentalUnlocked';

class ParentalService {
    private config: ParentalConfig = DEFAULT_CONFIG;

    constructor() {
        this.loadConfig();
    }

    private loadConfig(): void {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                this.config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
            }
        } catch (error) {
            console.error('Error loading parental config:', error);
        }
    }

    private saveConfig(): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
        } catch (error) {
            console.error('Error saving parental config:', error);
        }
    }

    getConfig(): ParentalConfig {
        return { ...this.config };
    }

    setConfig(updates: Partial<ParentalConfig>): void {
        this.config = { ...this.config, ...updates };
        this.saveConfig();
    }

    // PIN Management
    setPin(newPin: string): void {
        this.config.pin = newPin;
        this.saveConfig();
    }

    verifyPin(inputPin: string): boolean {
        return this.config.pin === inputPin;
    }

    hasPin(): boolean {
        return this.config.pin !== null && this.config.pin !== '';
    }

    // Session unlock (temporary, clears on page reload)
    unlockSession(): void {
        sessionStorage.setItem(UNLOCK_KEY, 'true');
    }

    isSessionUnlocked(): boolean {
        return sessionStorage.getItem(UNLOCK_KEY) === 'true';
    }

    lockSession(): void {
        sessionStorage.removeItem(UNLOCK_KEY);
    }

    // Content filtering
    isContentBlocked(contentRating?: string): boolean {
        if (!this.config.enabled) return false;
        if (this.isSessionUnlocked()) return false;

        // Check category-based blocking
        if (this.config.blockAdultCategories && contentRating === 'adult') {
            return true;
        }

        // Check rating-based blocking
        if (contentRating) {
            const ratingOrder = ['L', '10', '12', '14', '16', '18'];
            const contentIndex = ratingOrder.indexOf(contentRating);
            const maxIndex = ratingOrder.indexOf(this.config.maxRating);

            if (contentIndex > maxIndex && contentIndex !== -1) {
                return true;
            }
        }

        return false;
    }

    // Check if content should be hidden entirely
    shouldHideContent(categoryName?: string): boolean {
        if (!this.config.enabled) return false;
        if (this.isSessionUnlocked()) return false;

        if (this.config.blockAdultCategories && categoryName) {
            const adultKeywords = ['adult', 'xxx', 'adulto', '18+', 'porn', 'erotic'];
            const lowerName = categoryName.toLowerCase();
            return adultKeywords.some(keyword => lowerName.includes(keyword));
        }

        return false;
    }
}

export const parentalService = new ParentalService();
