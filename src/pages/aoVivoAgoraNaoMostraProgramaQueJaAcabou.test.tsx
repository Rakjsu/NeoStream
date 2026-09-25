import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { LiveTV } from './LiveTV';
import { ChannelHoverMiniGuide } from '../components/ChannelHoverMiniGuide';
import { epgService } from '../services/epgService';
import { languageService } from '../services/languageService';
import { resetStorageJsonCache } from '../services/storageJsonCache';
import { scheduledRecordingService } from '../services/scheduledRecordingService';
import { needsEpgRefetch } from '../utils/liveEpgSchedule';

/**
 * 📺 D040 — "AO VIVO AGORA" mostrava um programa que já tinha acabado.
 *
 * `getCurrentProgram` procura o programa que cobre o agora e, quando não acha,
 * caía em `programs[0]` — o PRIMEIRO da lista. Numa grade toda vencida (guia
 * parado, XMLTV de ontem, ou simplesmente o último programa da grade que
 * acabou com a tela aberta) esse é o programa mais velho de todos, e a TV ao
 * vivo o pintava debaixo do selo pulsante `liveTV.nowPlaying`, com horário e
 * barra de progresso em 100%. O mini-guia do hover marcava "▶ Agora" nele, o
 * "a seguir" listava outro programa já passado, e o "gravar o próximo" do
 * controle do celular agendava uma gravação no passado.
 *
 * Agora: nada cobre o agora → o primeiro que AINDA NÃO TERMINOU (buraco na
 * grade continua caindo no que vem pela frente); tudo já passou → null, e a
 * tela mostra "sem informação" em vez de mentir.
 *
 * Os casos de tela montam a TV ao vivo e o mini-guia DE VERDADE (jsdom, só o
 * IPC do preload e a busca do guia dublados).
 */

type Programa = Awaited<ReturnType<typeof epgService.fetchChannelEPG>>[number];

const HORA = 3_600_000;

/** Programa de `deMs` a `ateMs` relativos ao agora. */
function prog(id: string, deMs: number, ateMs: number): Programa {
    const agora = Date.now();
    return {
        id,
        start: new Date(agora + deMs).toISOString(),
        end: new Date(agora + ateMs).toISOString(),
        title: id,
        channel_id: 'ch',
    };
}

function gradeVencida(): Programa[] {
    return [
        prog('velho-1', -5 * HORA, -4 * HORA),
        prog('velho-2', -4 * HORA, -3 * HORA),
        prog('velho-3', -3 * HORA, -2 * HORA),
    ];
}

const t = (secao: string, chave: string) => languageService.t(secao, chave);

describe('D040: getCurrentProgram não devolve programa que já acabou', () => {
    it('grade toda vencida → null (e o "a seguir" fica vazio junto)', () => {
        const grade = gradeVencida();
        const atual = epgService.getCurrentProgram(grade);
        expect(atual).toBeNull();
        // Quem pede "o próximo" (a seguir da tela, mini-guia, "gravar o
        // próximo" do celular) não recebe mais um programa do passado.
        expect(epgService.getUpcomingPrograms(grade, atual, 3)).toEqual([]);
    });

    it('buraco na grade → cai no primeiro que ainda vai passar, não no mais velho', () => {
        const grade = [
            prog('anterior', -3 * HORA, -2 * HORA),
            prog('ontem-a-noite', -2 * HORA, -HORA),
            prog('futuro', HORA, 2 * HORA),
            prog('depois', 2 * HORA, 3 * HORA),
        ];
        const atual = epgService.getCurrentProgram(grade);
        expect(atual?.id).toBe('futuro');
        expect(epgService.getUpcomingPrograms(grade, atual, 3).map(p => p.id)).toEqual(['depois']);
    });

    it('o que já documentava continua: no ar ganha, só-futuro cai no futuro, lista vazia é null', () => {
        const grade = [
            prog('anterior', -2 * HORA, -HORA),
            prog('agora', -HORA / 2, HORA / 2),
            prog('proximo', HORA / 2, HORA),
        ];
        expect(epgService.getCurrentProgram(grade)?.id).toBe('agora');
        expect(epgService.getCurrentProgram([prog('futuro', HORA, 2 * HORA)])?.id).toBe('futuro');
        expect(epgService.getCurrentProgram([])).toBeNull();
    });

    it('fim ilegível não conta como "ainda no ar"', () => {
        const quebrado = { ...prog('quebrado', -HORA, HORA), end: 'nao-e-data' };
        expect(epgService.getCurrentProgram([...gradeVencida(), quebrado])).toBeNull();
    });

    it('anda junto com o needsEpgRefetch: "sem informação" só quando a página vai buscar o guia de novo', () => {
        // Se o atual virasse null com a grade ainda dizendo algo sobre o agora
        // (needsEpgRefetch = false), a tela ficaria parada em "sem informação":
        // o tick da barra só roda com programa atual e o refetch só roda
        // quando o guia deixou de cobrir o agora. O critério tem de ser o mesmo
        // — o FIM do programa, não o começo — e com a mesma fronteira: o que
        // termina EXATAMENTE agora já não está adiante. Relógio congelado pra
        // fronteira ser exata.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-25T20:00:00.000Z'));
        const agoraIso = new Date(Date.now()).toISOString();
        const grades: [string, Programa[]][] = [
            ['vencida', gradeVencida()],
            ['vazia', []],
            ['buraco', [prog('antes', -2 * HORA, -HORA), prog('depois', HORA, 2 * HORA)]],
            ['início ilegível, fim adiante', [{ ...prog('sem-inicio', -HORA, HORA), start: 'nao-e-data' }]],
            ['fim ilegível', [{ ...prog('sem-fim', -HORA, HORA), end: 'nao-e-data' }]],
            ['início ilegível, fim exatamente agora', [{ ...prog('na-fronteira', -HORA, 0), start: 'nao-e-data', end: agoraIso }]],
            ['no ar', [prog('no-ar', -HORA, HORA)]],
        ];
        for (const [caso, grade] of grades) {
            const vaiBuscarDeNovo = needsEpgRefetch(grade, Date.now());
            const atual = epgService.getCurrentProgram(grade);
            expect(atual === null, `${caso}: atual=${atual?.id ?? 'null'}`).toBe(vaiBuscarDeNovo);
        }
    });
});

