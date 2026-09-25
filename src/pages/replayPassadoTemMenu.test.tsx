/**
 * D039 — o replay do programa que JÁ PASSOU tem que dar pra baixar.
 *
 * No Guia, o clique no bloco abria o menu (ProgramActionsPopover) só pro
 * programa no ar de canal com arquivo e pro programa futuro. O programa
 * passado e replayável ia direto pro player (startReplay), sem menu — e o
 * menu é o único lugar onde mora "⬇ Baixar como gravação". Resultado
 * invertido: dava pra baixar o replay do que ainda está passando (gravação
 * que nasce cortada) e NÃO dava pra baixar o do que já terminou.
 *
 * Aqui a página é montada de verdade e o teste clica onde a pessoa clica.
 * O player é dublado (só marca que abriu), o EPG vem de um cache dublado e o
 * timeshift devolve uma URL fixa pra conferir o que chega no dvr:start.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { languageService } from '../services/languageService';
import { getGuideWindow } from '../utils/epgGuide';

vi.mock('../components/AsyncVideoPlayer', () => ({
    default: (props: { customTitle?: string }) => <div data-testid="player">{props.customTitle}</div>,
}));

const URL_TIMESHIFT = 'http://provedor.invalid/timeshift/u/p/32/2026-09-25:10-00/1.ts';
const getTimeshiftUrl = vi.fn<(req: { streamId: number; startIso: string; durationMin: number }) => Promise<{ url: string }>>(
    async () => ({ url: URL_TIMESHIFT }));
vi.mock('../services/timeshiftService', () => ({
    getTimeshiftUrl: (req: unknown) => getTimeshiftUrl(req as Parameters<typeof getTimeshiftUrl>[0]),
}));

interface Prog { id: string; start: string; end: string; title: string; channel_id: string }
const programasPorCanal = new Map<string, Prog[]>();
vi.mock('../services/guiaEpgCache', () => ({
    epgEmCache: (nome: string) => programasPorCanal.get(nome),
    loadChannelEpg: async (canal: { name: string }) => programasPorCanal.get(canal.name) ?? [],
    snapshotEpgCache: () => new Map(programasPorCanal),
}));

import { EpgGuide } from './EpgGuide';

const MIN = 60_000;
const HORA = 60 * MIN;
const CANAL_COM_ARQUIVO = 'Canal Arquivo';
const CANAL_SEM_ARQUIVO = 'Canal Simples';
const CANAL_ARQUIVO_CURTO = 'Canal Arquivo Curto';

function canal(nome: string, id: number, tvArchive: number, diasDeArquivo: number) {
    return {
        num: id, name: nome, stream_type: 'live', stream_id: id, stream_icon: '',
        epg_channel_id: `ch${id}`, added: '', category_id: '1', custom_sid: '',
        tv_archive: tvArchive, direct_source: '', tv_archive_duration: diasDeArquivo,
    };
}

let container: HTMLDivElement;
let root: Root;
let chamadasIpc: Array<{ canal: string; arg: unknown }>;
let inicioPassado: string;

function t(chave: string): string {
    return languageService.t('guide', chave);
}

async function esperar(condicao: () => boolean, oQue: string): Promise<void> {
    const limite = Date.now() + 3000;
    while (!condicao()) {
        if (Date.now() > limite) throw new Error(`não aconteceu: ${oQue}`);
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    }
}

function bloco(titulo: string): HTMLDivElement {
    const achado = [...container.querySelectorAll<HTMLDivElement>('.guide-program')]
        .find(el => (el.title || '').includes(titulo));
    if (!achado) throw new Error(`bloco "${titulo}" não está na grade`);
    return achado;
}

function acoesDoMenu(): string[] {
    return [...container.querySelectorAll('[role="menuitem"]')].map(b => (b.textContent || '').trim());
}

function itemDoMenu(rotulo: string): HTMLButtonElement {
    const achado = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find(b => (b.textContent || '').includes(rotulo));
    if (!achado) throw new Error(`"${rotulo}" não está no menu (tem: ${acoesDoMenu().join(' | ')})`);
    return achado;
}

async function clicar(el: HTMLElement) {
    await act(async () => { el.click(); });
}

async function montarGuia() {
    await act(async () => { root.render(<EpgGuide />); });
    await esperar(() => container.querySelectorAll('.guide-program').length >= 4, 'a grade mostrar os programas');
}

describe('D039 — replay do programa que já passou tem o menu com ⬇ Baixar', () => {
    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        localStorage.clear();
        getTimeshiftUrl.mockClear();
        chamadasIpc = [];

        if (typeof globalThis.ResizeObserver === 'undefined') {
            (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
                observe() { /* jsdom não mede */ }
                unobserve() { /* idem */ }
                disconnect() { /* idem */ }
            };
        }

        // Programas SEMPRE dentro da janela padrão do guia: ela começa entre
        // 30 e 60 min antes de agora, então [agora-29min, agora-2min] cabe.
        const agora = Date.now();
        const janela = getGuideWindow(agora);
        expect(janela.start).toBeLessThanOrEqual(agora - 29 * MIN);
        inicioPassado = new Date(agora - 29 * MIN).toISOString();
        const fimPassado = new Date(agora - 2 * MIN).toISOString();
        const fimNoAr = new Date(agora + 40 * MIN).toISOString();
        programasPorCanal.clear();
        programasPorCanal.set(CANAL_COM_ARQUIVO, [
            { id: 'p1', start: inicioPassado, end: fimPassado, title: 'Jornal Que Passou', channel_id: 'ch32' },
            { id: 'p2', start: fimPassado, end: fimNoAr, title: 'Novela No Ar', channel_id: 'ch32' },
        ]);
        programasPorCanal.set(CANAL_SEM_ARQUIVO, [
            { id: 'p3', start: inicioPassado, end: fimPassado, title: 'Desenho Sem Arquivo', channel_id: 'ch33' },
        ]);
        // Canal COM arquivo, mas de 1 dia só: o bloco "maratona" começou há 30h
        // (fora da retenção) e acabou há 2 min. Aparece na grade (é cortado pela
        // janela), mas o provedor não tem mais o começo dele — não é replayável.
        programasPorCanal.set(CANAL_ARQUIVO_CURTO, [
            { id: 'p4', start: new Date(agora - 30 * HORA).toISOString(), end: fimPassado, title: 'Maratona Antiga', channel_id: 'ch34' },
        ]);

        Object.defineProperty(window, 'ipcRenderer', {
            configurable: true,
            value: {
                invoke: async (canalIpc: string, arg?: unknown) => {
                    chamadasIpc.push({ canal: canalIpc, arg });
                    if (canalIpc === 'streams:get-live') {
                        return {
                            success: true,
                            data: [
                                canal(CANAL_COM_ARQUIVO, 32, 1, 3),
                                canal(CANAL_SEM_ARQUIVO, 33, 0, 0),
                                canal(CANAL_ARQUIVO_CURTO, 34, 1, 1),
                            ],
                        };
                    }
                    if (canalIpc === 'categories:get-live') {
                        return { success: true, data: [{ category_id: '1', category_name: 'Variedades', parent_id: 0 }] };
                    }
                    return { success: true };
                },
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

    it('clicar no programa passado abre o menu (▶ do início + ⬇ baixar), sem "ao vivo" e sem abrir o player', async () => {
        await montarGuia();
        await clicar(bloco('Jornal Que Passou'));

        expect(container.querySelector('[data-testid="player"]'), 'foi direto pro player, sem menu').toBeNull();
        const acoes = acoesDoMenu();
        expect(acoes.length, 'o menu não abriu').toBe(2);
        expect(acoes.some(a => a.includes(t('watchFromStart')))).toBe(true);
        expect(acoes.some(a => a.includes(t('downloadReplay')))).toBe(true);
        expect(acoes.some(a => a.includes(t('watchLive'))), 'programa que já passou não tem "ao vivo"').toBe(false);
    });

    it('⬇ no menu do programa passado manda o replay dele pro DVR', async () => {
        await montarGuia();
        await clicar(bloco('Jornal Que Passou'));
        await clicar(itemDoMenu(t('downloadReplay')));

        await esperar(() => chamadasIpc.some(c => c.canal === 'dvr:start'), 'o dvr:start ser chamado');
        expect(getTimeshiftUrl).toHaveBeenCalledTimes(1);
        const pedido = getTimeshiftUrl.mock.calls[0][0];
        expect(pedido.streamId).toBe(32);
        expect(pedido.startIso).toBe(inicioPassado);
        const dvr = chamadasIpc.find(c => c.canal === 'dvr:start')!.arg as { url: string; channelName: string };
        expect(dvr.url).toBe(URL_TIMESHIFT);
        expect(dvr.channelName).toBe(`${CANAL_COM_ARQUIVO} - Jornal Que Passou`);
        expect(acoesDoMenu(), 'o menu devia fechar depois da ação').toEqual([]);
        expect(container.querySelector('[data-testid="player"]'), 'baixar não abre o player').toBeNull();
    });

    it('▶ no menu do programa passado abre o replay no player', async () => {
        await montarGuia();
        await clicar(bloco('Jornal Que Passou'));
        await clicar(itemDoMenu(t('watchFromStart')));

        const player = container.querySelector('[data-testid="player"]');
        expect(player, 'o replay não abriu').not.toBeNull();
        expect(player!.textContent).toBe(`Jornal Que Passou — ${CANAL_COM_ARQUIVO}`);
        expect(acoesDoMenu()).toEqual([]);
        expect(chamadasIpc.some(c => c.canal === 'dvr:start'), 'assistir não grava').toBe(false);
    });

    it('programa no ar em canal com arquivo continua com as três ações', async () => {
        await montarGuia();
        await clicar(bloco('Novela No Ar'));

        const acoes = acoesDoMenu();
        expect(acoes.length).toBe(3);
        expect(acoes.some(a => a.includes(t('watchLive')))).toBe(true);
        expect(acoes.some(a => a.includes(t('watchFromStart')))).toBe(true);
        expect(acoes.some(a => a.includes(t('downloadReplay')))).toBe(true);
    });

    it('programa passado em canal SEM arquivo não abre menu nem player', async () => {
        await montarGuia();
        await clicar(bloco('Desenho Sem Arquivo'));

        expect(acoesDoMenu()).toEqual([]);
        expect(container.querySelector('[data-testid="player"]')).toBeNull();
    });

    it('programa passado FORA da retenção do arquivo do canal não abre menu nem player', async () => {
        await montarGuia();
        await clicar(bloco('Maratona Antiga'));

        expect(acoesDoMenu()).toEqual([]);
        expect(container.querySelector('[data-testid="player"]')).toBeNull();
    });
});
