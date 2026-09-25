/**
 * 📺 D180 — o botão do episódio no modal da série tem que fazer o que diz.
 *
 * Tudo que não era 'completed' caía no mesmo ramo: com o episódio BAIXANDO o
 * modal dizia "ainda não foi baixado" (logo abaixo do "45%" que ele mesmo
 * desenha na lista) e o botão laranja "Retomar Download" executava um bloco
 * vazio; com 'pending' o rótulo virava "Aguardando na fila..." mas o botão
 * seguia clicável e também não fazia nada. Aqui a página é montada de
 * verdade, o modal é aberto pelo card e cada estado é clicado.
 *
 * O serviço falso faz o que o de verdade faz com o status: o pausar muda o
 * item para 'paused' e emite 'paused'; o retomar devolve o item à fila
 * ('pending') e NÃO emite nada (é o que acontece com a fila cheia). Assim o
 * teste enxerga se a tela troca de ramo depois do clique.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DownloadItem } from '../services/downloadService';

type Ouvinte = (item: DownloadItem) => void;

const h = vi.hoisted(() => ({
    itens: [] as DownloadItem[],
    ouvintes: new Map<string, Set<(item: never) => void>>(),
    pauseDownload: vi.fn<(id: string) => Promise<void>>(),
    resumeDownload: vi.fn<(id: string) => Promise<void>>(),
}));

function emitir(evento: string, item: DownloadItem) {
    h.ouvintes.get(evento)?.forEach(cb => (cb as Ouvinte)(item));
}

function criarItens(): DownloadItem[] {
    const ep = {
        type: 'episode' as const,
        url: 'http://x/ep.mp4',
        cover: '',
        size: 4096,
        createdAt: 1,
        seriesName: 'Serie D180',
        season: 1,
    };
    return [
        { ...ep, id: 'ep_d180_1', name: 'Serie D180 E1', episode: 1, status: 'downloading', progress: 45, downloadedBytes: 1843 },
        { ...ep, id: 'ep_d180_2', name: 'Serie D180 E2', episode: 2, status: 'pending', progress: 0, downloadedBytes: 0 },
        { ...ep, id: 'ep_d180_3', name: 'Serie D180 E3', episode: 3, status: 'paused', progress: 30, downloadedBytes: 1228 },
        { ...ep, id: 'ep_d180_4', name: 'Serie D180 E4', episode: 4, status: 'failed', progress: 10, downloadedBytes: 409, error: 'rede caiu' },
        { ...ep, id: 'ep_d180_5', name: 'Serie D180 E5', episode: 5, status: 'completed', progress: 100, downloadedBytes: 4096, filePath: 'C:/d/e5.mp4' },
        { type: 'movie', url: 'http://x/f.mp4', cover: '', size: 4096, createdAt: 1, id: 'mv_d180', name: 'Filme D180', status: 'downloading', progress: 45, downloadedBytes: 1843 },
    ];
}

const item = (id: string) => h.itens.find(i => i.id === id)!;

vi.mock('../components/AsyncVideoPlayer', () => ({ default: () => null }));

vi.mock('../services/downloadService', () => ({
    resumoDaSerie: () => ({ total: 3, concluidos: 0, baixando: 1, tamanho: 0 }),
    downloadService: {
        // Array novo a cada leitura, como o serviço de verdade (Array.from do mapa).
        getDownloads: () => [...h.itens],
        getDownloadsGrouped: () => ({
            movies: h.itens.filter(i => i.type === 'movie'),
            series: [{
                seriesName: 'Serie D180',
                cover: '',
                seasons: [{ season: 1, episodes: h.itens.filter(i => i.type === 'episode') }],
            }],
        }),
        getStorageInfo: async () => ({ used: 0, free: 0, total: 0 }),
        ensureProviderMaxConnections: async () => 4,
        getMaxConcurrent: () => 2,
        setMaxConcurrent: () => undefined,
        isNightOnly: () => false,
        setNightOnly: () => undefined,
        isSmartDownloads: () => false,
        setSmartDownloads: () => undefined,
        formatBytes: (n: number) => `${n} B`,
        deleteDownload: async () => undefined,
        deleteSeries: async () => undefined,
        pauseDownload: h.pauseDownload,
        resumeDownload: h.resumeDownload,
        openDownloadsFolder: () => undefined,
        on: (evento: string, cb: (item: never) => void) => {
            if (!h.ouvintes.has(evento)) h.ouvintes.set(evento, new Set());
            h.ouvintes.get(evento)!.add(cb);
        },
        off: (evento: string, cb: (item: never) => void) => { h.ouvintes.get(evento)?.delete(cb); },
    },
}));

import { Downloads } from './Downloads';

let container: HTMLDivElement;
let root: Root;

/** O botão de ação do episódio selecionado (o laranja de retomar, ou o de pausar). */
function botaoDaAcao(): HTMLButtonElement {
    const botao = container.querySelector('.resume-download-btn, .pause-download-btn');
    if (!botao) throw new Error('o botão de ação do episódio não está no modal');
    return botao as HTMLButtonElement;
}

