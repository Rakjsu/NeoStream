import { describe, it, expect, vi } from 'vitest';
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

/**
 * O idioma precisa chegar ao processo main: é ele que serve a página do
 * controle web e o /setup.
 *
 * Isto já existia — dentro de `src/i18n.ts`, uma pilha do i18next que NENHUM
 * arquivo importava. O canal estava na whitelist do preload e o main escutava;
 * só que ninguém mandava. Quem usa o app em inglês ou espanhol via a página do
 * celular em português, para sempre.
 */
describe('espelho do idioma no main', () => {
    it('trocar de idioma avisa o processo main', () => {
        const send = vi.fn();
        (window as unknown as { ipcRenderer: unknown }).ipcRenderer = { send };

        languageService.setLanguage('en');
        expect(send).toHaveBeenCalledWith('app:language', 'en');

        languageService.setLanguage('es');
        expect(send).toHaveBeenCalledWith('app:language', 'es');
    });

    // Fora do Electron (jsdom dos testes, e o próprio app rodando no navegador
    // durante o dev) não há preload: o envio não pode derrubar a troca de idioma.
    it('sem preload, trocar de idioma continua funcionando', () => {
        delete (window as unknown as { ipcRenderer?: unknown }).ipcRenderer;
        expect(() => languageService.setLanguage('pt')).not.toThrow();
        expect(languageService.getLanguage()).toBe('pt');
    });
});