// ─── Montagem de tela (compartilhado) ───────────────────────────────────────

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** Espera a CONDIÇÃO com teto de tempo real — nunca um número fixo de voltas. */
async function esperar(condicao: () => boolean, oQue: string, limiteMs = 3000): Promise<void> {
    const inicio = performance.now();
    while (!condicao()) {
        if (performance.now() - inicio > limiteMs) {
            throw new Error(`nunca aconteceu: ${oQue}; tela: ${container?.textContent}`);
        }
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    }
}

function texto(): string {
    return container?.textContent ?? '';
}

/**
 * Tudo que chegou a ser PINTADO desde a montagem, não só o que sobrou no fim:
 * um programa vencido que aparece por um render e some logo depois (a virada
 * local corrigindo a busca) ainda é um "AO VIVO AGORA" mentiroso piscando.
 */
let jaPintado = '';
let vigia: MutationObserver | null = null;

function vigiarTela(): void {
    jaPintado = container?.textContent ?? '';
    vigia = new MutationObserver(registros => {
        for (const r of registros) {
            if (r.type === 'characterData') jaPintado += '\n' + (r.target.textContent ?? '');
            r.addedNodes.forEach(n => { jaPintado += '\n' + (n.textContent ?? ''); });
        }
    });
    vigia.observe(container!, { childList: true, subtree: true, characterData: true });
}

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(async () => {
    vigia?.disconnect();
    vigia = null;
    jaPintado = '';
    if (root) await act(async () => { root!.unmount(); });
    container?.remove();
    root = null;
    container = null;
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

async function renderizar(no: React.ReactNode): Promise<void> {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(no); });
}

describe('D040: o mini-guia do hover não marca "▶ Agora" num programa vencido', () => {
    // O mini-guia guarda um cache por streamId no módulo: cada teste usa o seu.
    let proximoStreamId = 940_400;

    async function montar(grade: Programa[]): Promise<void> {
        vi.spyOn(epgService, 'fetchChannelEPG').mockResolvedValue(grade);
        const streamId = proximoStreamId++;
        await renderizar(
            <ChannelHoverMiniGuide streamId={streamId} epgChannelId="canal.id" channelName="Canal" x={0} y={0} />,
        );
        await esperar(() => !texto().includes(t('guide', 'loading')), 'o guia carregar');
    }

    it('grade toda vencida → "sem informação", nenhum título velho, nenhum ▶', async () => {
        const grade = gradeVencida();
        await montar(grade);
        expect(texto().includes(t('liveTV', 'noScheduleInfo'))).toBe(true);
        expect(texto().includes('▶')).toBe(false);
        for (const p of grade) expect(texto().includes(p.title)).toBe(false);
    });

    it('programa no ar continua marcado como "▶ Agora" (o conserto não apaga o caso bom)', async () => {
        await montar([
            prog('passado', -2 * HORA, -HORA),
            prog('no-ar', -HORA / 2, HORA / 2),
            prog('seguinte', HORA / 2, HORA),
        ]);
        expect(texto().includes(`▶ ${t('guide', 'now')}`)).toBe(true);
        expect(texto().includes('no-ar')).toBe(true);
        expect(texto().includes('seguinte')).toBe(true);
        expect(texto().includes('passado')).toBe(false);
    });
});

