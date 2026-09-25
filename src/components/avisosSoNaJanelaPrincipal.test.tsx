import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DvrNotifyBridge } from './DvrNotifyBridge';
import { reminderService } from '../services/reminderService';
import { scheduledRecordingService } from '../services/scheduledRecordingService';
import { catalogRefreshService, CATALOG_REFRESH_EVENT } from '../services/catalogRefreshService';

/**
 * 📼 Com o PiP ou o multi-view aberto, os avisos chegavam em dobro (D119).
 *
 * O PiP e o multi-view abrem uma BrowserWindow que carrega o MESMO
 * `index.html`: o App sobe inteiro de novo ali dentro — pontes sempre-montadas
 * e relógios de boot incluídos. E o main manda `dvr:stopped` por BROADCAST
 * (`BrowserWindow.getAllWindows()`), então cada janela aberta virava mais uma
 * notificação nativa "Gravação concluída" e mais um espelho pro celular: duas
 * com o PiP aberto, três com PiP + mosaico. O mesmo boot duplicado armava de
 * novo, por janela:
 *
 *   - os lembretes de programa (mais um "🔔 começou" nativo, mais um no celular,
 *     mais uma contagem de sintonia automática — dentro do PiP);
 *   - as gravações agendadas (dois `fire()` correndo juntos: os dois perguntam
 *     `dvr:active`, nenhum vê o outro, e sobem DOIS ffmpeg no mesmo canal);
 *   - o relógio de refresh do catálogo, cujo `start()` zera o "último refresh"
 *     compartilhado e cujo tique, disparando no PiP, zerava de novo — cada PiP
 *     aberto adiava o refresh da janela principal.
 *
 * Estes casos rodam cada peça com o hash da janela secundária (é o que o
 * `pipHandlers` carrega: `#/pip?data=...` e `#/multiview...`) e observam o que
 * sai pro main. A janela principal (qualquer outra rota) segue avisando uma vez.
 */

type Handler = (event: unknown, ...args: unknown[]) => void;

const ouvintes = new Map<string, Set<Handler>>();
const invoke = vi.fn();

function instalarIpc(): void {
    ouvintes.clear();
    invoke.mockReset();
    invoke.mockResolvedValue({ success: true });
    // Só a propriedade: trocar o `window` inteiro derruba o jsdom do React.
    (window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
        invoke,
        send: vi.fn(),
        on: (canal: string, h: Handler) => {
            if (!ouvintes.has(canal)) ouvintes.set(canal, new Set());
            ouvintes.get(canal)!.add(h);
        },
        off: (canal: string, h: Handler) => { ouvintes.get(canal)?.delete(h); },
    };
}

/** O que o main faz em `finalizeRecording`: manda pra esta janela. */
function mainAvisaGravacaoConcluida(): void {
    const payload = { id: 'rec1', file: 'C:\\Videos\\NeoStream\\Gravacoes\\Jornal_2026-09-25.ts', seconds: 3720, code: 0 };
    act(() => { ouvintes.get('dvr:stopped')?.forEach(h => h({}, payload)); });
}

const chamadas = (canal: string) => invoke.mock.calls.filter(c => c[0] === canal);

const HASH_PIP = '#/pip?data=%7B%22name%22%3A%22Canal%22%7D';
const HASH_MOSAICO = '#/multiview?initial=7';
const HASH_PRINCIPAL = '#/dashboard/live';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    instalarIpc();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => { root.unmount(); });
    document.body.innerHTML = '';
    catalogRefreshService.stop();
    vi.useRealTimers();
    window.location.hash = '';
    localStorage.clear();
});

describe('DvrNotifyBridge: "Gravação concluída" sai só pela janela principal', () => {
    it.each([
        ['PiP', HASH_PIP],
        ['multi-view', HASH_MOSAICO],
    ])('na janela do %s o broadcast não vira notificação nem espelho no celular', (_nome, hash) => {
        window.location.hash = hash;
        act(() => { root.render(<DvrNotifyBridge />); });

        mainAvisaGravacaoConcluida();

        expect(chamadas('notify:show')).toHaveLength(0);
        expect(chamadas('web-remote:notify-mobile')).toHaveLength(0);
    });

    it('na janela principal avisa UMA vez, com o nome e a duração da gravação', () => {
        window.location.hash = HASH_PRINCIPAL;
        act(() => { root.render(<DvrNotifyBridge />); });

        mainAvisaGravacaoConcluida();

        expect(chamadas('notify:show')).toHaveLength(1);
        expect(chamadas('web-remote:notify-mobile')).toHaveLength(1);
        const aviso = chamadas('notify:show')[0][1] as { body: string; route: string };
        expect(aviso.body.includes('Jornal_2026-09-25')).toBe(true);
        expect(aviso.body.includes('1h02')).toBe(true);
        expect(aviso.route).toBe('/dashboard/downloads');
    });

    it('sem hash (boot da janela principal) também avisa', () => {
        window.location.hash = '';
        act(() => { root.render(<DvrNotifyBridge />); });

        mainAvisaGravacaoConcluida();

        expect(chamadas('notify:show')).toHaveLength(1);
    });

    it('remontar a ponte na janela principal não deixa ouvinte velho: segue UM aviso', () => {
        window.location.hash = HASH_PRINCIPAL;
        act(() => { root.render(<DvrNotifyBridge />); });
        act(() => { root.unmount(); });
        root = createRoot(container);
        act(() => { root.render(<DvrNotifyBridge />); });

        mainAvisaGravacaoConcluida();

        expect(chamadas('notify:show')).toHaveLength(1);
        expect(chamadas('web-remote:notify-mobile')).toHaveLength(1);
    });
});

