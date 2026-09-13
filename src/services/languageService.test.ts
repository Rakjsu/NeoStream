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

/**
 * O dicionário tinha 81 textos repetidos em 231 entradas — "Cancelar" em ONZE
 * seções, "Fechar" em sete. Sem um lugar genérico onde cair, cada tela nova
 * precisa da sua própria cópia, e o dia em que alguém troca a palavra deixa
 * dez telas para trás.
 */
describe('t() cai na seção common', () => {
    it('a chave da própria seção continua ganhando', () => {
        languageService.setLanguage('pt');
        // `guide.loading` vale "Carregando guia..."; `common.loading` vale
        // "Carregando...". Se a ordem invertesse, o guia perderia a palavra
        // específica dele.
        expect(languageService.t('guide', 'loading')).toBe('Carregando guia...');
        expect(languageService.t('common', 'loading')).toBe('Carregando...');
    });

    it('chave que só existe em common resolve a partir de qualquer seção', () => {
        languageService.setLanguage('pt');
        // Nenhuma dessas seções tem `close` — antes, isto devolvia a string
        // "close" e era ISSO que aparecia na tela.
        expect(languageService.t('agenda', 'close')).toBe('Fechar');
        expect(languageService.t('secaoQueNaoExiste', 'close')).toBe('Fechar');
    });

    // en/es sao carregados sob demanda: sem esperar o import, o t() cai no
    // portugues pelo degrau do "idioma ainda carregando" e o teste mediria
    // outra coisa.
    it('a seção genérica respeita o idioma escolhido', async () => {
        const esperaCarregar = async () => {
            for (let i = 0; i < 50 && languageService.t('common', 'close') === 'Fechar'; i++) {
                await new Promise(resolve => setTimeout(resolve, 5));
            }
        };

        languageService.setLanguage('en');
        await esperaCarregar();
        expect(languageService.t('agenda', 'close')).toBe('Close');

        languageService.setLanguage('es');
        for (let i = 0; i < 50 && languageService.t('common', 'close') !== 'Cerrar'; i++) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        expect(languageService.t('agenda', 'close')).toBe('Cerrar');

        languageService.setLanguage('pt');
    });

    it('sem chave em lugar nenhum, ainda devolve a própria chave', () => {
        expect(languageService.t('agenda', 'naoExisteEmLugarNenhum')).toBe('naoExisteEmLugarNenhum');
    });
});
