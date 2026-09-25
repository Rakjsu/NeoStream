import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    scheduledRecordingService,
    scheduleId,
    RETRY_DELAY_MS,
    type ScheduledRecording,
} from './scheduledRecordingService';

// ─────────────────────────────────────────────────────────────────────────────
// 🔒 Regressão D065: o storage de agendamentos é POR PERFIL
// (`scheduled_recordings_<id>`) e o `init()` só lia o do perfil ATIVO. Trocar
// de perfil dá `window.location.reload()`, o renderer volta pelo perfil novo e:
//   - o agendamento feito no perfil anterior ficava sem timer — o jogo das 22h
//     simplesmente não gravava, sem aviso;
//   - uma gravação dele que já estava no ar perdia o stopTimer junto com o
//     reload, e o ffmpeg do main (que NÃO reinicia) gravava até o disco encher.
// Gravar é ação da MÁQUINA: um ffmpeg só, `dvr:active` global.
// ─────────────────────────────────────────────────────────────────────────────

const invoke = vi.fn();
const send = vi.fn();
const idsUsados = new Set<string>();

/** Folga generosa: a suíte inteira roda em paralelo e timer real atrasa. */
const ESPERA = { timeout: 5000 };

function perfis(ativo: string, ...ids: string[]) {
    localStorage.setItem('neostream_profiles', JSON.stringify({
        profiles: ids.map(id => ({ id, name: `Perfil ${id}`, avatar: '', createdAt: '', lastUsed: '' })),
        activeProfileId: ativo,
    }));
}

function agendamento(parcial: Partial<ScheduledRecording> & { startIso: string; endIso: string }): ScheduledRecording {
    const channelName = parcial.channelName ?? 'Canal Teste';
    const rec: ScheduledRecording = {
        channelName,
        streamId: parcial.streamId ?? 42,
        title: parcial.title ?? 'Programa',
        startIso: parcial.startIso,
        endIso: parcial.endIso,
        id: parcial.id ?? scheduleId(channelName, parcial.startIso),
    };
    idsUsados.add(rec.id);
    return rec;
}

function guardarNoPerfil(perfilId: string, ...recs: ScheduledRecording[]) {
    localStorage.setItem(`scheduled_recordings_${perfilId}`, JSON.stringify(recs));
}

function lerPerfil(perfilId: string): ScheduledRecording[] {
    return JSON.parse(localStorage.getItem(`scheduled_recordings_${perfilId}`) ?? '[]');
}

const chamadas = (canal: string) => invoke.mock.calls.filter(c => c[0] === canal);

/** Último total de agendamentos que o renderer mandou pro main. */
const ultimaContagem = () => send.mock.calls.filter(c => c[0] === 'dvr:schedules-changed').at(-1)?.[1];

const aPartirDeAgora = (ms: number) => new Date(Date.now() + ms).toISOString();

/** Main sem gravação nenhuma no ar, que aceita subir o ffmpeg. */
function mainLivre() {
    invoke.mockImplementation((canal: string) => {
        if (canal === 'dvr:active') return Promise.resolve({ success: true, recordings: [] });
        if (canal === 'dvr:disk-free') return Promise.resolve({ success: false });
        if (canal === 'streams:get-live-url') return Promise.resolve({ success: true, url: 'http://x/live.ts' });
        if (canal === 'dvr:start') return Promise.resolve({ success: true, id: 'rec_novo' });
        return Promise.resolve({ success: true });
    });
}

beforeEach(() => {
    localStorage.clear();
    invoke.mockReset();
    send.mockReset();
    (window as unknown as { ipcRenderer: unknown }).ipcRenderer = { invoke, send };
});

