/**
 * D032 — regras de gravação automática e alertas por palavra-chave só
 * enxergavam as linhas do Guia que a pessoa tinha rolado.
 *
 * O Guia só busca EPG das linhas renderizadas da categoria aberta, e as duas
 * funcionalidades varriam só esse estado. Com o Guia fechado (ou a linha fora
 * da tela) a regra nunca agendava e o alerta nunca tocava. Estes testes
 * cobrem a varredura própria, desacoplada da rolagem, o relógio que a liga no
 * boot e as pontas da fiação (App e Guia).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fonteApp from '../App.tsx?raw';
import fonteGuia from '../pages/EpgGuide.tsx?raw';

const fetchChannelEPG = vi.fn();
vi.mock('./epgService', () => ({
    epgService: { fetchChannelEPG: (...args: unknown[]) => fetchChannelEPG(...args) }
}));

import {
    ATRASO_BOOT_MS,
    CICLO_VARREDURA_MS,
    dispararVarreduraEpg,
    escolherCanaisParaVarredura,
    iniciarVarreduraEpg,
    pararVarreduraEpg,
    varrerEpgEmSegundoPlano
} from './epgVarreduraRegras';
import { _resetGuiaEpgCacheParaTeste, loadChannelEpg } from './guiaEpgCache';
import { recordingRuleService, type RecordingRule } from './recordingRuleService';
import { addKeyword } from './epgKeywordAlertService';
import { scheduledRecordingService } from './scheduledRecordingService';
import { appNotificationService } from './episodeNotificationService';
import { parentalService } from './parentalService';

interface Canal {
    num: number;
    name: string;
    stream_id: number;
    epg_channel_id: string;
    category_id: string;
}

const AGORA = Date.now();
const emHoras = (h: number) => new Date(AGORA + h * 3600_000).toISOString();

/**
 * 120 canais em 3 categorias; o canal-alvo fica lá no fim da terceira. Depois
 * um canal adulto e um infantil, cada um na sua categoria.
 */
function montarCanais(): Canal[] {
    const canais: Canal[] = [];
    let id = 1;
    for (const cat of ['1', '2', '3']) {
        for (let i = 0; i < 40; i++) {
            canais.push({ num: id, name: `Canal ${cat}-${i}`, stream_id: id, epg_channel_id: `c${id}`, category_id: cat });
            id += 1;
        }
    }
    canais.push({ num: id, name: 'Adulto Noite', stream_id: id, epg_channel_id: `c${id}`, category_id: '9' });
    id += 1;
    canais.push({ num: id, name: 'Toon Mirim', stream_id: id, epg_channel_id: `c${id}`, category_id: '5' });
    return canais;
}

const CATEGORIAS = [
    { category_id: '1', category_name: 'Abertos', parent_id: 0 },
    { category_id: '2', category_name: 'Esportes', parent_id: 0 },
    { category_id: '3', category_name: 'Notícias', parent_id: 0 },
    { category_id: '5', category_name: 'Infantis', parent_id: 0 },
    { category_id: '9', category_name: 'Adultos +18', parent_id: 0 }
];

/** EPG falso: só o canal-alvo, o adulto e o infantil têm programa que casa. */
function programasDe(nome: string) {
    if (nome === 'Canal 3-39') {
        return [
            { id: 'a', start: emHoras(-1), end: emHoras(0.5), title: 'Jornal da Manhã', channel_id: 'x' },
            { id: 'b', start: emHoras(3), end: emHoras(4), title: 'Jornal da Noite', channel_id: 'x' },
            { id: 'c', start: emHoras(5), end: emHoras(7), title: 'Final do Campeonato', channel_id: 'x' }
        ];
    }
    if (nome === 'Adulto Noite') {
        return [{ id: 'd', start: emHoras(2), end: emHoras(3), title: 'Sessão Proibido', channel_id: 'x' }];
    }
    if (nome === 'Toon Mirim') {
        return [{ id: 'e', start: emHoras(2), end: emHoras(3), title: 'Jornal Mirim', channel_id: 'x' }];
    }
    return [{ id: 'z', start: emHoras(1), end: emHoras(2), title: `Reprise ${nome}`, channel_id: 'x' }];
}