/** A faixa de aviso que fica logo acima do botão. */
function textoDaAcao(): string {
    return botaoDaAcao().parentElement?.textContent ?? '';
}

async function abrirModalDaSerie() {
    await act(async () => { root.render(<Downloads />); });
    // O card da série é o que abre o modal (handleSeriesClick).
    const card = Array.from(container.querySelectorAll('.download-card.clickable'))
        .find(el => el.textContent?.includes('Serie D180'));
    if (!card) throw new Error('o card da série não está na tela');
    await act(async () => { (card as HTMLElement).click(); });
}

async function selecionarEpisodio(n: number) {
    const linha = Array.from(container.querySelectorAll<HTMLDivElement>('div'))
        .find(el => el.style.cursor === 'pointer' && el.textContent?.trim().startsWith(`${n}Episódio ${n}`));
    if (!linha) throw new Error(`a linha do episódio ${n} não está no modal`);
    await act(async () => { linha.click(); });
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    h.itens = criarItens();
    h.ouvintes.clear();
    h.pauseDownload.mockReset().mockImplementation(async (id) => {
        const alvo = item(id);
        if (alvo.status !== 'downloading') return;
        alvo.status = 'paused';
        emitir('paused', alvo);
    });
    h.resumeDownload.mockReset().mockImplementation(async (id) => {
        const alvo = item(id);
        if (alvo.status !== 'paused' && alvo.status !== 'failed') return;
        alvo.status = 'pending'; // e nenhum evento: a fila está cheia
    });
    localStorage.clear();
    // Propriedade no window existente — trocar o `window` inteiro quebra o React.
    Object.defineProperty(window, 'ipcRenderer', {
        configurable: true,
        value: {
            invoke: async () => ({ success: true, files: [], recordings: [] }),
            on: () => undefined,
            off: () => undefined,
            send: () => undefined,
        },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe('modal da série: o botão do episódio selecionado', () => {
    it('episódio BAIXANDO: mostra o progresso (não "ainda não foi baixado") e o botão pausa', async () => {
        await abrirModalDaSerie();
        // O primeiro episódio da temporada já vem selecionado.
        const texto = textoDaAcao();
        expect(texto.includes('ainda não foi baixado')).toBe(false);
        expect(texto.includes('45%')).toBe(true);
        expect(botaoDaAcao().textContent?.includes('Pausar download')).toBe(true);

        await act(async () => { botaoDaAcao().click(); });

        expect(h.pauseDownload).toHaveBeenCalledWith('ep_d180_1');
        expect(h.resumeDownload).not.toHaveBeenCalled();
        // Pausado de verdade, o modal troca de ramo sozinho (evento 'paused'):
        // agora oferece retomar, e não mais pausar.
        expect(container.querySelector('.pause-download-btn')).toBeNull();
        const retomar = botaoDaAcao();
        expect(retomar.textContent?.includes('Retomar Download')).toBe(true);
        expect(retomar.disabled).toBe(false);
    });

    it('episódio NA FILA: o botão "Aguardando na fila..." fica desabilitado e não chama nada', async () => {
        await abrirModalDaSerie();
        await selecionarEpisodio(2);

        const botao = botaoDaAcao();
        expect(botao.textContent?.includes('Aguardando na fila')).toBe(true);
        expect(botao.disabled).toBe(true);

        await act(async () => { botao.click(); });
        expect(h.pauseDownload).not.toHaveBeenCalled();
        expect(h.resumeDownload).not.toHaveBeenCalled();
    });

    it('episódio PAUSADO: o botão retoma e o modal passa a mostrar "na fila"', async () => {
        await abrirModalDaSerie();
        await selecionarEpisodio(3);

        const botao = botaoDaAcao();
        expect(botao.textContent?.includes('Retomar Download')).toBe(true);
        expect(botao.disabled).toBe(false);
        await act(async () => { botao.click(); });

        expect(h.resumeDownload).toHaveBeenCalledWith('ep_d180_3');
        expect(h.pauseDownload).not.toHaveBeenCalled();
        // O retomar não emite nada: sem recarregar, o botão seguia dizendo
        // "Retomar" para um item que já estava na fila.
        const depois = botaoDaAcao();
        expect(depois.textContent?.includes('Aguardando na fila')).toBe(true);
        expect(depois.disabled).toBe(true);
    });

    it('episódio QUE FALHOU: também retoma (como antes)', async () => {
        await abrirModalDaSerie();
        await selecionarEpisodio(4);

        const botao = botaoDaAcao();
        expect(botao.textContent?.includes('Retomar Download')).toBe(true);
        await act(async () => { botao.click(); });

        expect(h.resumeDownload).toHaveBeenCalledWith('ep_d180_4');
    });

    it('episódio BAIXADO: só o "Assistir", sem botão de pausar nem de retomar', async () => {
        await abrirModalDaSerie();
        await selecionarEpisodio(5);

        expect(container.querySelector('.resume-download-btn, .pause-download-btn')).toBeNull();
        const assistir = Array.from(container.querySelectorAll('button'))
            .find(b => b.textContent?.includes('Assistir'));
        expect(assistir).toBeDefined();
    });
});

describe('ouvinte do evento de pausa', () => {
    it('a tela se inscreve no \'paused\' e se desinscreve ao desmontar', async () => {
        await act(async () => { root.render(<Downloads />); });
        expect(h.ouvintes.get('paused')?.size).toBe(1);

        act(() => root.unmount());
        root = createRoot(container); // o afterEach desmonta de novo
        expect(h.ouvintes.get('paused')?.size ?? 0).toBe(0);
    });
});

describe('card do filme: o ⏸ troca o selo na hora', () => {
    it('depois do ⏸ o card do filme mostra "Pausado", e não segue em "45%"', async () => {
        await act(async () => { root.render(<Downloads />); });
        const card = Array.from(container.querySelectorAll('.download-card'))
            .find(el => el.textContent?.includes('Filme D180'))!;
        expect(card.querySelector('.status-badge.downloading')).not.toBeNull();

        const pausar = card.querySelector<HTMLButtonElement>('.card-overlay .resume-btn')!;
        await act(async () => { pausar.click(); });

        expect(h.pauseDownload).toHaveBeenCalledWith('mv_d180');
        const agora = Array.from(container.querySelectorAll('.download-card'))
            .find(el => el.textContent?.includes('Filme D180'))!;
        expect(agora.querySelector('.status-badge.downloading')).toBeNull();
        expect(agora.querySelector('.status-badge.paused')).not.toBeNull();
    });
});