afterEach(() => {
    // Sem nenhum perfil guardando o id, remove() derruba timer e gravação.
    localStorage.clear();
    idsUsados.forEach(id => scheduledRecordingService.remove(id));
    idsUsados.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('agendamentos de outros perfis (D065)', () => {
    it('agendamento do perfil INATIVO é armado no boot e grava', async () => {
        perfis('b', 'a', 'b');
        guardarNoPerfil('a', agendamento({
            channelName: 'Canal A',
            // já começou (startDelayMs = 0) e ainda não acabou
            startIso: aPartirDeAgora(-60_000),
            endIso: aPartirDeAgora(60 * 60_000),
        }));
        mainLivre();

        scheduledRecordingService.init();

        await vi.waitFor(() => expect(chamadas('dvr:start')).toHaveLength(1), ESPERA);
        expect(chamadas('streams:get-live-url')[0][1]).toEqual({ streamId: 42 });
        // A agenda do perfil ativo continua sendo só dele.
        expect(scheduledRecordingService.list()).toEqual([]);
    });

    it('gravação órfã de agendamento ENCERRADO do outro perfil é parada no boot', async () => {
        perfis('b', 'a', 'b');
        guardarNoPerfil('a', agendamento({
            id: 'sched_orfao_a',
            channelName: 'Canal A',
            title: 'Show',
            startIso: aPartirDeAgora(-7200_000),
            endIso: aPartirDeAgora(-60_000),
        }));
        invoke.mockImplementation((canal: string) => {
            if (canal === 'dvr:active') {
                return Promise.resolve({
                    success: true,
                    recordings: [{ id: 'rec_orfao_a', channelName: 'Show (Canal A)' }],
                });
            }
            return Promise.resolve({ success: true });
        });

        scheduledRecordingService.init();

        await vi.waitFor(() => expect(chamadas('dvr:stop')).toHaveLength(1), ESPERA);
        expect(chamadas('dvr:stop')[0][1]).toEqual({ id: 'rec_orfao_a' });
        // e o agendamento morto sai da agenda do DONO
        expect(lerPerfil('a')).toEqual([]);
    });

    it('mesmo programa vencido num perfil e vivo noutro: o boot NÃO para a gravação que o vivo quer', async () => {
        // O id é canal + início; o fim pode divergir (a EPG corrigiu o horário
        // depois que um dos perfis agendou). Parar "o órfão" do perfil A
        // derrubaria o ffmpeg que o perfil B ainda está usando.
        perfis('b', 'a', 'b');
        const inicio = aPartirDeAgora(-7200_000);
        guardarNoPerfil('a', agendamento({ channelName: 'Canal X', title: 'Show', startIso: inicio, endIso: aPartirDeAgora(-60_000) }));
        guardarNoPerfil('b', agendamento({ channelName: 'Canal X', title: 'Show', startIso: inicio, endIso: aPartirDeAgora(60 * 60_000) }));
        invoke.mockImplementation((canal: string) => {
            if (canal === 'dvr:active') {
                return Promise.resolve({ success: true, recordings: [{ id: 'rec_vivo', channelName: 'Show (Canal X)' }] });
            }
            return Promise.resolve({ success: true });
        });

        scheduledRecordingService.init();

        // "Parar o órfão" pergunta ao main na hora, dentro do init; o vivo só
        // pergunta quando o timer dele dispara.
        expect(chamadas('dvr:active')).toHaveLength(0);
        await vi.waitFor(() => expect(chamadas('dvr:active')).toHaveLength(1), ESPERA);
        // Adotou a gravação que já estava no ar: nem para, nem sobe outra.
        expect(chamadas('dvr:stop')).toHaveLength(0);
        expect(chamadas('dvr:start')).toHaveLength(0);
        expect(lerPerfil('a')).toEqual([]);
        expect(lerPerfil('b')).toHaveLength(1);
    });

    it('gravação do outro perfil é encerrada no fim e sai da agenda DELE, não da do ativo', async () => {
        localStorage.setItem('neostream_dvr_start_margin_min', '0');
        localStorage.setItem('neostream_dvr_end_padding_min', '0');
        perfis('b', 'a', 'b');
        const doA = agendamento({
            channelName: 'Canal A',
            startIso: aPartirDeAgora(-60_000),
            endIso: aPartirDeAgora(150),
        });
        const doB = agendamento({
            channelName: 'Canal B',
            startIso: aPartirDeAgora(60 * 60_000),
            endIso: aPartirDeAgora(120 * 60_000),
        });
        guardarNoPerfil('a', doA);
        guardarNoPerfil('b', doB);
        mainLivre();
        const aoMudar = vi.fn();
        const sair = scheduledRecordingService.subscribe(aoMudar);

        try {
            scheduledRecordingService.init();

            await vi.waitFor(() => expect(chamadas('dvr:stop')).toHaveLength(1), ESPERA);
            expect(chamadas('dvr:stop')[0][1]).toEqual({ id: 'rec_novo' });
            await vi.waitFor(() => expect(lerPerfil('a')).toEqual([]), ESPERA);
            expect(scheduledRecordingService.list().map(s => s.id)).toEqual([doB.id]);
            // Quem mostra a agenda (EpgGuide) é avisado, com a agenda do ATIVO.
            expect(aoMudar).toHaveBeenLastCalledWith([doB]);
            expect(ultimaContagem()).toBe(1);
        } finally {
            sair();
        }
    });

    it('o main recebe o total pendente da MÁQUINA, sem contar duas vezes o programa que dois perfis agendaram', () => {
        perfis('b', 'a', 'b');
        const futuro = (canal: string) => agendamento({
            channelName: canal,
            startIso: aPartirDeAgora(60 * 60_000),
            endIso: aPartirDeAgora(120 * 60_000),
        });
        const comum = futuro('Canal Comum');
        const doB = futuro('Canal B');
        guardarNoPerfil('a', futuro('Canal A1'), futuro('Canal A2'), comum);
        guardarNoPerfil('b', doB, comum);
        mainLivre();

        scheduledRecordingService.init();

        // É esse número que segura o app na bandeja ao fechar a janela.
        expect(ultimaContagem()).toBe(4);

        // Mexer na agenda do ativo manda o total da máquina, não o do perfil.
        scheduledRecordingService.remove(doB.id);
        expect(ultimaContagem()).toBe(3);
        scheduledRecordingService.remove(comum.id);
        expect(ultimaContagem()).toBe(3);
        expect(lerPerfil('b')).toEqual([]);
    });

    it('cancelar na agenda do perfil ativo NÃO cancela o mesmo programa agendado em outro perfil', async () => {
        localStorage.setItem('neostream_dvr_start_margin_min', '0');
        perfis('b', 'a', 'b');
        const programa = {
            channelName: 'Canal Comum',
            startIso: aPartirDeAgora(150),
            endIso: aPartirDeAgora(60 * 60_000),
        };
        // O id é canal + início, não perfil: os dois perfis geram o MESMO id.
        guardarNoPerfil('a', agendamento(programa));
        guardarNoPerfil('b', agendamento(programa));
        mainLivre();

        scheduledRecordingService.init();
        scheduledRecordingService.remove(scheduleId(programa.channelName, programa.startIso));

        expect(scheduledRecordingService.list()).toEqual([]);
        expect(lerPerfil('a')).toHaveLength(1);
        // O perfil A ainda quer o programa: a gravação sai na hora dela.
        await vi.waitFor(() => expect(chamadas('dvr:start')).toHaveLength(1), ESPERA);
    });

    it('perfil APAGADO não grava: ninguém mais veria nem cancelaria o agendamento', async () => {
        // `deleteProfile` não limpa os dados do perfil; a chave fica lá.
        perfis('b', 'b');
        guardarNoPerfil('apagado', agendamento({
            channelName: 'Canal Fantasma',
            startIso: aPartirDeAgora(-60_000),
            endIso: aPartirDeAgora(60 * 60_000),
        }));
        guardarNoPerfil('b', agendamento({
            channelName: 'Canal B',
            startIso: aPartirDeAgora(-60_000),
            endIso: aPartirDeAgora(60 * 60_000),
        }));
        mainLivre();

        scheduledRecordingService.init();

        // Espera a CONDIÇÃO do agendamento vivo; o fantasma teria subido junto.
        await vi.waitFor(() => expect(chamadas('dvr:start')).toHaveLength(1), ESPERA);
        expect(chamadas('dvr:start')[0][1]).toMatchObject({ channelName: 'Programa (Canal B)' });
        // Os dois timers (delay 0) disparariam no mesmo tique, e o fire() começa
        // pelo `dvr:active`: se o fantasma estivesse armado, já teria perguntado.
        expect(chamadas('dvr:active')).toHaveLength(1);
        expect(lerPerfil('apagado')).toHaveLength(1);
    });
});

describe('desistência de agendamento do outro perfil (D065)', () => {
    it('re-tentativa que chega com o programa já encerrado tira o item da agenda do DONO', async () => {
        vi.useFakeTimers();
        const erroNoConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
        perfis('b', 'a', 'b');
        guardarNoPerfil('a', agendamento({
            channelName: 'Canal A',
            startIso: aPartirDeAgora(-60_000),
            endIso: aPartirDeAgora(10_000),
        }));
        invoke.mockImplementation((canal: string) => {
            if (canal === 'dvr:active') return Promise.resolve({ success: true, recordings: [] });
            if (canal === 'dvr:disk-free') return Promise.resolve({ success: false });
            if (canal === 'streams:get-live-url') return Promise.resolve({ success: false, error: 'provedor fora' });
            return Promise.resolve({ success: true });
        });

        scheduledRecordingService.init();

        // 1ª tentativa falha com o programa ainda no ar → re-tenta em 30s.
        await vi.waitFor(() => expect(erroNoConsole).toHaveBeenCalled(), ESPERA);
        expect(lerPerfil('a')).toHaveLength(1);
        vi.advanceTimersByTime(RETRY_DELAY_MS);

        // Na volta o programa acabou: sai da agenda de A e da conta do main.
        await vi.waitFor(() => expect(lerPerfil('a')).toEqual([]), ESPERA);
        expect(ultimaContagem()).toBe(0);
    });

    it('falha que termina depois do fim do programa tira o item da agenda do DONO', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        perfis('b', 'a', 'b');
        guardarNoPerfil('a', agendamento({
            channelName: 'Canal A',
            startIso: aPartirDeAgora(-60_000),
            endIso: aPartirDeAgora(10_000),
        }));
        invoke.mockImplementation((canal: string) => {
            if (canal === 'dvr:active') return Promise.resolve({ success: true, recordings: [] });
            if (canal === 'dvr:disk-free') return Promise.resolve({ success: false });
            if (canal === 'streams:get-live-url') return Promise.resolve({ success: true, url: 'http://x/live.ts' });
            if (canal === 'dvr:start') {
                // O main demorou a responder e o programa acabou nesse meio-tempo.
                vi.setSystemTime(Date.now() + 60_000);
                return Promise.resolve({ success: false, error: 'ffmpeg não subiu' });
            }
            return Promise.resolve({ success: true });
        });

        scheduledRecordingService.init();

        await vi.waitFor(() => expect(lerPerfil('a')).toEqual([]), ESPERA);
        expect(chamadas('dvr:start')).toHaveLength(1);
        expect(ultimaContagem()).toBe(0);
    });
});
