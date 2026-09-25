/**
 * 📺 Guia da TV ao vivo que a LiveTV empurra pro controle web do celular —
 * parte PURA (testável; o webRemoteServer importa 'electron' e não roda em
 * unit test). O servidor só guarda o resultado e o repassa aos clientes.
 */

/**
 * Teto de canais que vão pro celular. A LiveTV manda a lista filtrada INTEIRA
 * (com "Todos" de um provedor grande, milhares); a página renderiza tudo de
 * uma vez, então o corte fica. O que não pode é cortar calado (D105): o
 * `total` viaja junto e a página avisa "mostrando N de M — use a busca do
 * topo", que vai ao renderer com a lista completa.
 */
export const GUIDE_MAX_CHANNELS = 600

export interface GuideChannel {
    id: string
    name: string
    logo: string
    /** Número do canal (zap por número na página). */
    num?: number
}
export interface GuideEpg {
    now: string
    nowStart: string
    nowEnd: string
    next: string
}
export interface GuideState {
    channels: GuideChannel[]
    playingId: string
    epg: GuideEpg | null
    /** Canais válidos que a LiveTV mandou, ANTES do corte em GUIDE_MAX_CHANNELS. */
    total: number
}

/** Mesmo critério do filtro antigo: id e nome não vazios. */
function isValidChannel(c: unknown): boolean {
    const ch = (c ?? {}) as Record<string, unknown>
    return String(ch.id ?? '') !== '' && typeof ch.name === 'string' && ch.name !== ''
}

function sanitizeChannel(c: unknown): GuideChannel {
    const ch = (c ?? {}) as Record<string, unknown>
    return {
        id: String(ch.id ?? ''),
        name: String(ch.name).slice(0, 160),
        logo: typeof ch.logo === 'string' ? ch.logo.slice(0, 500) : '',
        num: Number(ch.num) > 0 ? Number(ch.num) : undefined,
    }
}

/** Sanitize the untrusted guide payload coming from the renderer. */
export function sanitizeGuide(raw: unknown): GuideState {
    const obj = (raw ?? {}) as Record<string, unknown>
    const rawChannels: unknown[] = Array.isArray(obj.channels) ? obj.channels : []
    // Valida ANTES de cortar: uma entrada inválida não rouba vaga dos 600 e
    // não conta no total (senão "mostrando 598 de 600" sem corte nenhum).
    const channels: GuideChannel[] = []
    let total = 0
    // Depois do teto só CONTA, sem montar objeto: "Todos" pode ter dezenas de
    // milhares de canais.
    for (const c of rawChannels) {
        if (!isValidChannel(c)) continue
        total++
        if (channels.length < GUIDE_MAX_CHANNELS) channels.push(sanitizeChannel(c))
    }
    const rawEpg = obj.epg as Record<string, unknown> | null | undefined
    const epg: GuideEpg | null = rawEpg && typeof rawEpg === 'object'
        ? {
            now: typeof rawEpg.now === 'string' ? rawEpg.now.slice(0, 200) : '',
            nowStart: typeof rawEpg.nowStart === 'string' ? rawEpg.nowStart : '',
            nowEnd: typeof rawEpg.nowEnd === 'string' ? rawEpg.nowEnd : '',
            next: typeof rawEpg.next === 'string' ? rawEpg.next.slice(0, 200) : '',
        }
        : null
    return { channels, playingId: String(obj.playingId ?? ''), epg, total }
}

/** Mensagem `guide` que o servidor manda a cada cliente (null = guia vazia). */
export function buildGuideMessage(state: GuideState | null): string {
    return JSON.stringify({ type: 'guide', ...(state ?? { channels: [], playingId: '', epg: null, total: 0 }) })
}
