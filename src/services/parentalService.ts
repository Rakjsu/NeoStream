/**
 * Parental Control Service
 * Manages PIN access and content restrictions
 */

export interface ParentalConfig {
    enabled: boolean;
    /** @deprecated legacy plaintext PIN — migrated to pinHash/pinSalt on load */
    pin?: string | null;
    pinHash: string | null;
    pinSalt: string | null;
    maxRating: 'L' | '10' | '12' | '14' | '16' | '18';
    blockAdultCategories: boolean;
    filterByTMDB: boolean;
}

const DEFAULT_CONFIG: ParentalConfig = {
    enabled: false,
    pinHash: null,
    pinSalt: null,
    maxRating: '18',
    blockAdultCategories: true,
    filterByTMDB: true
};

const STORAGE_KEY = 'parentalConfig';
const UNLOCK_KEY = 'parentalUnlocked';

function randomSaltHex(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin: string, saltHex: string): Promise<string> {
    const data = new TextEncoder().encode(`${saltHex}:${pin}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

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
        // Migrate legacy plaintext PIN to hashed storage.
        const legacyPin = this.config.pin;
        if (legacyPin) {
            delete this.config.pin;
            // Fire-and-forget: by the time the user opens parental settings
            // the migration has completed.
            void this.setPin(legacyPin);
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

    // PIN Management — PIN is stored as SHA-256(salt:pin), never plaintext.
    async setPin(newPin: string): Promise<void> {
        const salt = randomSaltHex();
        this.config.pinSalt = salt;
        this.config.pinHash = await hashPin(newPin, salt);
        this.saveConfig();
    }

    async verifyPin(inputPin: string): Promise<boolean> {
        if (!this.config.pinHash || !this.config.pinSalt) return false;
        return (await hashPin(inputPin, this.config.pinSalt)) === this.config.pinHash;
    }

    hasPin(): boolean {
        return Boolean(this.config.pinHash);
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
