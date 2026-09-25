import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

/**
 * ⏱️ O "tempo de boot" de Configurações → Sobre (#D057).
 *
 * A marca `homeReady` — a única que faz o bootProfiler gravar o resumo do
 * boot — só era chamada DENTRO do ramo de cache quente do `fetchData` da
 * Home. No boot de verdade o cache de módulo da Home está vazio
 * (`timestamp: 0`), então o caminho é sempre o da rede, e a marca nunca era
 * registrada: o Sobre nunca mostrava a linha do tempo de boot. Só uma
 * remontagem da Home dentro dos 5 min do cache marcava — medindo o tempo até
 * a SEGUNDA visita, não o boot.
 *
 * Aqui a Home é montada DE VERDADE (react-dom/client + act), na primeira
 * montagem do módulo — exatamente o boot: cache vazio, catálogo via IPC. Só
 * são dublês os componentes pesados, o portão parental (aberto) e o IPC.
 *
 * O que se afirma:
 *   1. a Home do boot (caminho da rede) grava o `homeReady` só DEPOIS que o
 *      catálogo chega — enquanto o IPC ainda não respondeu, nada foi gravado —
 *      e o Sobre mostra a linha "Último boot: Início pronto em {ms}ms" com
 *      esse número;
 *   2. a Home remontada com o cache quente NÃO sobrescreve o boot: o resumo
 *      gravado continua o da primeira pintura;
 *   3. se o catálogo falhar, a Home ainda pinta (sai do "carregando") — e o
 *      boot também é registrado, porque é o tempo até a tela ficar pronta.
 */

vi.mock('../components/ContentDetailModal', () => ({ ContentDetailModal: () => null }));
vi.mock('../components/AsyncVideoPlayer', () => ({ default: () => null }));
vi.mock('../components/NextEpisodes', () => ({ NextEpisodes: () => null }));
vi.mock('../components/ResumeModal', () => ({ ResumeModal: () => null }));
vi.mock('../components/ContinueFramePreview', () => ({ ContinueFramePreview: () => null }));
vi.mock('../services/recommendationService', () => ({
    getHomeRecommendations: vi.fn(async () => []),
}));
vi.mock('../services/traktBackfillService', () => ({ runTraktBackfill: vi.fn() }));
vi.mock('../services/indexedDBCache', () => ({
    indexedDBCache: {
        getHiddenItems: vi.fn(async () => [] as string[]),
        isItemHidden: vi.fn(async () => false),
        getCachedMovie: vi.fn(async () => null),
        getCachedSeries: vi.fn(async () => null),
        setCacheMovie: vi.fn(async () => undefined),
        setCacheSeries: vi.fn(async () => undefined),
        hideItem: vi.fn(async () => undefined),
        getAllCachedMovies: vi.fn(async () => new Map()),
        getAllCachedSeries: vi.fn(async () => new Map()),
    },
}));
vi.mock('../hooks/useHomeContentGate', async (importOriginal) => {
    const real = await importOriginal<typeof import('../hooks/useHomeContentGate')>();
    return { ...real, useHomeContentGate: () => () => true };
});

import { Home } from './Home';
import { AboutSection } from './settings/AboutSection';
import { bootProfiler } from '../services/bootProfiler';
import { languageService } from '../services/languageService';

const FILME = { stream_id: 7001, name: 'Filme Do Boot Medido', stream_icon: '', category_id: '2', added: 1_700_000_000 };
const SERIE = { series_id: 8001, name: 'Serie Do Boot Medido', cover: '', category_id: '1', added: 1_700_000_000 };

let container: HTMLDivElement;
let root: Root;
let invoke: ReturnType<typeof vi.fn>;

/** Espera uma CONDIÇÃO (nunca um número fixo de voltas). */
async function esperar(condicao: () => boolean, oQue: string) {
    const limite = Date.now() + 4000;
    while (Date.now() < limite) {
        if (condicao()) return;
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    }
    throw new Error(`nao aconteceu: ${oQue} | tela: ${(container.textContent ?? '').slice(0, 600)}`);
}

function ipcDoCatalogo({ falhar = false, filmesChegam }: { falhar?: boolean; filmesChegam?: Promise<void> } = {}) {
    invoke = vi.fn(async (canal: string) => {
        if (falhar && canal.startsWith('streams:')) throw new Error('provedor fora do ar');
        if (canal === 'content:get-counts') return { success: true, counts: { live: 0, vod: 1, series: 1 } };
        if (canal === 'streams:get-series') return { success: true, data: [SERIE] };
        if (canal === 'streams:get-vod') {
            // O provedor pode segurar a resposta: o boot só termina quando ela chega.
            if (filmesChegam) await filmesChegam;
            return { success: true, data: [FILME] };
        }
        return { success: false };
    });
    // Só a PROPRIEDADE ipcRenderer — o window do jsdom continua o mesmo.
    Object.defineProperty(window, 'ipcRenderer', {
        configurable: true,
        writable: true,
        value: { invoke, send: vi.fn(), on: vi.fn(), off: vi.fn(), removeListener: vi.fn() },
    });
}

