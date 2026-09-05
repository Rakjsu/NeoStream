import { describe, it, expect } from 'vitest';
import { languageService } from './languageService';

// O `lang` do <html> é quem diz ao leitor de tela em que idioma pronunciar o
// que está na tela. Ele estava cravado em "en" no index.html: a interface em
// português saía com fonemas ingleses, o que na prática é ilegível. Não há
// nada na tela que mostre o erro — só ouvindo.
describe('lang do documento', () => {
    it('acompanha o idioma escolhido', () => {
        languageService.setLanguage('en');
        expect(document.documentElement.lang).toBe('en');

        languageService.setLanguage('es');
        expect(document.documentElement.lang).toBe('es');

        // pt-BR, não "pt": o leitor de tela escolhe a voz pelo código completo.
        languageService.setLanguage('pt');
        expect(document.documentElement.lang).toBe('pt-BR');
    });

    it('trocar para o idioma que já está ativo não é erro', () => {
        languageService.setLanguage('pt');
        languageService.setLanguage('pt');
        expect(document.documentElement.lang).toBe('pt-BR');
    });
});