/** Espera uma CONDIÇÃO (nunca um número fixo de voltas). */
async function esperarAte(cond: () => boolean, oQue: string) {
    for (let i = 0; i < 400; i++) {
        if (cond()) return;
        await new Promise(r => setTimeout(r, 5));
    }
    throw new Error(`esperei demais: ${oQue}`);
}

const pedidosDeCanais = () => invoke.mock.calls.filter(c => c[0] === 'streams:get-live').length;

let invoke: ReturnType<typeof vi.fn>;
let ipcOriginal: unknown;
let parentalOriginal: ReturnType<typeof parentalService.getConfig>;

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    _resetGuiaEpgCacheParaTeste();
    window.location.hash = '#/dashboard/home';
    parentalOriginal = parentalService.getConfig();
    fetchChannelEPG.mockReset();
    fetchChannelEPG.mockImplementation(async (_id: string, nome: string) => {
        await new Promise(r => setTimeout(r, 1));
        return programasDe(nome);
    });
    const canais = montarCanais();
    invoke = vi.fn(async (canal: string) => {
        if (canal === 'streams:get-live') return { success: true, data: canais };
        if (canal === 'categories:get-live') return { success: true, data: CATEGORIAS };
        return { success: false };
    });
    const w = window as unknown as { ipcRenderer?: unknown };
    ipcOriginal = w.ipcRenderer;
    w.ipcRenderer = { invoke, send: vi.fn(), on: vi.fn(), off: vi.fn() };
});

afterEach(() => {
    pararVarreduraEpg();
    vi.useRealTimers();
    for (const s of scheduledRecordingService.list()) scheduledRecordingService.remove(s.id);
    parentalService.setConfig(parentalOriginal);
    (window as unknown as { ipcRenderer?: unknown }).ipcRenderer = ipcOriginal;
    window.location.hash = '';
});

