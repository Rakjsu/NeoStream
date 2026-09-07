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

/** Codigo BCP 47 pro atributo lang do <html> (o leitor de tela le daqui). */
const LANG_HTML: Record<SupportedLanguage, string> = { pt: 'pt-BR', en: 'en', es: 'es' };

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
        this.aplicarLangNoDocumento();
        this.espelharIdiomaNoMain();
    }

    /**
     * O `lang` do <html> e quem diz ao leitor de tela em que idioma pronunciar.
     * Ele estava cravado em "en" no index.html, entao a interface em portugues
     * era lida com fonemas ingleses — ilegivel na pratica.
     */
    private aplicarLangNoDocumento(): void {
        if (typeof document === 'undefined') return;
        document.documentElement.lang = LANG_HTML[this.currentLanguage];
    }

    /**
     * Espelha o idioma no processo main, pra pagina do controle web (e o
     * /setup) sairem no mesmo idioma do app.
     *
     * Isto existia — mas dentro do `src/i18n.ts`, uma pilha do i18next que
     * NENHUM arquivo importava. O canal `app:language` estava na whitelist do
     * preload e o main escutava (webRemoteServer), so que ninguem mandava:
     * quem usa o app em ingles ou espanhol via a pagina do celular em
     * portugues, pra sempre.
     *
     * Mesmo padrao do `app:accent` do themeService.
     */
    private espelharIdiomaNoMain(): void {
        try {
            window.ipcRenderer?.send('app:language', this.currentLanguage);
        } catch { /* jsdom/testes sem preload */ }
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

        this.aplicarLangNoDocumento();
        this.espelharIdiomaNoMain();

        // Notify all listeners
        this.listeners.forEach(listener => listener());
    }

    /**
     * Texto de uma chave, com três degraus de reserva.
     *
     * O terceiro degrau — a seção `common` — é novo, e existe porque o
     * dicionário tinha 81 textos repetidos em 231 entradas: "Cancelar"
     * aparecia em ONZE seções, "Fechar" em sete. Sem um lugar genérico onde
     * cair, cada tela nova precisa da sua própria cópia de "Fechar", e o dia
     * em que alguém troca a palavra deixa dez telas para trás.
     *
     * A ordem importa: **seção antes de idioma**. Quem lê em inglês prefere um
     * "Close" genérico a um "Fechar" específico — o idioma certo com a palavra
     * genérica engana menos que a palavra exata na língua errada.
     *
     * E é INERTE para o que já existe: os três degraus só são consultados
     * depois que `sectionData[key]` erra, então nenhuma chave que hoje resolve
     * muda de valor. Conferido nos 1017 pares literais `t('secao','chave')` do
     * renderer.
     */
    t(section: string, key: string): string {
        const langData = translations[this.currentLanguage];
        const translation = langData?.[section]?.[key];
        if (translation) return translation;

        // 1º degrau: a palavra genérica, no idioma que a pessoa escolheu.
        const generic = langData?.common?.[key];
        if (generic) return generic;

        // Enquanto o idioma ainda carrega, cai no português em silêncio.
        if (!langData) {
            return translations.pt?.[section]?.[key] ?? translations.pt?.common?.[key] ?? key;
        }

        // 2º degrau: a seção certa, em português.
        const fallback = translations.pt?.[section]?.[key];
        if (fallback) return fallback;

        // 3º degrau: a palavra genérica em português.
        const genericPt = translations.pt?.common?.[key];
        if (genericPt) return genericPt;

        // Sem nada: devolve a própria chave — e é isso que aparece na tela.
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
