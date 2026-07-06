import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import pt from './locales/pt.json';
import es from './locales/es.json';

// Mirror the resolved language into the main process so the phone web-remote
// page is served in the same language as the app (no-op outside Electron).
const pushLanguageToMain = () => {
    try {
        window.ipcRenderer?.send('app:language', (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2));
    } catch { /* jsdom/tests sem preload */ }
};

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            en: { translation: en },
            pt: { translation: pt },
            es: { translation: es },
        },
        fallbackLng: 'en',
        interpolation: {
            escapeValue: false,
        },
    })
    .then(pushLanguageToMain);

i18n.on('languageChanged', pushLanguageToMain);

export default i18n;