describe('varredura de EPG em segundo plano (D032)', () => {
    it('regra agenda o programa futuro de um canal que nenhuma tela do Guia carregou', async () => {
        expect(recordingRuleService.add('^Jornal')).toBe(true);

        const r = await varrerEpgEmSegundoPlano({ nowMs: AGORA });

        const agendados = scheduledRecordingService.list();
        expect(agendados.map(a => a.title)).toEqual(['Jornal da Noite', 'Jornal Mirim']);
        expect(agendados[0].channelName).toBe('Canal 3-39');
        expect(agendados[0].streamId).toBe(120);
        expect(r.agendados).toBe(2);

        // Segunda passada não duplica.
        const r2 = await varrerEpgEmSegundoPlano({ nowMs: AGORA });
        expect(r2.agendados).toBe(0);
        expect(scheduledRecordingService.list()).toHaveLength(2);
    });

    it('palavra-chave toca o sino para canal fora da tela, uma vez só', async () => {
        addKeyword('Final');

        const r = await varrerEpgEmSegundoPlano({ nowMs: AGORA });

        const doSino = appNotificationService.getNotifications().filter(n => n.type === 'epg_keyword');
        expect(doSino).toHaveLength(1);
        expect(doSino[0].message.includes('Final do Campeonato')).toBe(true);
        expect(doSino[0].message.includes('Canal 3-39')).toBe(true);
        expect(r.alertas).toBe(1);

        await varrerEpgEmSegundoPlano({ nowMs: AGORA });
        expect(appNotificationService.getNotifications().filter(n => n.type === 'epg_keyword')).toHaveLength(1);
    });

    it('respeita o bloqueio parental: canal adulto nem é buscado', async () => {
        parentalService.setConfig({ enabled: true, blockAdultCategories: true });
        recordingRuleService.add('Proibido');
        addKeyword('Proibido');

        await varrerEpgEmSegundoPlano({ nowMs: AGORA });

        expect(fetchChannelEPG.mock.calls.length).toBeGreaterThan(0);
        expect(fetchChannelEPG.mock.calls.some(c => c[1] === 'Adulto Noite')).toBe(false);
        expect(scheduledRecordingService.list()).toHaveLength(0);
        expect(appNotificationService.getNotifications().filter(n => n.type === 'epg_keyword')).toHaveLength(0);
    });

    it('com a sessão liberada pelo PIN, o canal adulto volta a valer (igual ao Guia)', async () => {
        parentalService.setConfig({ enabled: true, blockAdultCategories: true });
        parentalService.unlockSession();
        recordingRuleService.add('Proibido');

        await varrerEpgEmSegundoPlano({ nowMs: AGORA });

        expect(scheduledRecordingService.list().map(a => a.channelName)).toEqual(['Adulto Noite']);
    });

    it('perfil infantil: só as categorias infantis são varridas', async () => {
        localStorage.setItem('neostream_profiles', JSON.stringify({
            profiles: [{ id: 'k', name: 'Kid', avatar: 'x', isKids: true, createdAt: 0 }],
            activeProfileId: 'k'
        }));
        recordingRuleService.add('^Jornal');

        await varrerEpgEmSegundoPlano({ nowMs: AGORA });

        expect(fetchChannelEPG.mock.calls.map(c => c[1])).toEqual(['Toon Mirim']);
        expect(scheduledRecordingService.list().map(a => a.title)).toEqual(['Jornal Mirim']);
    });

    it('sem regra nem palavra-chave não pede nada a ninguém', async () => {
        const r = await varrerEpgEmSegundoPlano({ nowMs: AGORA });
        expect(r.canais).toBe(0);
        expect(invoke).not.toHaveBeenCalled();
        expect(fetchChannelEPG).not.toHaveBeenCalled();
    });

    it('lista de canais que falha (sem login) não busca EPG nem agenda', async () => {
        recordingRuleService.add('^Jornal');
        invoke.mockImplementation(async () => ({ success: false, error: 'Not authenticated' }));
        const r = await varrerEpgEmSegundoPlano({ nowMs: AGORA });
        expect(r.canais).toBe(0);
        expect(fetchChannelEPG).not.toHaveBeenCalled();
    });

    it('não roda nas janelas secundárias (PiP / multi-view)', async () => {
        recordingRuleService.add('^Jornal');
        window.location.hash = '#/pip';
        const r = await varrerEpgEmSegundoPlano({ nowMs: AGORA });
        expect(r.canais).toBe(0);
        expect(invoke).not.toHaveBeenCalled();
    });

    it('regra restrita a canal busca só os canais que ela nomeia', async () => {
        recordingRuleService.add('^Jornal', '3-39');
        const r = await varrerEpgEmSegundoPlano({ nowMs: AGORA });
        expect(r.canais).toBe(1);
        expect(fetchChannelEPG).toHaveBeenCalledTimes(1);
        expect(scheduledRecordingService.list().map(a => a.title)).toEqual(['Jornal da Noite']);
    });

    it('usa no máximo 2 das 4 vagas do limitador (sobra vaga para a tela do Guia)', async () => {
        let emVoo = 0;
        let pico = 0;
        fetchChannelEPG.mockImplementation(async (_id: string, nome: string) => {
            emVoo += 1;
            pico = Math.max(pico, emVoo);
            await new Promise(r => setTimeout(r, 2));
            emVoo -= 1;
            return programasDe(nome);
        });
        addKeyword('Final');
        await varrerEpgEmSegundoPlano({ nowMs: AGORA, teto: 20 });
        expect(fetchChannelEPG).toHaveBeenCalledTimes(20);
        expect(pico).toBe(2);
    });

    it('o limitador compartilhado segura 4 buscas de uma vez, somando Guia e varredura', async () => {
        const soltar: Array<() => void> = [];
        let emVoo = 0;
        let pico = 0;
        fetchChannelEPG.mockImplementation((_id: string, nome: string) => new Promise(resolve => {
            emVoo += 1;
            pico = Math.max(pico, emVoo);
            soltar.push(() => { emVoo -= 1; resolve(programasDe(nome)); });
        }));
        const pedidos = Array.from({ length: 6 }, (_, i) =>
            loadChannelEpg({ name: `G${i}`, epg_channel_id: `g${i}`, stream_id: 900 + i }));
        await esperarAte(() => soltar.length >= 4, '4 buscas no ar');
        // A quinta e a sexta esperam vaga: as 6 pediram no mesmo tique, então
        // um limitador frouxo já teria posto a quinta no ar junto.
        expect(fetchChannelEPG).toHaveBeenCalledTimes(4);
        while (soltar.length) soltar.shift()!();
        await esperarAte(() => soltar.length === 2, 'as 2 que esperavam entram');
        while (soltar.length) soltar.shift()!();
        await Promise.all(pedidos);
        expect(pico).toBe(4);
    });

    it('Guia e varredura pedindo o mesmo canal ao mesmo tempo fazem UMA busca só', async () => {
        const alvo = { name: 'Canal 3-39', epg_channel_id: 'c120', stream_id: 120 };
        const doGuia = loadChannelEpg(alvo);
        recordingRuleService.add('^Jornal', '3-39');
        const r = await varrerEpgEmSegundoPlano({ nowMs: AGORA });
        expect(r.agendados).toBe(1);
        expect((await doGuia).map(p => p.title).includes('Jornal da Noite')).toBe(true);
        expect(fetchChannelEPG).toHaveBeenCalledTimes(1);
    });

    it('o que a varredura buscou fica no cache que o Guia lê', async () => {
        recordingRuleService.add('^Jornal', '3-39');
        await varrerEpgEmSegundoPlano({ nowMs: AGORA });
        expect(fetchChannelEPG).toHaveBeenCalledTimes(1);

        const alvo = { name: 'Canal 3-39', epg_channel_id: 'c120', stream_id: 120 };
        const doGuia = await loadChannelEpg(alvo);
        expect(doGuia.map(p => p.title).includes('Jornal da Noite')).toBe(true);
        expect(fetchChannelEPG).toHaveBeenCalledTimes(1);

        // Cache mais velho que o aceito é buscado de novo.
        await loadChannelEpg(alvo, { maxAgeMs: -1 });
        expect(fetchChannelEPG).toHaveBeenCalledTimes(2);
    });

    it('a varredura rebusca o que ficou mais velho que um ciclo (senão a grade nova nunca chegaria)', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(AGORA);
        recordingRuleService.add('^Jornal', '3-39');

        await varrerEpgEmSegundoPlano({ nowMs: AGORA });
        expect(fetchChannelEPG).toHaveBeenCalledTimes(1);

        vi.setSystemTime(AGORA + CICLO_VARREDURA_MS - 60_000);
        await varrerEpgEmSegundoPlano({ nowMs: AGORA });
        expect(fetchChannelEPG).toHaveBeenCalledTimes(1);

        vi.setSystemTime(AGORA + CICLO_VARREDURA_MS + 60_000);
        await varrerEpgEmSegundoPlano({ nowMs: AGORA });
        expect(fetchChannelEPG).toHaveBeenCalledTimes(2);
    });

    it('disparos simultâneos são coalescidos e o pedido que chega no meio roda de novo', async () => {
        recordingRuleService.add('^Jornal', '3-39');
        const p1 = dispararVarreduraEpg();
        const p2 = dispararVarreduraEpg();
        expect(p2).toBe(p1);
        await p1;
        // duas passadas (a original + a repetição), a segunda saiu do cache
        expect(pedidosDeCanais()).toBe(2);
        expect(fetchChannelEPG).toHaveBeenCalledTimes(1);

        // Terminada a passada, um disparo novo é uma passada nova.
        await dispararVarreduraEpg();
        expect(pedidosDeCanais()).toBe(3);
    });
});

