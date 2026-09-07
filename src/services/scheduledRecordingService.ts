// Scheduled DVR recordings
// Pick a FUTURE program in the EPG guide and have the live stream recorded
// automatically (dvr:start at program start, dvr:stop at its end), while the
// app is running. Mirrors reminderService: per-profile localStorage +
// setTimeout timers rehydrated on boot.

import { profileService } from './profileService';
import { appNotificationService } from './episodeNotificationService';
import { computeDelay } from './reminderService';
import { espacoParaGravacao } from './dvrSweep';
import { languageService } from './languageService';

export interface ScheduledRecording {
    /** Deterministic id derived from channel + program start (see scheduleId). */
    id: string;
    channelName: string;
    streamId: number;
    title: string;
    /** Program start/end in ISO-8601. */
    startIso: string;
    endIso: string;
}

const STORAGE_KEY_PREFIX = 'scheduled_recordings';

/** Margem inicial: liga 2min ANTES do início anunciado — PADRÃO. */
export const START_MARGIN_MS = 2 * 60 * 1000;

/**
 * Minutos gravados a mais no fim (créditos, atraso do provedor) — PADRÃO.
 * O valor efetivo vem de `folgaFinalMs()`, que lê a preferência do usuário.
 */
export const END_PADDING_MS = 2 * 60 * 1000;

/** Teto de sanidade das margens: 30 min de cada lado já é muito. */
export const MARGEM_MAXIMA_MIN = 30;

/**
 * Minutos gravados a mais, em ms, com o padrão quando não há preferência.
 *
 * Lê a string CRUA antes de converter: `Number(null)` é 0 e passa em qualquer
 * checagem de finitude, então converter primeiro tornaria "nunca configurei"
 * indistinguível de "configurei zero" — e todo mundo perderia as margens em
 * silêncio, na primeira gravação depois da atualização.
 */
function margemConfigurada(chave: string, padraoMs: number): number {
    try {
        const bruto = localStorage.getItem(chave);
        if (bruto === null || bruto.trim() === '') return padraoMs;
        const minutos = Number(bruto);
        if (!Number.isFinite(minutos) || minutos < 0) return padraoMs;
        return Math.min(minutos, MARGEM_MAXIMA_MIN) * 60 * 1000;
    } catch {
        return padraoMs;
    }
}

/** Folga no fim (ms). Zero é escolha válida e é respeitada. */
export function folgaFinalMs(): number {
    return margemConfigurada('neostream_dvr_end_padding_min', END_PADDING_MS);
}

/** Margem no início (ms). Zero é escolha válida e é respeitada. */
export function margemInicialMs(): number {
    return margemConfigurada('neostream_dvr_start_margin_min', START_MARGIN_MS);
}

/** Espera antes de re-tentar (fila de simultâneas e falha transitória no início). */
export const RETRY_DELAY_MS = 30_000;

/** Resposta do canal `dvr:active` (gravações em curso no main). */
interface DvrActiveResponse {
    success?: boolean;
    recordings?: Array<{ id: string; channelName?: string }>;
}

/** Delay até ligar a gravação — início anunciado menos a margem (clamp 0). */
export function startDelayMs(startIso: string, nowMs: number): number {
    return Math.max(0, computeDelay(startIso, nowMs) - margemInicialMs());
}

/** Limite de gravações simultâneas (1–4; padrão 2) — excedente entra em fila. */
export function getDvrMaxConcurrent(): number {
    try {
        const parsed = Number(localStorage.getItem('neostream_dvr_max_concurrent'));
        if (!Number.isFinite(parsed) || parsed <= 0) return 2;
        return Math.max(1, Math.min(4, Math.round(parsed)));
    } catch {
        return 2;
    }
}

/** Janela que o ffmpeg fica de fato ligado: margem antes + folga depois. */
export function janelaGravacao(
    rec: { startIso: string; endIso: string },
    margens?: { inicioMs: number; fimMs: number }
): { ini: number; fim: number } | null {
    const ini = Date.parse(rec.startIso);
    const fim = Date.parse(rec.endIso);
    if (!Number.isFinite(ini) || !Number.isFinite(fim) || fim <= ini) return null;
    // As margens chegam por parâmetro no caminho quente (o laço de conflito lê
    // o storage UMA vez, não uma por par de agendamentos).
    const inicioMs = margens?.inicioMs ?? margemInicialMs();
    const fimMs = margens?.fimMs ?? folgaFinalMs();
    return { ini: ini - inicioMs, fim: fim + fimMs };
}

