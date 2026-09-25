import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 🎭 A busca por elenco/diretor ("@nome" na busca global, Ctrl+K) existia e
 * funcionava, mas nada na tela dizia que o atalho era "@": o placeholder fala
 * em "canais, filmes e séries" e o rodapé só listava ↑↓ / Enter / Esc. Quem não
 * leu o código nunca achava o recurso (#D053).
 *
 * O caso monta a busca global DE VERDADE (react-dom/client + act), com o
 * `searchPersonCredits` real do tmdb.ts — só a rede (fetch) e o IPC são
 * dublados. Assim o rodapé e o recurso leem a MESMA chave TMDB, e o teste
 * prova as duas pontas juntas:
 *   1. com a chave, o rodapé anuncia o "@" no idioma do app (pt/en/es) e
 *      digitar "@nome" traz a seção "Com ...";
 *   2. sem a chave (ou com chave só de espaços), o rodapé NÃO anuncia — e o
 *      "@nome" de fato não responde (nenhuma ida à TMDB), então anunciar ali
 *      seria prometer um recurso que devolve "Nenhum resultado";
 *   3. a chave colada (ou apagada) no meio da sessão vale na próxima abertura.
 */

// Dublês só do I/O e do perfil ativo. Nada que decida o texto do rodapé é dublado.
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../services/profileService', () => ({
    profileService: { getActiveProfile: () => null },
}));

import { GlobalSearch, GLOBAL_SEARCH_OPEN_EVENT } from './GlobalSearch';
import { languageService } from '../services/languageService';

const CHAVE_TMDB = 'neostream_tmdb_api_key';
const IGNORAR_ENV = 'neostream_tmdb_ignore_env';

const RODAPE_PT = '↑↓ navegar · Enter abrir · Esc fechar';
const RODAPE_EN = '↑↓ navigate · Enter open · Esc close';
const RODAPE_ES = '↑↓ navegar · Enter abrir · Esc cerrar';

/** Espera uma condição com prazo de relógio (nunca um número fixo de voltas). */
async function esperar(condicao: () => boolean, oQue: string) {
    const prazo = Date.now() + 8000;
    while (Date.now() < prazo) {
        if (condicao()) return;
        await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    }
    throw new Error(`nao aconteceu: ${oQue}`);
}

/** A TMDB de mentira: "Fulana de Tal" atuou em "Filme Um". */
const fetchTmdb = vi.fn(async (url: string) => {
    const corpo = url.includes('/search/person')
        ? { results: [{ id: 7, name: 'Fulana de Tal' }] }
        : url.includes('/person/7/combined_credits')
            ? { cast: [{ title: 'Filme Um' }], crew: [] }
            : {};
    return { ok: true, json: async () => corpo } as unknown as Response;
});