const pediuOCatalogo = () => invoke.mock.calls.filter(c => String(c[0]).startsWith('streams:')).length;
const naTela = (texto: string) => (container.textContent ?? '').includes(texto);

async function montarHome() {
    await act(async () => {
        root.render(<MemoryRouter><Home /></MemoryRouter>);
    });
}

describe('tempo de boot em Configurações → Sobre', () => {
    beforeEach(() => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        vi.stubGlobal('__APP_VERSION__', '0.0.0-teste');
        localStorage.clear();
        sessionStorage.clear();
        languageService.setLanguage('pt');
        localStorage.setItem('neostream_resume_on_open', '0');
        // Cada caso é um "renderer novo": as marcas do bootProfiler são de módulo.
        bootProfiler._reset();

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        // A Home guarda o catálogo num cache de MÓDULO (5 min): o evento de
        // "catálogo atualizado" zera o cache, e a desmontagem no mesmo act
        // descarta a recarga que ele agendaria. Assim cada caso começa no boot.
        act(() => {
            window.dispatchEvent(new Event('neostream-catalog-refresh'));
            root.unmount();
        });
        container.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        localStorage.clear();
        sessionStorage.clear();
    });

    it('a Home do boot (cache vazio, catalogo pela rede) grava o homeReady quando o catalogo chega e o Sobre mostra o tempo', async () => {
        let entregarFilmes!: () => void;
        const filmesChegam = new Promise<void>(resolve => { entregarFilmes = resolve; });
        ipcDoCatalogo({ filmesChegam });
        await montarHome();

        // O caminho é o da REDE, e o provedor ainda não respondeu os filmes:
        // a Home continua carregando, então o boot ainda NÃO terminou.
        await esperar(() => invoke.mock.calls.some(c => c[0] === 'streams:get-vod'), 'a Home pedir os filmes pelo IPC');
        expect(bootProfiler.getLast()).toBeNull();

        const antesDaResposta = performance.now();
        await act(async () => { entregarFilmes(); });
        await esperar(() => naTela(FILME.name), 'a Home pintar o catalogo vindo do IPC');
        await esperar(() => bootProfiler.getLast()?.marks.homeReady !== undefined, 'o boot ser gravado (homeReady)');

        const homeMs = bootProfiler.getLast()!.marks.homeReady;
        expect(typeof homeMs).toBe('number');
        // A marca é o fim da carga, não a montagem da Home.
        expect(homeMs).toBeGreaterThanOrEqual(Math.floor(antesDaResposta));

        // O Sobre lê o resumo gravado e mostra a linha com esse número.
        act(() => { root.unmount(); });
        root = createRoot(container);
        await act(async () => { root.render(<AboutSection />); });
        const linha = languageService.t('about', 'bootTime').replace('{ms}', String(homeMs));
        expect(naTela(linha)).toBe(true);
    }, 15000);

    it('a Home remontada com o cache quente nao sobrescreve o boot gravado', async () => {
        ipcDoCatalogo();
        await montarHome();
        await esperar(() => naTela(FILME.name), 'a Home do boot pintar o catalogo');
        await esperar(() => bootProfiler.getLast()?.marks.homeReady !== undefined, 'o boot ser gravado (homeReady)');
        const doBoot = bootProfiler.getLast()!;
        // O relógio anda antes da volta: uma regravação teria outro `at`/número.
        await esperar(
            () => Date.now() > doBoot.at + 20 && performance.now() > doBoot.marks.homeReady + 20,
            'o relogio andar depois do boot',
        );

        // Sai da Home e volta dentro dos 5 min: agora o caminho é o do cache.
        act(() => { root.unmount(); });
        root = createRoot(container);
        const pedidosAntes = pediuOCatalogo();
        await montarHome();
        await esperar(() => naTela(FILME.name), 'a Home remontada pintar do cache');
        expect(pediuOCatalogo()).toBe(pedidosAntes); // foi mesmo o cache quente

        expect(bootProfiler.getLast()).toEqual(doBoot);
    }, 15000);

    it('com o catalogo fora do ar a Home ainda sai do carregando e o boot e registrado', async () => {
        const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        ipcDoCatalogo({ falhar: true });
        await montarHome();
        await esperar(() => pediuOCatalogo() > 0 && erro.mock.calls.length > 0, 'a carga do catalogo falhar');
        await esperar(() => bootProfiler.getLast()?.marks.homeReady !== undefined, 'o boot ser gravado mesmo com a falha');
        expect(typeof bootProfiler.getLast()!.marks.homeReady).toBe('number');
    }, 15000);
});