/**
 * Agendamentos que disputam a vaga com o candidato — vazio quando ele cabe.
 *
 * Sem isto, agendar a 3a gravacao sobreposta (com limite 2) era aceito na cara
 * do usuario e depois falhava SOZINHA: o `fire` via a fila cheia, re-tentava a
 * cada 30s e desistia quando o programa acabava. Nenhum aviso, nenhum arquivo.
 *
 * A conta usa a janela REAL (com as margens): dois programas colados no mesmo
 * canal se sobrepoem por 4 minutos que ninguem ve na grade.
 */
export function conflitosDoAgendamento(
    candidato: { id?: string; startIso: string; endIso: string },
    existentes: ScheduledRecording[],
    limite: number = getDvrMaxConcurrent()
): ScheduledRecording[] {
    // Uma leitura de storage para o cálculo inteiro.
    const margens = { inicioMs: margemInicialMs(), fimMs: folgaFinalMs() };
    const alvo = janelaGravacao(candidato, margens);
    if (!alvo) return [];

    const concorrentes = existentes
        .filter(rec => rec.id !== candidato.id)
        .map(rec => ({ rec, janela: janelaGravacao(rec, margens) }))
        .filter((item): item is { rec: ScheduledRecording; janela: { ini: number; fim: number } } =>
            item.janela !== null && item.janela.ini < alvo.fim && item.janela.fim > alvo.ini);

    if (concorrentes.length < limite) return [];

    // O pico so pode acontecer no inicio da janela do candidato ou no inicio de
    // uma das concorrentes: e onde alguem ENTRA no ar.
    const instantes = [alvo.ini, ...concorrentes
        .map(c => c.janela.ini)
        .filter(ini => ini >= alvo.ini && ini < alvo.fim)];

    let pico: ScheduledRecording[] = [];
    for (const instante of instantes) {
        const noAr = concorrentes
            .filter(c => c.janela.ini <= instante && c.janela.fim > instante)
            .map(c => c.rec);
        if (noAr.length > pico.length) pico = noAr;
    }
    return pico.length >= limite ? pico : [];
}

/** Deterministic id for a (channel, program start) pair — djb2 hash, hex. */
export function scheduleId(channelKey: string, startIso: string): string {
    const input = `${channelKey}|${startIso}`;
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
    }
    return `sched_${hash.toString(16)}_${Date.parse(startIso) || 0}`;
}

/** A schedule is dead once the program END has passed (no point starting). */
export function isScheduleExpired(endIso: string, nowMs: number): boolean {
    const endMs = Date.parse(endIso);
    if (Number.isNaN(endMs)) return true;
    return endMs < nowMs;
}

type ScheduleCallback = (schedules: ScheduledRecording[]) => void;

class ScheduledRecordingService {
    private startTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private stopTimers = new Map<string, ReturnType<typeof setTimeout>>();
    /** Live DVR recording ids for schedules currently recording. */
    private activeRecIds = new Map<string, string>();
    private listeners: ScheduleCallback[] = [];

    private getStorageKey(): string {
        const activeProfile = profileService.getActiveProfile();
        return `${STORAGE_KEY_PREFIX}_${activeProfile?.id ?? 'default'}`;
    }

