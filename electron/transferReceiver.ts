/**
 * 📥 Item 12 — receber um download do celular pela LAN (inverso do item 122,
 * que manda gravações do PC pro celular). Helpers PUROS usados pelo endpoint
 * POST /transfer do webRemoteServer; testados em transferReceiver.test.ts.
 */

export interface TransferRequest {
    pin: string
    kind: 'movie' | 'episode'
    /** Nome de arquivo já saneado (sem caminho, sem caracteres proibidos). */
    name: string
    /** Título de exibição pro registro no app (cai pro name sem extensão). */
    title: string
    /** Id do item no celular ("movie:55"/"episode:e1"), quando o app manda. */
    sourceId: string
    /** Série do episódio: sem ela a página de Downloads do PC descarta o item. */
    seriesName: string
    season: number
    episode: number
}

/** Registro persistido em disco junto do arquivo até o renderer consumir. */
export interface ReceivedTransfer {
    id: string
    kind: 'movie' | 'episode'
    title: string
    seriesName: string
    season: number
    episode: number
    filePath: string
    size: number
    receivedAt: number
}

const EXTENSION_RE = /\.[a-z0-9]{2,5}$/i
// CON/PRN/NUL/COM1… são DEVICES no Windows: createWriteStream('CON.mp4')
// escreve no console em vez de criar arquivo (e o registro fica sem mídia).
const WINDOWS_DEVICE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Remove separadores de caminho e caracteres proibidos no Windows. */
export function sanitizeTransferName(raw: string): string {
    const base = raw.replace(/^.*[\\/]/, '')
    const clean = base
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f]/g, '')
        .replace(/[<>:"/\\|?*]/g, '_')
        .trim()
        .substring(0, 200)
        // Espaço/ponto no fim: o Windows os descarta ao abrir, então "x.mp4 "
        // e "x.mp4" apontariam pro MESMO arquivo apesar de nomes diferentes.
        .replace(/[.\s]+$/, '')
    const stem = clean.replace(/\.[^.]*$/, '')
    return WINDOWS_DEVICE_RE.test(stem) ? `_${clean}` : clean
}

/**
 * Série/temporada/episódio a partir do título do celular ("Série · T1E2").
 * Resgate pros apps antigos, que só mandavam kind+name+title: o desktop
 * agrupa episódio por seriesName e some com quem não tem.
 */
export function episodeMetaFromTitle(title: string): { seriesName: string; season: number; episode: number } {
    const trimmed = title.trim()
    const tag = /(?:^|[^a-z0-9])[st](\d{1,3})\s*[ex](\d{1,4})/i.exec(trimmed)
    const head = trimmed.split(' · ')[0].trim()
    return {
        seriesName: (head || trimmed).substring(0, 200),
        season: tag ? Number(tag[1]) : 0,
        episode: tag ? Number(tag[2]) : 0,
    }
}

function positiveInt(raw: string | null): number {
    const value = Number(raw)
    return Number.isInteger(value) && value >= 0 && value < 10000 ? value : 0
}

/**
 * Valida a query do POST /transfer. null = requisição malformada (400);
 * o PIN é conferido pelo chamador (que tem o lockout por IP).
 */
export function parseTransferQuery(url: string): TransferRequest | null {
    let params: URLSearchParams
    try {
        params = new URL(url, 'http://local').searchParams
    } catch {
        return null
    }
    const pin = params.get('pin') ?? ''
    const kindRaw = params.get('kind')
    const kind = kindRaw === 'episode' ? 'episode' : kindRaw === 'movie' ? 'movie' : null
    const name = sanitizeTransferName(params.get('name') ?? '')
    if (!kind || !name || !EXTENSION_RE.test(name)) return null
    const title = (params.get('title') ?? '').trim().substring(0, 200) || name.replace(EXTENSION_RE, '')
    const sourceId = (params.get('id') ?? '').trim().substring(0, 120)
    if (kind === 'movie') return { pin, kind, name, title, sourceId, seriesName: '', season: 0, episode: 0 }
    const derived = episodeMetaFromTitle(title)
    const seriesName = (params.get('seriesName') ?? '').trim().substring(0, 200) || derived.seriesName
    const season = positiveInt(params.get('season')) || derived.season
    const episode = positiveInt(params.get('episode')) || derived.episode
    return { pin, kind, name, title, sourceId, seriesName, season, episode }
}

/**
 * Destino livre pro arquivo. Sem isto, dois envios com o mesmo nome viravam o
 * MESMO arquivo (createWriteStream trunca): a entrada antiga passava a apontar
 * pro conteúdo novo e apagar uma das duas deixava a outra sem mídia.
 */
export function uniqueTransferName(name: string, taken: (candidate: string) => boolean): string {
    if (!taken(name)) return name
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    for (let n = 2; n <= 999; n++) {
        const candidate = `${stem} (${n})${ext}`
        if (!taken(candidate)) return candidate
    }
    return `${stem} (${Date.now()})${ext}`
}

/** Teto de um envio: cobre qualquer filme e barra um corpo sem fim. */
export const MAX_TRANSFER_BYTES = 64 * 1024 ** 3
/** Folga exigida no disco além do arquivo, pra não zerar a partição. */
export const TRANSFER_DISK_HEADROOM_BYTES = 512 * 1024 * 1024

export type TransferSizeVerdict = 'ok' | 'invalid' | 'too-large' | 'no-space'

/**
 * Decide antes do pipe se o corpo cabe (413/507). Sem Content-Length não dá
 * pra prever nada — segue e o ENOSPC do stream vira 500 como antes.
 */
export function transferSizeVerdict(contentLength: string | null | undefined, freeBytes: number | null): TransferSizeVerdict {
    if (contentLength == null || contentLength === '') return 'ok'
    const size = Number(contentLength)
    if (!Number.isFinite(size) || size < 0 || !Number.isInteger(size)) return 'invalid'
    if (size > MAX_TRANSFER_BYTES) return 'too-large'
    if (freeBytes != null && Number.isFinite(freeBytes) && size + TRANSFER_DISK_HEADROOM_BYTES > freeBytes) return 'no-space'
    return 'ok'
}

/**
 * Id do registro derivado do CAMINHO (já único no disco) — registrar o mesmo
 * recebimento 2× (evento ao vivo + reconciliação de boot) vira no-op. O sufixo
 * de hash existe porque o slug sozinho colide: "Avatar (2).mp4" e
 * "Avatar-2.mp4" viram o mesmo texto e uma entrada engoliria a outra.
 */
export function transferEntryId(filePath: string): string {
    let hash = 0
    for (let i = 0; i < filePath.length; i++) hash = (Math.imul(hash, 31) + filePath.charCodeAt(i)) | 0
    const slug = filePath.replace(/^.*[\\/]/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    return `${slug || 'file'}_${(hash >>> 0).toString(36)}`
}

/** Máximo de pendências guardadas — o manifest é fila de reconciliação, não histórico. */
export const MAX_PENDING_TRANSFERS = 200

/** Lê o manifest tolerando arquivo ausente/corrompido (nunca lança). */
export function parseTransferManifest(raw: string): ReceivedTransfer[] {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return []
    }
    if (!Array.isArray(parsed)) return []
    const out: ReceivedTransfer[] = []
    for (const item of parsed) {
        const entry = (item ?? {}) as Record<string, unknown>
        if (typeof entry.id !== 'string' || !entry.id) continue
        if (typeof entry.filePath !== 'string' || !entry.filePath) continue
        out.push({
            id: entry.id,
            kind: entry.kind === 'episode' ? 'episode' : 'movie',
            title: typeof entry.title === 'string' ? entry.title : '',
            seriesName: typeof entry.seriesName === 'string' ? entry.seriesName : '',
            season: typeof entry.season === 'number' && Number.isInteger(entry.season) ? entry.season : 0,
            episode: typeof entry.episode === 'number' && Number.isInteger(entry.episode) ? entry.episode : 0,
            filePath: entry.filePath,
            size: typeof entry.size === 'number' && entry.size >= 0 ? entry.size : 0,
            receivedAt: typeof entry.receivedAt === 'number' ? entry.receivedAt : 0,
        })
    }
    return out
}

/** Acrescenta (ou substitui pelo id) mantendo o manifest limitado. */
export function appendTransferEntry(list: ReceivedTransfer[], entry: ReceivedTransfer): ReceivedTransfer[] {
    const kept = list.filter(item => item.id !== entry.id)
    kept.push(entry)
    return kept.slice(-MAX_PENDING_TRANSFERS)
}

/** Remove os ids já registrados pelo renderer. */
export function removeTransferEntries(list: ReceivedTransfer[], ids: string[]): ReceivedTransfer[] {
    const drop = new Set(ids)
    return list.filter(item => !drop.has(item.id))
}
