/**
 * Cache de EPG por canal + limitador de concorrência, compartilhados entre o
 * Guia (que busca as linhas que estão na tela) e a varredura em segundo plano
 * das regras de gravação e dos alertas por palavra-chave.
 *
 * Morava dentro de pages/EpgGuide.tsx. Saiu de lá porque a varredura precisa
 * do MESMO cache (o que ela buscou o guia já mostra sem pedir de novo, e
 * vice-versa) e do MESMO teto de 4 buscas simultâneas — duas filas separadas
 * dobrariam a carga sobre o provedor e as fontes públicas.
 */
import { epgService } from './epgService';

export interface GuiaEpgProgram {
    id: string;
    start: string;
    end: string;
    title: string;
    description?: string;
    category?: string;
    channel_id: string;
}

/** O mínimo de um canal ao vivo que a busca de EPG precisa. */
export interface GuiaEpgCanal {
    name: string;
    epg_channel_id: string;
    stream_id: number;
}

export const MAX_CONCURRENT_EPG = 4;

interface Entrada {
    programs: GuiaEpgProgram[];
    /** Quando a busca resolveu (Date.now()). */
    at: number;
}

const epgCache = new Map<string, Entrada>();
const epgPending = new Map<string, Promise<GuiaEpgProgram[]>>();
let epgInFlight = 0;
const epgWaiters: Array<() => void> = [];

async function acquireEpgSlot(): Promise<void> {
    if (epgInFlight >= MAX_CONCURRENT_EPG) {
        await new Promise<void>(resolve => epgWaiters.push(resolve));
    }
    epgInFlight++;
}

function releaseEpgSlot(): void {
    epgInFlight--;
    const next = epgWaiters.shift();
    if (next) next();
}

/** Programas já em cache para o canal (sem buscar nada). */
export function epgEmCache(channelName: string): GuiaEpgProgram[] | undefined {
    return epgCache.get(channelName)?.programs;
}

/** Cópia do cache inteiro (nome do canal → programas), para a busca do guia. */
export function snapshotEpgCache(): Map<string, GuiaEpgProgram[]> {
    const out = new Map<string, GuiaEpgProgram[]>();
    for (const [name, entrada] of epgCache) out.set(name, entrada.programs);
    return out;
}

/**
 * EPG de um canal: do cache quando existe (e, com `maxAgeMs`, quando ainda é
 * recente), senão uma busca que passa pelo limitador. Pedidos simultâneos do
 * mesmo canal compartilham a mesma promessa.
 */
export function loadChannelEpg(
    channel: GuiaEpgCanal,
    opts: { maxAgeMs?: number } = {}
): Promise<GuiaEpgProgram[]> {
    const key = channel.name;
    const cached = epgCache.get(key);
    if (cached && (opts.maxAgeMs === undefined || Date.now() - cached.at <= opts.maxAgeMs)) {
        return Promise.resolve(cached.programs);
    }

    let pending = epgPending.get(key);
    if (!pending) {
        pending = (async () => {
            await acquireEpgSlot();
            try {
                const programs = await epgService.fetchChannelEPG(channel.epg_channel_id || '', channel.name, channel.stream_id);
                epgCache.set(key, { programs, at: Date.now() });
                return programs;
            } catch {
                epgCache.set(key, { programs: [], at: Date.now() });
                return [];
            } finally {
                releaseEpgSlot();
                epgPending.delete(key);
            }
        })();
        epgPending.set(key, pending);
    }
    return pending;
}

/** Só para testes: esvazia cache e fila. */
export function _resetGuiaEpgCacheParaTeste(): void {
    epgCache.clear();
    epgPending.clear();
    epgInFlight = 0;
    epgWaiters.length = 0;
}