    list(): ScheduledRecording[] {
        try {
            const data = localStorage.getItem(this.getStorageKey());
            if (!data) return [];
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    private save(schedules: ScheduledRecording[]): void {
        try {
            localStorage.setItem(this.getStorageKey(), JSON.stringify(schedules));
        } catch { /* best-effort */ }
        this.listeners.forEach(cb => cb(schedules));
        this.pushCountToMain(schedules.length);
    }

    /** Mirror the pending count into main so closing the window can hold the app. */
    private pushCountToMain(count: number): void {
        try {
            window.ipcRenderer?.send('dvr:schedules-changed', count);
        } catch { /* jsdom/tests sem preload */ }
    }

    subscribe(cb: ScheduleCallback): () => void {
        this.listeners.push(cb);
        return () => { this.listeners = this.listeners.filter(l => l !== cb); };
    }

    add(input: Omit<ScheduledRecording, 'id'>): ScheduledRecording {
        const rec: ScheduledRecording = { ...input, id: scheduleId(input.channelName, input.startIso) };
        const all = this.list().filter(s => s.id !== rec.id);
        all.push(rec);
        this.save(all);
        this.arm(rec);
        return rec;
    }

    remove(id: string): void {
        this.save(this.list().filter(s => s.id !== id));
        const startTimer = this.startTimers.get(id);
        if (startTimer) { clearTimeout(startTimer); this.startTimers.delete(id); }
        const stopTimer = this.stopTimers.get(id);
        if (stopTimer) { clearTimeout(stopTimer); this.stopTimers.delete(id); }
        // Recording already in flight → stop it now.
        const recId = this.activeRecIds.get(id);
        if (recId) {
            this.activeRecIds.delete(id);
            void window.ipcRenderer.invoke('dvr:stop', { id: recId });
        }
    }

    /** Rehydrate timers on boot; prune schedules whose program already ended. */
    init(): void {
        const all = this.list();
        const now = Date.now();
        const alive = all.filter(s => !isScheduleExpired(s.endIso, now));
        const encerrados = all.filter(s => isScheduleExpired(s.endIso, now));
        if (alive.length !== all.length) this.save(alive);
        // Um agendamento já encerrado ainda pode ter gravação VIVA no main: se o
        // renderer recarregou dentro da janela do END_PADDING, o stopTimer morreu
        // junto e o ffmpeg ficou sem ninguém pra parar. Encerra antes de
        // descartar — senão grava até o disco encher.
        encerrados.forEach(rec => void this.stopOrphanRecording(rec));
        alive.forEach(s => this.arm(s));
        this.pushCountToMain(alive.length);
    }

    /** Encerra no main uma gravação deste agendamento que tenha ficado órfã. */
    private async stopOrphanRecording(rec: ScheduledRecording): Promise<void> {
        const recId = await this.findActiveRecording(rec);
        if (!recId) return;
        try {
            await window.ipcRenderer?.invoke('dvr:stop', { id: recId });
        } catch { /* best-effort: o usuário ainda pode parar em Downloads → Gravações */ }
    }

    private arm(rec: ScheduledRecording): void {
        const existing = this.startTimers.get(rec.id);
        if (existing) clearTimeout(existing);
        const delay = startDelayMs(rec.startIso, Date.now());
        this.startTimers.set(rec.id, setTimeout(() => {
            this.startTimers.delete(rec.id);
            void this.fire(rec);
        }, delay));
    }

    private async fire(rec: ScheduledRecording): Promise<void> {
        // 🔁 Reconciliação com o main — PRIMEIRA coisa, antes de qualquer guard.
        // O renderer recarrega em vários fluxos normais (trocar/remover a
        // playlist ativa, concluir o login, Ctrl+R) e perde os timers; o main
        // NÃO reinicia e o ffmpeg segue gravando. Sem esta checagem o boot
        // re-arma o agendamento, startDelayMs dá 0 pra programa já iniciado e
        // sobe um SEGUNDO ffmpeg no mesmo canal: duas conexões no provedor
        // (conta de 1 conexão derruba tudo) e, como o nome do arquivo tem
        // precisão de minuto e o ffmpeg roda com -y, o segundo TRUNCA o arquivo
        // que o primeiro está escrevendo.
        // Vem antes dos guards de propósito: sair por "expirado" ou "fila cheia"
        // sem adotar deixaria a gravação existente órfã, sem ninguém pra parar.
        const alreadyRecording = await this.findActiveRecording(rec);
        if (alreadyRecording) {
            this.activeRecIds.set(rec.id, alreadyRecording);
            this.armStop(rec);
            return;
        }

        // Program already over (slept laptop, long downtime) → drop silently.
        if (isScheduleExpired(rec.endIso, Date.now())) {
            this.save(this.list().filter(s => s.id !== rec.id));
            return;
        }
        // 🚦 Fila: com o limite de gravações simultâneas atingido, re-tenta a
        // cada 30s até abrir vaga (ou o programa acabar e cair no guard acima).
        if (this.activeRecIds.size >= getDvrMaxConcurrent()) {
            this.startTimers.set(rec.id, setTimeout(() => {
                this.startTimers.delete(rec.id);
                void this.fire(rec);
            }, RETRY_DELAY_MS));
            return;
        }

        try {
            // 💾 Pré-voo de espaço. Só o REC manual perguntava — o agendado, que
            // é o caminho que grava sozinho de madrugada, ia direto pro
            // `dvr:start`. E disco cheio no meio não falha em silêncio: falha
            // MENTINDO, porque o `dvr:stopped` sai sem campo `error` e os
            // consumidores anunciam "Gravação concluída" pra um arquivo
            // truncado.
            const espaco = await this.conferirEspaco(rec);
            if (espaco && !espaco.cabe) {
                appNotificationService.addNotification({
                    type: 'dvr_recording',
                    title: languageService.t('notifications', 'dvrNoSpaceTitle'),
                    message: `${rec.title} — ${languageService.t('notifications', 'dvrNoSpaceBody')} (${(espaco.faltamBytes / 1e9).toFixed(1)} GB)`
                });
                // Sem re-tentar: o disco não se esvazia sozinho às 3h da manhã,
                // e insistir a cada 30s só enche a fila de notificação.
                this.startTimers.delete(rec.id);
                return;
            }

            const urlResult = await window.ipcRenderer.invoke('streams:get-live-url', { streamId: rec.streamId });
            if (!urlResult?.success || !urlResult.url) throw new Error(urlResult?.error || 'sem URL');

            const started = await window.ipcRenderer.invoke('dvr:start', {
                url: urlResult.url,
                channelName: this.recordingLabel(rec)
            });
            if (!started?.success) throw new Error(started?.error || 'dvr:start falhou');

            this.activeRecIds.set(rec.id, started.id);
            appNotificationService.addNotification({
                type: 'dvr_recording',
                title: '⏺ Gravação iniciada',
                message: `${rec.title} — ${rec.channelName}`
            });

            // Stop when the program ends (+ padding for credits/delays).
            this.armStop(rec);
        } catch (err) {
            console.error('[DVR] scheduled recording failed:', err);
            // Falha transitória no início (rede oscilando, provedor lento) não
            // pode matar o agendamento: re-tenta enquanto o programa não acabar,
            // mesmo backoff da fila de simultâneas. Só desiste — e avisa — quando
            // não há mais o que gravar.
            if (!isScheduleExpired(rec.endIso, Date.now())) {
                this.startTimers.set(rec.id, setTimeout(() => {
                    this.startTimers.delete(rec.id);
                    void this.fire(rec);
                }, RETRY_DELAY_MS));
                return;
            }
            this.save(this.list().filter(s => s.id !== rec.id));
            appNotificationService.addNotification({
                type: 'dvr_recording',
                title: '⚠️ Falha na gravação agendada',
                message: `${rec.title} — ${rec.channelName}`
            });
        }
    }

    /** Rótulo passado ao dvr:start — é a chave que identifica a gravação no main. */
    private recordingLabel(rec: ScheduledRecording): string {
        return `${rec.title} (${rec.channelName})`;
    }

    /** Id da gravação deste agendamento que já esteja rodando no main, se houver. */
    private async findActiveRecording(rec: ScheduledRecording): Promise<string | null> {
        try {
            const res = await window.ipcRenderer?.invoke('dvr:active') as DvrActiveResponse | undefined;
            if (!res?.success || !Array.isArray(res.recordings)) return null;
            const label = this.recordingLabel(rec);
            return res.recordings.find(r => r.channelName === label)?.id ?? null;
        } catch {
            return null; // sem preload (testes) ou main indisponível → segue o fluxo normal
        }
    }

    /** Agenda o encerramento no fim do programa (+ padding). Idempotente. */
    /**
     * Espaço livre contra o tamanho estimado da gravação. `null` quando não dá
     * pra saber (main sem o canal, janela inválida) — e aí grava, porque
     * recusar no escuro perderia a gravação por um palpite.
     */
    private async conferirEspaco(rec: ScheduledRecording) {
        const livre = await window.ipcRenderer.invoke('dvr:disk-free')
            .catch(() => null) as { success?: boolean; freeBytes?: number } | null;
        if (!livre?.success || typeof livre.freeBytes !== 'number') return null;
        const janela = janelaGravacao(rec);
        if (!janela) return null;
        return espacoParaGravacao(livre.freeBytes, janela.fim - janela.ini);
    }

    private armStop(rec: ScheduledRecording): void {
        const existing = this.stopTimers.get(rec.id);
        if (existing) clearTimeout(existing);
        const stopDelay = computeDelay(rec.endIso, Date.now()) + folgaFinalMs();
        this.stopTimers.set(rec.id, setTimeout(async () => {
            this.stopTimers.delete(rec.id);
            const recId = this.activeRecIds.get(rec.id);
            this.activeRecIds.delete(rec.id);
            if (recId) await window.ipcRenderer.invoke('dvr:stop', { id: recId });
            this.save(this.list().filter(s => s.id !== rec.id));
            appNotificationService.addNotification({
                type: 'dvr_recording',
                title: '⏺ Gravação concluída',
                message: `${rec.title} — ${rec.channelName}`
            });
        }, stopDelay));
    }
}

export const scheduledRecordingService = new ScheduledRecordingService();