describe('busca por ator/diretor ("@") anunciada no rodape da busca global', { timeout: 20000 }, () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(async () => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        localStorage.clear();
        // Simula o app instalado: sem fallback do VITE_TMDB_API_KEY do .env de dev.
        localStorage.setItem(IGNORAR_ENV, '1');
        fetchTmdb.mockClear();
        vi.stubGlobal('fetch', fetchTmdb);
        // Só a propriedade — o window do jsdom continua o mesmo.
        Object.defineProperty(window, 'ipcRenderer', {
            configurable: true,
            writable: true,
            value: {
                invoke: vi.fn(async (canal: string) => {
                    if (canal === 'streams:get-vod') {
                        return { success: true, data: [{ stream_id: 1, name: 'Filme Um' }, { stream_id: 2, name: 'Outro Filme' }] };
                    }
                    if (canal.startsWith('streams:') || canal.startsWith('categories:')) return { success: true, data: [] };
                    return { success: false };
                }),
                send: vi.fn(),
                on: vi.fn(),
                off: vi.fn(),
            },
        });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => { root.render(<GlobalSearch />); });
    });

    afterEach(async () => {
        await act(async () => { root.unmount(); });
        container.remove();
        languageService.setLanguage('pt');
        vi.unstubAllGlobals();
        localStorage.clear();
    });

    const rodape = () => container.querySelector('.gsearch-footer')?.textContent?.trim() ?? null;

    async function abrir() {
        await act(async () => { window.dispatchEvent(new Event(GLOBAL_SEARCH_OPEN_EVENT)); });
        await esperar(() => rodape() !== null, 'overlay aberto');
        await esperar(() => !container.textContent?.includes('Carregando catálogo'), 'catalogo carregado');
    }

    async function fechar() {
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await esperar(() => rodape() === null, 'overlay fechado');
    }

    async function digitar(texto: string) {
        const input = container.querySelector<HTMLInputElement>('.gsearch-input');
        if (!input) throw new Error('sem campo de busca');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        await act(async () => {
            setter?.call(input, texto);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }

    async function trocarIdioma(idioma: 'en' | 'es', rodapeEsperado: string) {
        languageService.setLanguage(idioma);
        await esperar(() => languageService.t('search', 'hint') === rodapeEsperado, `dicionario ${idioma}`);
    }

    it('com a chave TMDB, o rodape em PORTUGUES ensina o atalho "@nome" e a promessa se cumpre', async () => {
        localStorage.setItem(CHAVE_TMDB, 'chave-de-teste');
        await abrir();

        expect(rodape()).toBe(`${RODAPE_PT} · @nome busca por ator ou diretor`);

        await digitar('@Fulana');
        await esperar(() => !!container.textContent?.includes('Com Fulana de Tal'), 'secao da pessoa');
        // Vai à TMDB com a chave do usuário e com o nome SEM o "@" do atalho.
        expect(fetchTmdb.mock.calls.some(([url]) =>
            url.includes('/search/person') && url.includes('api_key=chave-de-teste') && url.endsWith('query=Fulana')
        )).toBe(true);
        expect(container.textContent?.includes('Filme Um')).toBe(true);
    });

    it('com a chave TMDB, o rodape sai em INGLES e em ESPANHOL — nada de portugues cravado', async () => {
        localStorage.setItem(CHAVE_TMDB, 'chave-de-teste');

        await trocarIdioma('en', RODAPE_EN);
        await abrir();
        expect(rodape()).toBe(`${RODAPE_EN} · @name searches by actor or director`);
        await fechar();

        await trocarIdioma('es', RODAPE_ES);
        await abrir();
        expect(rodape()).toBe(`${RODAPE_ES} · @nombre busca por actor o director`);
    });

    it('SEM a chave TMDB (ou so com espacos), o rodape nao promete — e o "@nome" de fato nao responderia', async () => {
        await abrir();
        expect(rodape()).toBe(RODAPE_PT);
        await fechar();

        // Chave só de espaços: o getTmdbApiKey a descarta, então o rodapé também.
        localStorage.setItem(CHAVE_TMDB, '   ');
        await abrir();
        expect(rodape()).toBe(RODAPE_PT);

        // O outro lado do contrato: sem chave, o "@nome" não vai à TMDB nem traz seção.
        await digitar('@Fulana');
        await esperar(() => !!container.textContent?.includes('Nenhum resultado encontrado'), 'busca assentada');
        expect(fetchTmdb).not.toHaveBeenCalled();
        expect(container.textContent?.includes('Com Fulana de Tal')).toBe(false);
    });

    it('a chave colada (ou apagada) no meio da sessao vale na proxima abertura', async () => {
        await abrir();
        expect(rodape()).toBe(RODAPE_PT);
        await fechar();

        localStorage.setItem(CHAVE_TMDB, 'chave-de-teste');
        await abrir();
        expect(rodape()).toBe(`${RODAPE_PT} · @nome busca por ator ou diretor`);
        await fechar();

        localStorage.removeItem(CHAVE_TMDB);
        await abrir();
        expect(rodape()).toBe(RODAPE_PT);
    });
});