// ─── TV ao vivo (a página) ──────────────────────────────────────────────────

const PERFIL = 'p1';

const CANAIS = [1, 2].map(i => ({
    num: i, name: `Canal Teste ${i}`, stream_type: 'live', stream_id: i, stream_icon: '',
    epg_channel_id: `canal${i}.tv`, added: '1600000000', category_id: '1', custom_sid: '',
    tv_archive: 0, direct_source: '', tv_archive_duration: 0,
}));

function semear() {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('neostream_active_playlist_id', 'pl1');
    localStorage.setItem('neostream_profiles', JSON.stringify({
        activeProfileId: PERFIL,
        profiles: [{ id: PERFIL, name: 'Dono', avatar: '🙂', isKids: false, createdAt: 1 }],
    }));
    resetStorageJsonCache();
}

type IpcDublado = {
    invoke: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
};

function dublarIpc(): IpcDublado {
    const invoke = vi.fn((canal: string) => {
        if (canal === 'streams:get-live') return Promise.resolve({ success: true, data: CANAIS });
        if (canal === 'categories:get-live') {
            return Promise.resolve({ success: true, data: [{ category_id: '1', category_name: 'Abertos', parent_id: 0 }] });
        }
        if (canal === 'auth:get-credentials') {
            return Promise.resolve({ success: true, credentials: { url: 'http://prov.example', username: 'u', password: 'p' } });
        }
        return Promise.resolve({ success: true, data: [] });
    });
    const ipc: IpcDublado = { invoke, send: vi.fn(), on: vi.fn(), off: vi.fn() };
    (window as unknown as { ipcRenderer: unknown }).ipcRenderer = ipc;
    return ipc;
}

/** Monta a TV ao vivo (guia dublado com `grade`) e espera a lista de canais. */
async function montarTv(grade: Programa[]): Promise<IpcDublado> {
    semear();
    const ipc = dublarIpc();
    vi.spyOn(epgService, 'fetchChannelEPG').mockResolvedValue(grade);
    await renderizar(<MemoryRouter><LiveTV /></MemoryRouter>);
    vigiarTela();
    await esperar(() => texto().includes('Canal Teste 2'), 'a grade de canais aparecer');
    return ipc;
}

/** Monta a TV ao vivo, abre o Canal Teste 1 e espera o painel do guia assentar. */
async function abrirCanalComGrade(grade: Programa[]): Promise<void> {
    await montarTv(grade);

    const card = Array.from(container!.querySelectorAll<HTMLElement>('.channels-grid > div'))
        .find(el => (el.textContent ?? '').includes('Canal Teste 1'));
    if (!card) throw new Error('sem o card do Canal Teste 1');
    await act(async () => { card.click(); });
    await esperar(() => texto().includes(t('liveTV', 'scheduleTitle')), 'o painel do canal abrir');
    await esperar(
        () => vi.mocked(epgService.fetchChannelEPG).mock.calls.length > 0,
        'a página pedir o guia do canal',
    );
    // A busca dublada já nasce resolvida: espera ELA e depois uma volta de
    // macrotarefa — nenhuma macrotarefa roda antes de a fila de microtarefas
    // esvaziar, então o setState da busca e a virada local (queueMicrotask)
    // já entraram. Sem isso a grade vencida "passaria" antes de o guia chegar.
    await act(async () => {
        await vi.mocked(epgService.fetchChannelEPG).mock.results[0].value;
        await new Promise(r => setTimeout(r, 0));
    });
}

/** O bloco "AO VIVO AGORA" do painel (o selo pulsante + título). */
function temBlocoAoVivo(titulo: string): boolean {
    return texto().includes(t('liveTV', 'nowPlaying') + titulo);
}

