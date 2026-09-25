import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 🏷️ Digitar uma tag na ficha de SÉRIE e apertar Enter não pode tocar episódio.
 *
 * A ficha escuta o teclado na janela inteira: ↑/↓ trocam o episódio
 * selecionado e Enter toca. O listener não olhava para ONDE a tecla foi
 * digitada — então, com o foco no campo "+ tag", o Enter que salva a tag
 * TAMBÉM disparava o `onPlay` (o app saía tocando o episódio) e as setas,
 * que deviam mexer no cursor/lista de sugestões do campo, trocavam o episódio.
 *
 * Os casos montam a ficha DE VERDADE (react-dom/client + act, o padrão de
 * src/components/textosDaFichaDeSerieTraduzidos.test.tsx), com a lista de
 * episódios carregada, e mandam as teclas como a pessoa mandaria.
 *
 * As pontas do invariante:
 *   1. Enter no campo de tag salva a tag e NÃO chama `onPlay`;
 *   2. setas no campo de tag NÃO trocam o episódio selecionado;
 *   3. vale para qualquer campo de digitação (textarea, select, conteúdo
 *      editável) — mesmo critério do atalho do player;
 *   4. fora de campo de texto o atalho continua valendo (↓ + Enter toca o
 *      episódio 2) — é esta ponta que pega "desligar o atalho de vez".
 */

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('../services/tmdb', () => ({
    resolveSeriesDetails: vi.fn(async () => null),
    resolveMovieDetails: vi.fn(async () => null),
    fetchMovieTrailer: vi.fn(async () => null),
    fetchSeriesTrailer: vi.fn(async () => null),
    fetchCollection: vi.fn(async () => null),
    fetchSimilarByTmdbId: vi.fn(async () => []),
    fetchCastByTmdbId: vi.fn(async () => []),
    fetchPersonFilmography: vi.fn(async () => []),
}));

vi.mock('../services/catalogTitleIndex', () => ({
    getCatalogTitleIndex: vi.fn(async () => ({ movies: new Map(), series: new Map() })),
}));

vi.mock('../services/watchProgressService', () => ({
    watchProgressService: {
        getSeriesProgress: () => ({ lastSeason: 1, lastEpisode: 1 }),
        getLastWatchedEpisode: () => null,
        getEpisodeProgress: () => null,
        isEpisodeWatched: () => false,
        clearEpisodeProgress: vi.fn(),
        markEpisodeWatched: vi.fn(),
    },
}));

vi.mock('../services/movieProgressService', () => ({
    movieProgressService: { getProgress: () => null, isWatched: () => false, markWatched: vi.fn(), clearProgress: vi.fn() },
}));

vi.mock('../services/watchLater', () => ({
    watchLaterService: { has: () => false, add: vi.fn(), remove: vi.fn() },
}));

vi.mock('../services/favoritesService', () => ({
    favoritesService: { has: () => false, toggle: vi.fn() },
}));

vi.mock('../services/queueService', () => ({
    queueService: { has: () => false, add: vi.fn(), remove: vi.fn() },
}));

vi.mock('../services/downloadService', () => ({
    downloadService: {
        getOfflineFilePath: () => null,
        getOfflineEpisodePath: () => null,
        isDownloaded: () => false,
        isEpisodeInQueue: () => false,
        isMovieInQueue: () => false,
        addDownload: vi.fn(),
        on: vi.fn(), off: vi.fn(),
        isDownloading: () => false,
        getProgress: () => null,
    },
}));

vi.mock('../services/traktService', () => ({
    isTraktConnected: () => false,
    traktRate: vi.fn(async () => undefined),
}));

const toggleTag = vi.fn();
vi.mock('../services/personalMarksService', () => ({
    allTags: () => [],
    getMark: () => ({}),
    setRating: vi.fn(),
    toggleTag: (...args: unknown[]) => toggleTag(...args),
}));

vi.mock('../services/profileService', () => ({
    profileService: { getActiveProfile: () => null },
}));

vi.mock('./CastDeviceSelector', () => ({ CastDeviceSelector: () => null }));

import { ContentDetailModal } from './ContentDetailModal';
import { languageService } from '../services/languageService';

const EPISODIOS = {
    success: true,
    info: {
        episodes: {
            '1': [
                { id: '101', episode_num: 1, title: 'Primeiro Capitulo' },
                { id: '102', episode_num: 2, title: 'Segundo Capitulo' },
                { id: '103', episode_num: 3, title: 'Terceiro Capitulo' },
            ],
        },
    },
};

/** Espera uma CONDIÇÃO (nunca um número fixo de voltas). */
async function esperar(condicao: () => boolean, oQue: string) {
    for (let i = 0; i < 400; i++) {
        if (condicao()) return;
        await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    }
    throw new Error(`nao aconteceu: ${oQue}`);
}