describe('relógio da varredura (boot atrasado + ciclo)', () => {
    it('nada antes do atraso do boot, uma passada no atraso e outra a cada ciclo; ligar duas vezes não dobra', async () => {
        fetchChannelEPG.mockImplementation(async (_id: string, nome: string) => programasDe(nome));
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        recordingRuleService.add('^Jornal', '3-39');

        iniciarVarreduraEpg();
        iniciarVarreduraEpg(); // StrictMode / remontagem: idempotente

        await vi.advanceTimersByTimeAsync(ATRASO_BOOT_MS - 1);
        expect(invoke).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(pedidosDeCanais()).toBe(1);
        await vi.waitFor(() => expect(scheduledRecordingService.list().map(a => a.title)).toEqual(['Jornal da Noite']));

        await vi.advanceTimersByTimeAsync(CICLO_VARREDURA_MS);
        expect(pedidosDeCanais()).toBe(2);

        // Desliga e drena a passada em curso antes de sair.
        pararVarreduraEpg();
        await dispararVarreduraEpg();
        const depois = pedidosDeCanais();
        await vi.advanceTimersByTimeAsync(CICLO_VARREDURA_MS * 2);
        expect(pedidosDeCanais()).toBe(depois);
    });

    it('não liga o relógio numa janela secundária', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        recordingRuleService.add('^Jornal');
        window.location.hash = '#/multiview';
        iniciarVarreduraEpg();
        window.location.hash = '#/dashboard/home';
        await vi.advanceTimersByTimeAsync(ATRASO_BOOT_MS + CICLO_VARREDURA_MS);
        expect(invoke).not.toHaveBeenCalled();
    });
});