describe('lembretes de programa: só a janela principal arma o timer', () => {
    const lembreteEm = (ms: number) => {
        const startIso = new Date(Date.now() + ms).toISOString();
        localStorage.setItem('program_reminders_default', JSON.stringify([{
            id: `rem_teste_${Date.parse(startIso)}`,
            channelName: 'Canal Teste',
            streamId: 7,
            title: 'Jornal da Noite',
            startIso,
        }]));
    };

    it('no PiP o boot não arma lembrete: a hora chega e nada é disparado', () => {
        // O hash antes do relógio falso: o jsdom agenda o hashchange num timer.
        window.location.hash = HASH_PIP;
        vi.useFakeTimers();
        lembreteEm(60_000);

        reminderService.scheduleAll();

        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(61_000);
        expect(chamadas('notify:show')).toHaveLength(0);
        expect(chamadas('web-remote:notify-mobile')).toHaveLength(0);
        // E não consome o lembrete que é da janela principal disparar.
        expect(reminderService.list()).toHaveLength(1);
    });

    it('na janela principal o lembrete dispara uma vez na hora do programa', () => {
        window.location.hash = HASH_PRINCIPAL;
        vi.useFakeTimers();
        lembreteEm(60_000);

        reminderService.scheduleAll();
        vi.advanceTimersByTime(61_000);

        expect(chamadas('notify:show')).toHaveLength(1);
        expect(reminderService.list()).toHaveLength(0);
    });
});

describe('gravações agendadas: só a janela principal liga o ffmpeg', () => {
    const emCurso = {
        id: 'sched_teste_1',
        channelName: 'Canal Teste',
        streamId: 7,
        title: 'Jogo',
    };
    const agendar = (extras: object[] = []) => {
        localStorage.setItem('scheduled_recordings_default', JSON.stringify([{
            ...emCurso,
            // já começou e ainda não acabou: o timer de início é 0
            startIso: new Date(Date.now() - 60_000).toISOString(),
            endIso: new Date(Date.now() + 60 * 60_000).toISOString(),
        }, ...extras]));
    };
    // Já acabou: o boot da principal confere no main se ficou ffmpeg órfão.
    const encerrado = () => ({
        id: 'sched_teste_velho',
        channelName: 'Canal Velho',
        streamId: 8,
        title: 'Reprise',
        startIso: new Date(Date.now() - 3 * 3600_000).toISOString(),
        endIso: new Date(Date.now() - 2 * 3600_000).toISOString(),
    });

    afterEach(() => {
        scheduledRecordingService.list().forEach(s => scheduledRecordingService.remove(s.id));
    });

    it('no multi-view o boot não toca na agenda: nenhum timer, nenhum dvr:active, nenhum dvr:start', async () => {
        window.location.hash = HASH_MOSAICO;
        vi.useFakeTimers();
        agendar([encerrado()]);
        const antes = localStorage.getItem('scheduled_recordings_default');

        scheduledRecordingService.init();

        expect(vi.getTimerCount()).toBe(0);
        await vi.runAllTimersAsync();
        expect(chamadas('dvr:active')).toHaveLength(0);
        expect(chamadas('dvr:start')).toHaveLength(0);
        // Nem a faxina dos encerrados: é a principal que decide o que parar.
        expect(localStorage.getItem('scheduled_recordings_default')).toBe(antes);
    });

    it('na janela principal o mesmo boot sobe a gravação', async () => {
        window.location.hash = HASH_PRINCIPAL;
        invoke.mockImplementation((canal: string) => {
            if (canal === 'dvr:active') return Promise.resolve({ success: true, recordings: [] });
            if (canal === 'streams:get-live-url') return Promise.resolve({ success: true, url: 'http://x/7.ts' });
            if (canal === 'dvr:start') return Promise.resolve({ success: true, id: 'rec-9' });
            return Promise.resolve({ success: false });
        });
        agendar();

        scheduledRecordingService.init();

        await vi.waitFor(() => expect(chamadas('dvr:start')).toHaveLength(1));
    });
});

describe('relógio de refresh do catálogo: a janela secundária não mexe no da principal', () => {
    const ULTIMO = 'neostream_catalog_last_refresh';

    it('abrir o PiP não zera o "último refresh" compartilhado — nem no boot, nem no tique', () => {
        window.location.hash = HASH_PIP;
        vi.useFakeTimers();
        localStorage.setItem(ULTIMO, '1000'); // refresh vencido faz tempo
        const refresh = vi.fn();
        window.addEventListener(CATALOG_REFRESH_EVENT, refresh);

        try {
            catalogRefreshService.start();
            expect(localStorage.getItem(ULTIMO)).toBe('1000');

            // Um tique do relógio (5 min) com o refresh vencido: na principal
            // dispararia; no PiP não pode existir relógio pra disparar.
            vi.advanceTimersByTime(5 * 60_000 + 1);
            expect(refresh).not.toHaveBeenCalled();
            expect(localStorage.getItem(ULTIMO)).toBe('1000');
        } finally {
            window.removeEventListener(CATALOG_REFRESH_EVENT, refresh);
        }
    });

    it('a janela principal marca o boot como refresh recente e mantém o relógio', () => {
        window.location.hash = HASH_PRINCIPAL;
        vi.useFakeTimers();
        localStorage.setItem(ULTIMO, '1000');

        catalogRefreshService.start();

        expect(Number(localStorage.getItem(ULTIMO))).toBeGreaterThan(1000);
        expect(vi.getTimerCount()).toBe(1);
    });
});
