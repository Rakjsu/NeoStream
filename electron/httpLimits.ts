/**
 * Teto de tamanho para corpos de resposta do provedor — puro, sem I/O.
 *
 * XMLTV e M3U eram materializados inteiros no processo principal (`.text()`)
 * antes de qualquer validação: um provedor hostil responde alguns GB em
 * streaming e estoura a heap do V8. Como o probe de XMLTV roda no boot, o app
 * entra em ciclo de crash na inicialização. Aqui o corpo é lido em pedaços com
 * corte duro, e o stream é abortado no momento em que passa do teto — o
 * download nem termina.
 */

/** Guias XMLTV de provedor grande passam de 100 MB; 200 MB dá folga. */
export const XMLTV_MAX_BYTES = 200 * 1024 * 1024
/** Listas M3U enormes (100k canais) ficam na casa das dezenas de MB. */
export const M3U_MAX_BYTES = 50 * 1024 * 1024
/** Respostas JSON pontuais (grade de um canal só). */
export const JSON_MAX_BYTES = 8 * 1024 * 1024

export class ResponseTooLargeError extends Error {
    constructor(public readonly maxBytes: number) {
        super(`Resposta do provedor acima do limite de ${maxBytes} bytes`)
        this.name = 'ResponseTooLargeError'
    }
}

/** O `Content-Length` anunciado já passa do teto? Corta antes de ler 1 byte. */
export function declaredLengthExceeds(contentLength: unknown, maxBytes: number): boolean {
    const declared = Number(contentLength)
    return Number.isFinite(declared) && declared > maxBytes
}

type BodyChunk = Uint8Array | string
type BodyStream = AsyncIterable<BodyChunk> & { destroy?: (error?: Error) => void }

/**
 * Lê o stream como texto UTF-8 abortando assim que ultrapassa `maxBytes`.
 * Lança `ResponseTooLargeError` — quem chama decide entre cache velho e erro.
 */
export async function readTextWithLimit(body: BodyStream | null | undefined, maxBytes: number): Promise<string> {
    if (!body) return ''

    const decoder = new TextDecoder('utf-8')
    let total = 0
    let text = ''

    try {
        for await (const chunk of body) {
            const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk
            total += bytes.byteLength
            if (total > maxBytes) {
                throw new ResponseTooLargeError(maxBytes)
            }
            text += decoder.decode(bytes, { stream: true })
        }
    } catch (error) {
        // Fecha a conexão: sem isto o provedor continua empurrando bytes.
        try { body.destroy?.() } catch { /* stream já fechado */ }
        throw error
    }

    return text + decoder.decode()
}

interface ResponseLike {
    headers: { get(name: string): string | null }
    body: BodyStream | null
}

/** `response.text()` com teto: checa o Content-Length e depois corta no fio. */
export async function readResponseTextWithLimit(response: ResponseLike, maxBytes: number): Promise<string> {
    if (declaredLengthExceeds(response.headers.get('content-length'), maxBytes)) {
        try { response.body?.destroy?.() } catch { /* stream já fechado */ }
        throw new ResponseTooLargeError(maxBytes)
    }

    return readTextWithLimit(response.body, maxBytes)
}