/**
 * As pontas da fiação que um teste de serviço não monta: o App (boot) e o
 * botão ＋ das regras no Guia. Montar o App inteiro ou o Guia (player, IPC,
 * virtualização) não cabe aqui; a garantia é textual, presa ao trecho certo.
 */
describe('fiação da varredura', () => {
    const semCr = (s: string) => s.replace(/\r\n/g, '\n');

    it('o App liga o relógio no boot, dentro da ponte que monta em toda janela', () => {
        const app = semCr(fonteApp);
        const ponte = app.slice(app.indexOf('function ProgramReminderBridge()'));
        const corpo = ponte.slice(0, ponte.indexOf('\n}\n'));
        expect(corpo.length).toBeGreaterThan(0);
        expect(/import\('\.\/services\/epgVarreduraRegras'\)[\s\S]*iniciarVarreduraEpg\(\)/.test(corpo)).toBe(true);
        expect(app.includes('<ProgramReminderBridge />')).toBe(true);
    });

    it('o Guia aplica as regras pela mesma função e dispara a varredura ao criar regra', () => {
        const guia = semCr(fonteGuia);
        expect(guia.includes('aplicarRegrasDeGravacao(streams, name => epgByChannel[name])')).toBe(true);
        expect(/if \(recordingRuleService\.add\([^)]*\)\) \{[^}]*void dispararVarreduraEpg\(\);[^}]*\}/.test(guia)).toBe(true);
        // O cache do Guia é o compartilhado, não um mapa próprio da página.
        expect(guia.includes('new Map<string, EPGProgram[]>()')).toBe(false);
        expect(guia.includes("from '../services/guiaEpgCache'")).toBe(true);
    });
});

describe('escolherCanaisParaVarredura', () => {
    const regra = (pattern: string, channelName?: string): RecordingRule =>
        ({ id: pattern, pattern, channelName, createdAt: '' });
    const c = (name: string, stream_id: number, epg_channel_id = '') => ({ name, stream_id, epg_channel_id });

    it('prioriza canal nomeado por regra, depois favoritos, depois EPG do provedor, e corta no teto', () => {
        const streams = [
            c('Sem EPG A', 1),
            c('Com EPG B', 2, 'b'),
            c('Favorito C', 3),
            c('Esporte D', 4),
            c('Com EPG E', 5, 'e')
        ];
        const escolhidos = escolherCanaisParaVarredura(
            streams,
            [regra('^Gol', 'esporte'), regra('^Jornal')],
            [],
            new Set(['3']),
            4
        );
        expect(escolhidos.map(s => s.name)).toEqual(['Esporte D', 'Favorito C', 'Com EPG B', 'Com EPG E']);
    });

    it('o teto padrão corta listas grandes', () => {
        const muitos = Array.from({ length: 400 }, (_, i) => c(`K${i}`, i, `k${i}`));
        expect(escolherCanaisParaVarredura(muitos, [], ['x'], new Set())).toHaveLength(150);
    });

    it('nada cadastrado → nenhum canal', () => {
        expect(escolherCanaisParaVarredura([c('A', 1)], [], [], new Set())).toEqual([]);
    });

    it('nome repetido na lista do provedor entra uma vez só (o cache é por nome)', () => {
        const escolhidos = escolherCanaisParaVarredura([c('A', 1), c('A', 2)], [], ['x'], new Set());
        expect(escolhidos).toHaveLength(1);
    });
});

// Esperas: a passada/promessa é aguardada, ou uma CONDIÇÃO é verificada em
// laço (esperarAte / vi.waitFor) — nunca um número fixo de microtasks. O
// teste não troca o window inteiro, só window.ipcRenderer, restaurado no
// afterEach.
