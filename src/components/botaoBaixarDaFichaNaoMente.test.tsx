import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 📥 O botão "Baixar" da ficha não pode mentir (D188).
 *
 * Ele mentia nas duas pontas:
 *   - o estado ia para "⏳ 0%" ANTES de resolver a URL, e só o
 *     `if (result?.success)` agia — `success:false` (provedor sem login,
 *     filme fora da lista M3U, portal Stalker recusando) não caía no `catch`
 *     e o botão ficava girando e DESABILITADO para sempre;
 *   - o download que falhava, era pausado, cancelado ou excluído DEPOIS de
 *     começar deixava o botão parado no último percentual (só 'progress' e
 *     'completed' eram ouvidos);
 *   - ao abrir a ficha, `isMovieInQueue` (pendente/pausado/baixando TAMBÉM)
 *     virava "✓ Baixado" — o filme só enfileirado aparecia como concluído;
 *   - trocar de versão do filme na mesma ficha deixava os ouvintes do
 *     download da versão anterior pintando o botão da nova;
 *   - na série, o primeiro episódio pedido prendia o botão: "baixando"
 *     desabilitava e "concluído" fazia o clique voltar sem abrir o seletor.
 *     Para pedir o segundo episódio era preciso fechar e reabrir a ficha.
 *
 * A ficha é montada DE VERDADE (react-dom/client + act); só o I/O (IPC,
 * TMDB) e os serviços de estado são dublês. O downloadService é um emissor
 * de verdade, para o teste disparar os eventos como o serviço dispara.
 */

// ---------------------------------------------------------------------------
// Dublês
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
    const ouvintes = new Map<string, Set<(item: unknown) => void>>();
    const estado = {
        filmeNaFila: false,
        filmeBaixado: false,
        episodiosNaFila: new Set<string>(),
    };
    const addDownload = vi.fn(async (
        name: string,
        type: string,
        _url: string,
        _cover: string,
        seriesInfo?: { season: number; episode: number },
    ) => {
        const id = type === 'episode' && seriesInfo
            ? `ep-${seriesInfo.season}-${seriesInfo.episode}`
            : `filme-${name}`;
        if (type === 'episode' && seriesInfo) estado.episodiosNaFila.add(`${seriesInfo.season}x${seriesInfo.episode}`);
        return { id, name, type, status: 'pending', progress: 0 };
    });
    const emitir = (evento: string, item: unknown) => {
        for (const cb of Array.from(ouvintes.get(evento) ?? [])) cb(item);
    };
    const totalDeOuvintes = () => Array.from(ouvintes.values()).reduce((n, s) => n + s.size, 0);
    return { ouvintes, estado, addDownload, emitir, totalDeOuvintes };
});

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
    getCatalogTitleIndex: vi.fn(async () => ({ vod: new Map(), series: new Map() })),
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
    movieProgressService: {
        getProgress: () => null,
        getMoviePositionById: () => null,
        isWatched: () => false,
        markWatched: vi.fn(),
        clearProgress: vi.fn(),
    },
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
        isDownloaded: (_name: string, type: string) => type === 'movie' && h.estado.filmeBaixado,
        isMovieInQueue: () => h.estado.filmeNaFila || h.estado.filmeBaixado,
        isEpisodeInQueue: (_serie: string, season: number, episode: number) =>
            h.estado.episodiosNaFila.has(`${season}x${episode}`),
        addDownload: h.addDownload,
        on: (evento: string, cb: (item: unknown) => void) => {
            if (!h.ouvintes.has(evento)) h.ouvintes.set(evento, new Set());
            h.ouvintes.get(evento)!.add(cb);
        },
        off: (evento: string, cb: (item: unknown) => void) => { h.ouvintes.get(evento)?.delete(cb); },
        isDownloading: () => false,
        getProgress: () => null,
    },
}));

vi.mock('../services/traktService', () => ({
    isTraktConnected: () => false,
    traktRate: vi.fn(async () => undefined),
}));

vi.mock('../services/personalMarksService', () => ({
    allTags: () => [],
    getMark: () => ({}),
    setRating: vi.fn(),
    toggleTag: vi.fn(),
}));

vi.mock('../services/profileService', () => ({
    profileService: { getActiveProfile: () => null },
}));

vi.mock('./CastDeviceSelector', () => ({ CastDeviceSelector: () => null }));

import { ContentDetailModal } from './ContentDetailModal';
import { languageService } from '../services/languageService';
import pt from '../locales/ui/pt.json';