describe('D040: a TV ao vivo não pinta "AO VIVO AGORA" num programa que já acabou', () => {
    it('grade toda vencida → "sem informação", nenhum programa velho no painel', async () => {
        const grade = gradeVencida();
        await abrirCanalComGrade(grade);
        await esperar(() => texto().includes(t('liveTV', 'noScheduleInfo')), 'o aviso de guia sem informação');

        // Nem no fim, nem por um render sequer no meio do caminho.
        for (const p of grade) expect(jaPintado.includes(p.title), p.title).toBe(false);
        expect(jaPintado.includes(t('liveTV', 'nowPlaying'))).toBe(false);
        expect(texto().includes(t('liveTV', 'upNext'))).toBe(false);
    });

    it('programa no ar aparece como "AO VIVO AGORA", com o próximo em "a seguir"', async () => {
        await abrirCanalComGrade([
            prog('passado', -2 * HORA, -HORA),
            prog('no-ar', -HORA / 2, HORA / 2),
            prog('seguinte', HORA / 2, HORA),
        ]);
        await esperar(() => temBlocoAoVivo('no-ar'), 'o programa no ar aparecer no painel');

        expect(texto().includes('seguinte')).toBe(true);
        expect(jaPintado.includes('passado')).toBe(false);
        expect(texto().includes(t('liveTV', 'noScheduleInfo'))).toBe(false);
    });

    it('o último programa da grade acaba com a tela aberta → vira "sem informação", não volta pro mais velho', async () => {
        // Relógio falso só pros intervalos e pro Date, andando junto com o de
        // verdade (as esperas por condição e o debounce seguem funcionando).
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'], shouldAdvanceTime: true });
        await abrirCanalComGrade([
            prog('manha', -3 * HORA, -2 * HORA),
            prog('tarde', -2 * HORA, -HORA),
            prog('ultimo', -HORA, 5 * 60_000),
        ]);
        await esperar(() => temBlocoAoVivo('ultimo'), 'o último programa aparecer no ar');

        // Passa o fim do último programa: o tick de 10 s e o refetch de 60 s
        // rodam com a mesma grade (a fonte não tem nada mais novo).
        await act(async () => { vi.advanceTimersByTime(10 * 60_000); });
        await esperar(() => texto().includes(t('liveTV', 'noScheduleInfo')), 'o painel desistir do programa vencido');

        expect(texto().includes('ultimo')).toBe(false);
        // Os programas mais velhos da grade nunca foram "agora" — nem na virada.
        for (const titulo of ['manha', 'tarde']) {
            expect(jaPintado.includes(titulo), titulo).toBe(false);
        }
    });
});

// ─── Controle do celular (web remote) ───────────────────────────────────────

type Ouvinte = (e: unknown, acao: string, arg?: unknown) => void;

/**
 * Entrega um comando do celular como o IPC de verdade: pra TODO ouvinte de
 * 'media:control' que a TV ao vivo registrou e ainda não tirou.
 */
function comandoDoCelular(ipc: IpcDublado, acao: string, arg: string): void {
    const tirados = new Set(ipc.off.mock.calls.filter(c => c[0] === 'media:control').map(c => c[1]));
    const ouvintes = ipc.on.mock.calls
        .filter(c => c[0] === 'media:control' && !tirados.has(c[1]))
        .map(c => c[1] as Ouvinte);
    if (ouvintes.length === 0) throw new Error('a TV ao vivo não ouviu media:control');
    for (const ouvinte of ouvintes) ouvinte({}, acao, arg);
}

async function respostaAoCelular(ipc: IpcDublado, canal: string): Promise<unknown> {
    await esperar(() => ipc.send.mock.calls.some(c => c[0] === canal), `a resposta ${canal} ir pro celular`);
    return ipc.send.mock.calls.find(c => c[0] === canal)![1];
}

describe('D040: o controle do celular não recebe programa do passado como "agora" ou "próximo"', () => {
    it('"gravar o próximo" com a grade vencida responde erro e não agenda gravação no passado', async () => {
        const ipc = await montarTv(gradeVencida());
        const agendar = vi.spyOn(scheduledRecordingService, 'add');

        await act(async () => { comandoDoCelular(ipc, 'scheduleNext', '1'); });

        expect(await respostaAoCelular(ipc, 'web-remote:schedule-result')).toEqual({ status: 'error', title: '' });
        expect(agendar).not.toHaveBeenCalled();
    });

    it('"gravar o próximo" com programa no ar agenda o seguinte (o caso bom continua)', async () => {
        const grade = [prog('no-ar', -HORA / 2, HORA / 2), prog('seguinte', HORA / 2, HORA)];
        const ipc = await montarTv(grade);
        const agendar = vi.spyOn(scheduledRecordingService, 'add')
            .mockImplementation(entrada => ({ ...entrada, id: 'rec-1' }) as ReturnType<typeof scheduledRecordingService.add>);

        await act(async () => { comandoDoCelular(ipc, 'scheduleNext', '1'); });

        expect(await respostaAoCelular(ipc, 'web-remote:schedule-result')).toEqual({ status: 'ok', title: 'seguinte' });
        expect(agendar).toHaveBeenCalledTimes(1);
        expect(agendar.mock.calls[0][0]).toMatchObject({ title: 'seguinte', startIso: grade[1].start, endIso: grade[1].end });
    });

    it('o guia do celular (ⓘ) com a grade vencida vem vazio, sem "agora" nem "a seguir" do passado', async () => {
        const ipc = await montarTv(gradeVencida());

        await act(async () => { comandoDoCelular(ipc, 'requestEpg', '1'); });

        expect(await respostaAoCelular(ipc, 'web-remote:channel-epg')).toEqual({
            channelId: '1', now: '', nowStart: '', nowEnd: '', next: '',
        });
    });
});
