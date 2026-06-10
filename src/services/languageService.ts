// Language Service - Simple i18n system
// To add a new language, simply create a new JSON file in /src/locales/ui/ and add it here

import { useState, useEffect } from 'react';
// Portuguese is the default language and is always bundled.
// en/es are lazy-loaded via dynamic import only when selected (see loadTranslations).
import ptTranslations from '../locales/ui/pt.json';

const STORAGE_KEY = 'neostream_language';

export type SupportedLanguage = 'pt' | 'en' | 'es';

export interface LanguageOption {
    code: SupportedLanguage;
    name: string;
    flag: string;
}

export const AVAILABLE_LANGUAGES: LanguageOption[] = [
    { code: 'pt', name: 'Português', flag: '🇧🇷' },
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'es', name: 'Español', flag: '🇪🇸' }
];

type TranslationDictionary = Record<string, Record<string, string>>;

// Translation dictionaries (pt is always available; en/es are filled in after lazy load)
const translations: Partial<Record<SupportedLanguage, TranslationDictionary>> = {
    pt: ptTranslations
};

// Lazy loaders — static literal paths so Vite can code-split each language into its own chunk
const translationLoaders: Record<Exclude<SupportedLanguage, 'pt'>, () => Promise<{ default: TranslationDictionary }>> = {
    en: () => import('../locales/ui/en.json'),
    es: () => import('../locales/ui/es.json')
};

class LanguageService {
    private currentLanguage: SupportedLanguage;
    private listeners: Set<() => void> = new Set();
    private loadingLanguages: Set<SupportedLanguage> = new Set();

    constructor() {
        this.currentLanguage = this.loadLanguage();
        // If the persisted language isn't bundled yet, start loading it immediately
        this.ensureTranslationsLoaded(this.currentLanguage);
    }

    private loadLanguage(): SupportedLanguage {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved && ['pt', 'en', 'es'].includes(saved)) {
                return saved as SupportedLanguage;
            }
        } catch (e) {
            console.warn('Failed to load language preference:', e);
        }
        // Default to Portuguese
        return 'pt';
    }

    private ensureTranslationsLoaded(lang: SupportedLanguage): void {
        if (lang === 'pt' || translations[lang] || this.loadingLanguages.has(lang)) return;

        this.loadingLanguages.add(lang);
        translationLoaders[lang]()
            .then(module => {
                translations[lang] = module.default;
                // Re-render subscribers now that the dictionary is available
                if (this.currentLanguage === lang) {
                    this.listeners.forEach(listener => listener());
                }
            })
            .catch(e => {
                console.warn(`Failed to load translations for "${lang}":`, e);
            })
            .finally(() => {
                this.loadingLanguages.delete(lang);
            });
    }

    getLanguage(): SupportedLanguage {
        return this.currentLanguage;
    }

    setLanguage(lang: SupportedLanguage): void {
        if (this.currentLanguage === lang) return;

        this.currentLanguage = lang;
        try {
            localStorage.setItem(STORAGE_KEY, lang);
        } catch (e) {
            console.warn('Failed to save language preference:', e);
        }

        // Lazy-load the dictionary if needed (notifies listeners again when ready)
        this.ensureTranslationsLoaded(lang);

        // Notify all listeners
        this.listeners.forEach(listener => listener());
    }

    // Main translation function
    t(section: string, key: string): string {
        const langData = translations[this.currentLanguage];
        const sectionData = langData?.[section];
        const translation = sectionData?.[key];

        if (translation) return translation;

        // While a language is still loading, fall back silently to Portuguese
        if (!langData) {
            return translations.pt?.[section]?.[key] ?? key;
        }

        // Fallback to Portuguese
        const fallback = translations.pt?.[section]?.[key];
        if (fallback) return fallback;

        // Return key if not found
        console.warn(`Missing translation: ${section}.${key}`);
        return key;
    }

    // Subscribe to language changes
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    // Get available languages
    getAvailableLanguages(): LanguageOption[] {
        return AVAILABLE_LANGUAGES;
    }

    // Get current language info
    getCurrentLanguageInfo(): LanguageOption {
        return AVAILABLE_LANGUAGES.find(l => l.code === this.currentLanguage) || AVAILABLE_LANGUAGES[0];
    }
}

export const languageService = new LanguageService();

// React hook for using translations
export function useLanguage() {
    const [, forceUpdate] = useState({});

    useEffect(() => {
        const unsubscribe = languageService.subscribe(() => forceUpdate({}));
        return unsubscribe;
    }, []);

    return {
        language: languageService.getLanguage(),
        setLanguage: (lang: SupportedLanguage) => languageService.setLanguage(lang),
        t: (section: string, key: string) => languageService.t(section, key),
        languages: languageService.getAvailableLanguages(),
        currentLanguageInfo: languageService.getCurrentLanguageInfo()
    };
}