const EPISODIOS = {
    success: true,
    info: {
        episodes: {
            '1': [
                { id: '101', episode_num: 1, title: 'Primeiro Capitulo' },
                { id: '102', episode_num: 2, title: 'Segundo Capitulo' },
            ],
        },
    },
};

const TXT = pt.contentModal as Record<string, string>;
const FILME = 'Filme de Teste (2020)';

/** Espera uma CONDIÇÃO (nunca um número fixo de voltas) dentro do act. */
async function esperar(condicao: () => boolean, oQue: string) {
    const prazo = Date.now() + 2500;
    while (Date.now() < prazo) {
        if (condicao()) return;
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    }
    if (!condicao()) throw new Error(`nao aconteceu: ${oQue}`);
}

type RespostaDaUrl = { success: boolean; url?: string; error?: string } | 'rejeita';

describe('botao Baixar da ficha diz a verdade (D188)', () => {
    let container: HTMLDivElement;
    let root: Root;
    let urlDoFilme: RespostaDaUrl;
    let urlDoEpisodio: RespostaDaUrl;

    beforeEach(() => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        languageService.setLanguage('pt');
        h.ouvintes.clear();
        h.estado.filmeNaFila = false;
        h.estado.filmeBaixado = false;
        h.estado.episodiosNaFila.clear();
        h.addDownload.mockClear();
        urlDoFilme = { success: true, url: 'http://provedor.invalido/filme.mp4' };
        urlDoEpisodio = { success: true, url: 'http://provedor.invalido/ep.mp4' };
        const responder = async (resposta: RespostaDaUrl) => {
            if (resposta === 'rejeita') throw new Error('IPC caiu');
            return resposta;
        };
        // Só a propriedade — não trocamos o window do jsdom.
        Object.defineProperty(window, 'ipcRenderer', {
            configurable: true,
            writable: true,
            value: {
                invoke: vi.fn(async (canal: string) => {
                    if (canal === 'streams:get-vod-url') return responder(urlDoFilme);
                    if (canal === 'streams:get-series-url') return responder(urlDoEpisodio);
                    return EPISODIOS;
                }),
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

    /** O botão "Baixar", achado pelo title que a pessoa vê ao passar o mouse. */
    const botaoBaixar = (): HTMLButtonElement => {
        const botao = Array.from(container.querySelectorAll('button'))
            .find(b => b.title === TXT.downloadTooltip || b.title === TXT.downloaded);
        if (!botao) throw new Error('botao Baixar nao encontrado');
        return botao;
    };
    const rotulo = () => botaoBaixar().textContent ?? '';
    const naTela = (texto: string) => !!container.textContent?.includes(texto);

    const fichaDoFilme = (nome = FILME, id = '1') => (
        <ContentDetailModal
            isOpen
            onClose={() => { }}
            contentId={id}
            contentType="movie"
            contentData={{ name: nome, cover: 'https://exemplo.invalido/capa.jpg' }}
            onPlay={() => { }}
        />
    );

    async function montarFilme() {
        await act(async () => { root.render(fichaDoFilme()); });
        await esperar(() => { try { botaoBaixar(); return true; } catch { return false; } }, 'botao Baixar na tela');
    }

    async function montarSerie() {
        await act(async () => {
            root.render(
                <ContentDetailModal
                    isOpen
                    onClose={() => { }}
                    contentId="7"
                    contentType="series"
                    contentData={{ name: 'Serie de Teste (2020)', cover: 'https://exemplo.invalido/capa.jpg' }}
                    onPlay={() => { }}
                />
            );
        });
        await esperar(() => naTela('Segundo Capitulo'), 'lista de episodios na tela');
    }

    /** Clica em "Baixar" e espera o download entrar na fila; devolve o item. */
    async function comecarDownloadDoFilme(progresso: number) {
        await act(async () => { botaoBaixar().click(); });
        await esperar(() => h.addDownload.mock.calls.length > 0, 'download entrar na fila');
        const item = await h.addDownload.mock.results[0].value as { id: string };
        await act(async () => { h.emitir('progress', { id: item.id, progress: progresso, status: 'downloading' }); });
        await esperar(() => rotulo().includes(`${progresso}%`), `progresso ${progresso}% na tela`);
        // Baixando de verdade: o botão do filme trava (sem pedido duplicado).
        expect(botaoBaixar().disabled).toBe(true);
        return item;
    }

    const seletorAberto = () => naTela(TXT.whatToDownload);

    async function pedirEpisodio1() {
        await act(async () => { botaoBaixar().click(); });
        await esperar(seletorAberto, 'seletor de download aberto');
        const soEsse = Array.from(container.querySelectorAll('button'))
            .find(b => b.textContent?.includes(TXT.onlyEpisode.replace('{episode}', '1')));
        if (!soEsse) throw new Error('botao "Apenas Episodio 1" nao encontrado');
        await act(async () => { soEsse.click(); });
    }

    it.each<[string, RespostaDaUrl]>([
        ['success:false (sem login, fora da lista)', { success: false, error: 'Not authenticated' }],
        ['success:true sem url', { success: true }],
        ['IPC rejeita', 'rejeita'],
    ])('filme: URL que nao resolve (%s) volta o botao para "Baixar" e avisa', async (_caso, resposta) => {
        urlDoFilme = resposta;
        await montarFilme();

        await act(async () => { botaoBaixar().click(); });

        await esperar(() => naTela(TXT.downloadFailed), 'aviso de falha');
        expect(rotulo().includes(TXT.download)).toBe(true);
        expect(rotulo().includes('%')).toBe(false);
        expect(botaoBaixar().disabled).toBe(false);
        expect(h.addDownload).not.toHaveBeenCalled();
    });

    it('filme: download que falha depois de comecar volta o botao, avisa, solta os ouvintes e o novo pedido comeca do 0%', async () => {
        await montarFilme();
        const item = await comecarDownloadDoFilme(30);

        await act(async () => { h.emitir('error', { id: item.id, progress: 30, status: 'failed' }); });

        await esperar(() => !rotulo().includes('%'), 'botao sair do percentual');
        expect(rotulo().includes(TXT.download)).toBe(true);
        expect(botaoBaixar().disabled).toBe(false);
        expect(naTela(TXT.downloadFailed)).toBe(true);
        expect(h.totalDeOuvintes()).toBe(0);

        // Tentar de novo: o botão não herda o "30%" do download que falhou.
        await act(async () => { botaoBaixar().click(); });
        await esperar(() => h.addDownload.mock.calls.length === 2, 'segundo pedido entrar na fila');
        expect(rotulo().includes('30%')).toBe(false);
        expect(rotulo().includes('0%')).toBe(true);
    });

    it.each(['cancelled', 'deleted'])('filme: download %s na tela de Downloads devolve o botao "Baixar"', async (evento) => {
        await montarFilme();
        const item = await comecarDownloadDoFilme(10);

        // O serviço emite o item com o status que ele tinha (não há status "cancelado").
        await act(async () => { h.emitir(evento, { id: item.id, progress: 10, status: 'downloading' }); });

        await esperar(() => !rotulo().includes('%'), 'botao sair do percentual');
        expect(rotulo().includes(TXT.download)).toBe(true);
        expect(botaoBaixar().disabled).toBe(false);
        expect(h.totalDeOuvintes()).toBe(0);
    });

    it('filme: download pausado na tela de Downloads vira "Na fila", sem percentual, e nao re-enfileira', async () => {
        await montarFilme();
        const item = await comecarDownloadDoFilme(20);

        await act(async () => { h.emitir('paused', { id: item.id, progress: 20, status: 'paused' }); });

        await esperar(() => rotulo().includes(TXT.downloadQueued), 'rotulo de fila');
        expect(rotulo().includes('%')).toBe(false);
        expect(rotulo().includes(TXT.downloaded)).toBe(false);
        expect(h.totalDeOuvintes()).toBe(0);
        await act(async () => { botaoBaixar().click(); });
        expect(h.addDownload).toHaveBeenCalledTimes(1);
    });

    it('filme so enfileirado (pendente/pausado) NAO aparece como "Baixado"', async () => {
        h.estado.filmeNaFila = true;
        await montarFilme();
        await esperar(() => rotulo().includes(TXT.downloadQueued), 'rotulo de fila');

        expect(rotulo().includes(TXT.downloaded)).toBe(false);
        expect(botaoBaixar().title).not.toBe(TXT.downloaded);
        // E clicar não enfileira de novo.
        await act(async () => { botaoBaixar().click(); });
        expect(h.addDownload).not.toHaveBeenCalled();
    });

    it('filme baixado de verdade continua aparecendo como "Baixado"', async () => {
        h.estado.filmeBaixado = true;
        await montarFilme();
        await esperar(() => rotulo().includes(TXT.downloaded), 'rotulo Baixado');
        expect(botaoBaixar().title).toBe(TXT.downloaded);
    });

    it('filme: caminho feliz mostra o progresso, ignora evento de OUTRO download, termina em "Baixado" e solta os ouvintes', async () => {
        await montarFilme();
        const item = await comecarDownloadDoFilme(40);
        expect(h.addDownload.mock.calls[0][2]).toBe('http://provedor.invalido/filme.mp4');

        // Outro download (outro título) falhando não mexe neste botão.
        await act(async () => { h.emitir('error', { id: 'outro-download', progress: 5, status: 'failed' }); });
        expect(rotulo().includes('40%')).toBe(true);
        expect(naTela(TXT.downloadFailed)).toBe(false);

        await act(async () => { h.emitir('completed', { id: item.id, progress: 100, status: 'completed' }); });
        await esperar(() => rotulo().includes(TXT.downloaded), 'rotulo Baixado');
        expect(h.totalDeOuvintes()).toBe(0);
    });

    it('filme: fechar a ficha no meio do download solta os ouvintes', async () => {
        await montarFilme();
        await comecarDownloadDoFilme(15);
        expect(h.totalDeOuvintes()).toBeGreaterThan(0);

        await act(async () => { root.render(<div />); });

        expect(h.totalDeOuvintes()).toBe(0);
    });

    it('filme: trocar de versao na mesma ficha nao deixa o download da versao anterior pintar o botao da nova', async () => {
        await montarFilme();
        const item = await comecarDownloadDoFilme(50);

        await act(async () => { root.render(fichaDoFilme(`${FILME} 4K`, '2')); });
        await esperar(() => !rotulo().includes('%'), 'botao da versao nova sem o percentual da anterior');
        expect(h.totalDeOuvintes()).toBe(0);

        await act(async () => { h.emitir('completed', { id: item.id, progress: 100, status: 'completed' }); });
        expect(rotulo().includes(TXT.downloaded)).toBe(false);
        expect(rotulo().includes(TXT.download)).toBe(true);
    });

    it('serie: com um episodio baixando, o botao continua abrindo o seletor', async () => {
        await montarSerie();
        await pedirEpisodio1();
        await esperar(() => h.addDownload.mock.calls.length > 0, 'episodio 1 entrar na fila');
        await esperar(() => !seletorAberto(), 'seletor fechar');
        await esperar(() => naTela(TXT.downloadQueued), 'aviso de que entrou na fila');

        expect(botaoBaixar().disabled).toBe(false);
        await act(async () => { botaoBaixar().click(); });
        await esperar(seletorAberto, 'seletor reabrir com o episodio 1 ainda baixando');
    });

    it('serie: depois do primeiro episodio concluido, o botao ainda abre o seletor para pedir o proximo', async () => {
        await montarSerie();
        await pedirEpisodio1();
        await esperar(() => h.addDownload.mock.calls.length > 0, 'episodio 1 entrar na fila');
        const item = await h.addDownload.mock.results[0].value as { id: string };
        await act(async () => { h.emitir('completed', { id: item.id, progress: 100, status: 'completed' }); });
        await esperar(() => !seletorAberto(), 'seletor fechado');

        // A série não vira "Baixado" por causa de UM episódio.
        expect(rotulo().includes(TXT.downloaded)).toBe(false);
        await act(async () => { botaoBaixar().click(); });
        await esperar(seletorAberto, 'seletor reabrir depois do episodio 1 concluido');
        // E o seletor oferece o que falta (o episódio 2), não "temporada completa".
        expect(naTela(TXT.downloadRemaining.replace('{count}', '1').replace('{downloaded}', '1'))).toBe(true);
    });

    it.each<[string, RespostaDaUrl]>([
        ['success:false', { success: false, error: 'Episódio não encontrado na lista M3U' }],
        ['IPC rejeita', 'rejeita'],
    ])('serie: URL do episodio que nao resolve (%s) avisa em vez de sumir calada', async (_caso, resposta) => {
        urlDoEpisodio = resposta;
        await montarSerie();
        await pedirEpisodio1();

        await esperar(() => naTela(TXT.downloadFailed), 'aviso de falha');
        expect(h.addDownload).not.toHaveBeenCalled();
        expect(naTela(TXT.downloadQueued)).toBe(false);
        expect(botaoBaixar().disabled).toBe(false);
    });
});
