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
}

/** Remove separadores de caminho e caracteres proibidos no Windows. */
export function sanitizeTransferName(raw: string): string {
    const base = raw.replace(/^.*[\\/]/, '')
    return base.replace(/[<>:"/\\|?*]/g, '_').replace(/\.+$/, '').trim().substring(0, 200)
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
    if (!kind || !name || !/\.[a-z0-9]{2,5}$/i.test(name)) return null
    const title = (params.get('title') ?? '').trim() || name.replace(/\.[a-z0-9]{2,5}$/i, '')
    return { pin, kind, name, title }
}