describe('Enter/setas no campo de tag da ficha de serie nao mexem no episodio', () => {
    let container: HTMLDivElement;
    let root: Root;
    let onPlay: ReturnType<typeof vi.fn<(season?: number, episode?: number, offlineUrl?: string) => void>>;

    beforeEach(() => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        languageService.setLanguage('pt');
        toggleTag.mockReset();
        onPlay = vi.fn();
        // Só a propriedade — não trocamos o window do jsdom.
        Object.defineProperty(window, 'ipcRenderer', {
            configurable: true,
            writable: true,
            value: {
                invoke: vi.fn(async () => EPISODIOS),
                send: vi.fn(),
                on: vi.fn(),
                off: vi.fn(),
            },
        });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => { root.unmount(); });
        container.remove();
    });

    async function montarFichaComEpisodios() {
        await act(async () => {
            root.render(
                <ContentDetailModal
                    isOpen
                    onClose={() => { }}
                    contentId="7"
                    contentType="series"
                    contentData={{ name: 'Serie de Teste (2020)', cover: 'https://exemplo.invalido/capa.jpg' }}
                    onPlay={onPlay}
                />
            );
        });
        await esperar(() => !!container.textContent?.includes('Segundo Capitulo'), 'lista de episodios na tela');
    }

    function campoDeTag(): HTMLInputElement {
        const campo = container.querySelector<HTMLInputElement>('input[list="ns-known-tags"]');
        if (!campo) throw new Error('campo de tag nao encontrado');
        return campo;
    }

    /** Digita no campo do jeito que o React enxerga (setter nativo + evento input). */
    async function digitar(campo: HTMLInputElement, texto: string) {
        await act(async () => {
            campo.focus();
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            setter.call(campo, texto);
            campo.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }

    /** Manda a tecla e devolve o evento (para ler `defaultPrevented`). */
    async function tecla(alvo: EventTarget, key: string): Promise<KeyboardEvent> {
        const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        await act(async () => { alvo.dispatchEvent(ev); });
        return ev;
    }

    /** Enter fora de qualquer campo: toca o que está selecionado. Devolve o episódio. */
    async function episodioQueEnterToca(): Promise<number | undefined> {
        (document.activeElement as HTMLElement | null)?.blur?.();
        onPlay.mockClear();
        await tecla(document.body, 'Enter');
        expect(onPlay).toHaveBeenCalledTimes(1);
        expect(onPlay.mock.calls[0][0]).toBe(1);
        return onPlay.mock.calls[0][1];
    }

    it('Enter no campo de tag salva a tag e NAO toca o episodio', async () => {
        await montarFichaComEpisodios();
        const campo = campoDeTag();

        await digitar(campo, 'Cult');
        await tecla(campo, 'Enter');

        expect(toggleTag).toHaveBeenCalledWith('series', '7', 'Cult');
        expect(onPlay).not.toHaveBeenCalled();
    });

    it('setas no campo de tag NAO trocam o episodio selecionado', async () => {
        await montarFichaComEpisodios();
        const campo = campoDeTag();

        await act(async () => { campo.focus(); });
        const setaNoCampo = await tecla(campo, 'ArrowDown');
        await tecla(campo, 'ArrowDown');
        // O campo continua dono da seta (cursor / sugestões do datalist).
        expect(setaNoCampo.defaultPrevented).toBe(false);

        // Fora do campo, Enter toca o que ficou selecionado: tem que ser o 1.
        expect(await episodioQueEnterToca()).toBe(1);
    });

    it('vale para qualquer campo de digitacao: textarea, select e conteudo editavel', async () => {
        await montarFichaComEpisodios();

        const textarea = document.createElement('textarea');
        const select = document.createElement('select');
        const editavel = document.createElement('div');
        editavel.contentEditable = 'true';
        // jsdom não calcula `isContentEditable` (o Chromium do Electron sim).
        if (editavel.isContentEditable !== true) {
            Object.defineProperty(editavel, 'isContentEditable', { configurable: true, value: true });
        }

        for (const campo of [textarea, select, editavel]) {
            document.body.appendChild(campo);
            try {
                const seta = await tecla(campo, 'ArrowDown');
                await tecla(campo, 'Enter');
                expect(seta.defaultPrevented, `seta em ${campo.tagName}`).toBe(false);
                expect(onPlay, `Enter em ${campo.tagName}`).not.toHaveBeenCalled();
            } finally {
                campo.remove();
            }
        }

        // Nenhuma seta digitada nos campos trocou o episódio selecionado.
        expect(await episodioQueEnterToca()).toBe(1);
    });

    it('fora de campo de texto o atalho continua: seta para baixo + Enter toca o episodio 2', async () => {
        await montarFichaComEpisodios();

        const seta = await tecla(document.body, 'ArrowDown');
        expect(seta.defaultPrevented).toBe(true);

        expect(await episodioQueEnterToca()).toBe(2);
    });
});
