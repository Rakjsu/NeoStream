/**
 * 📺 Índice de XMLTV — parsing PURO, feito UMA vez por arquivo.
 *
 * O caminho antigo lia o XMLTV inteiro do disco a cada chamada, mandava a
 * string completa pro renderer por IPC, e lá rodava um regex global sobre o
 * documento todo só pra achar UM canal. Isso acontecia a cada troca de canal
 * E de novo a cada 60 segundos: com o guia dos EUA (297 mil blocos de
 * programa em 10 arquivos) davam centenas de MB alocados e até 2 s de thread
 * travada por zap.
 *
 * Aqui o documento vira índice — `canal -> programas` e `nome -> id` — de uma
 * vez só. Quem pergunta recebe apenas os programas do canal pedido.
 *
 * Este arquivo é PURO de propósito (sem `fs`, sem `electron`): é o que o torna
 * testável sem montar um app.
 */

/** Mesmo formato que o renderer já consome — nada muda do outro lado. */
export interface XmltvProgram {
    id: string
    start: string
    end: string
    title: string
    description?: string
    category?: string
    channel_id: string
}

export interface XmltvIndex {
    /** `channel id` do XMLTV -> programas, em ordem de início. */
    byChannel: Map<string, XmltvProgram[]>
    /** `display-name` normalizado -> `channel id`. */
    nameToId: Map<string, string>
    /** Quantos blocos `<programme>` o documento tinha (diagnóstico). */
    total: number
}

const PROGRAMME_RE = /<programme([^>]+)>([\s\S]*?)<\/programme>/gi
const CHANNEL_RE = /<channel([^>]+)>([\s\S]*?)<\/channel>/gi
const DISPLAY_NAME_RE = /<display-name[^>]*>([^<]*)<\/display-name>/gi

/**
 * Tira sufixos de qualidade/codec do nome ("[FHD]", "(H265)", "HD" no fim).
 * Precisa casar com a regra do renderer — nomes de canal chegam sujos das duas
 * pontas, e uma divergência aqui faz o canal simplesmente não achar EPG.
 */
export function stripQualityTags(name: string): string {
    // .trim() na ENTRADA: o findXmltvChannelId removido trimava o
    // display-name antes de limpar as tags. Sem isso, nome com quebra de
    // linha em volta perde o EPG em silencio.
    return name.trim()
        .replace(/\s*\[(fhd|hd|sd|4k|uhd|m|p)\]/gi, '')
        .replace(/\s*\((h\.?265|h\.?264|h\.?266|hevc|avc)\)/gi, '')
        .replace(/\s*\((fhd|hd|sd|ppv|4k|uhd)\)/gi, '')
        .replace(/\s+(fhd|hd|sd|4k|uhd)\s*$/gi, '')
        .trim()
}

/** Chave de busca por nome: sem tags de qualidade, minúscula, espaço colapsado. */
export function nameKey(name: string): string {
    return stripQualityTags(name).toLowerCase().replace(/\s+/g, ' ').trim()
}

function decodeEntities(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
        // `&amp;` por último: senão `&amp;lt;` viraria `<`.
        .replace(/&amp;/g, '&')
}

/**
 * "YYYYMMDDHHMMSS +ZZZZ" -> ISO. `null` quando o formato não bate.
 *
 * Sem fuso o programa é DESCARTADO, como o parser antigo fazia. O padrão XMLTV
 * diz que o horário sem fuso é o local do EMISSOR — assumir UTC mostraria a
 * grade deslocada em silêncio, e horário errado é pior que horário ausente.
 */
export function parseXmltvTime(stamp: string, tz: string): string | null {
    if (!/^\d{14}$/.test(stamp) || !/^[+-]\d{4}$/.test(tz)) return null
    const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T`
        + `${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}`
        + `${tz.slice(0, 3)}:${tz.slice(3)}`
    const ms = Date.parse(iso)
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

const ATTR_CACHE = new Map<string, RegExp>()
function attr(source: string, name: string): string | null {
    let re = ATTR_CACHE.get(name)
    // Compilar dentro de um laço de centenas de milhares de iterações e
    // desperdício barato de evitar.
    if (!re) { re = new RegExp(`${name}="([^"]*)"`, 'i'); ATTR_CACHE.set(name, re) }
    re.lastIndex = 0
    const m = re.exec(source)
    return m ? m[1] : null
}

/** Janela de retenção — a mesma convenção do EPG do provedor. */
export const EPG_PAST_WINDOW_MS = 24 * 60 * 60 * 1000
export const EPG_FUTURE_WINDOW_MS = 48 * 60 * 60 * 1000

/**
 * Acumula um documento no índice. Vários arquivos do MESMO país entram no
 * mesmo índice porque eles **se sobrepõem**: medido nos arquivos reais, 116 de
 * 847 canais brasileiros e 409 de 5172 americanos aparecem em mais de um, e
 * ficar com o primeiro jogava fora até 23 h de grade em 191 canais.
 *
 * `nowMs` corta o que já morreu e o que é longe demais — sem isso um índice
 * nacional fica com centenas de milhares de programas residentes.
 */
export function addDocumentToIndex(index: XmltvIndex, xml: string, nowMs: number = Date.now()): XmltvIndex {
    const minEnd = nowMs - EPG_PAST_WINDOW_MS
    const maxStart = nowMs + EPG_FUTURE_WINDOW_MS

    CHANNEL_RE.lastIndex = 0
    let ch: RegExpExecArray | null
    while ((ch = CHANNEL_RE.exec(xml)) !== null) {
        const id = attr(ch[1], 'id')
        if (!id) continue
        DISPLAY_NAME_RE.lastIndex = 0
        let dn: RegExpExecArray | null
        while ((dn = DISPLAY_NAME_RE.exec(ch[2])) !== null) {
            const key = nameKey(decodeEntities(dn[1]))
            // Primeiro nome vence: o XMLTV lista o principal antes dos apelidos.
            if (key && !index.nameToId.has(key)) index.nameToId.set(key, id)
        }
    }

    PROGRAMME_RE.lastIndex = 0
    let p: RegExpExecArray | null
    while ((p = PROGRAMME_RE.exec(xml)) !== null) {
        index.total++
        const attrs = p[1]
        const channelId = attr(attrs, 'channel')
        if (!channelId) continue

        const [startStamp, startTz] = (attr(attrs, 'start') ?? '').trim().split(/\s+/)
        const [stopStamp, stopTz] = (attr(attrs, 'stop') ?? '').trim().split(/\s+/)
        const start = parseXmltvTime(startStamp ?? '', startTz ?? '')
        const end = parseXmltvTime(stopStamp ?? '', stopTz ?? '')
        if (!start || !end) continue
        if (Date.parse(end) < minEnd || Date.parse(start) > maxStart) continue

        const body = p[2]
        const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)
        const desc = /<desc[^>]*>([\s\S]*?)<\/desc>/i.exec(body)
        const cat = /<category[^>]*>([\s\S]*?)<\/category>/i.exec(body)

        const program: XmltvProgram = {
            id: `xmltv-${channelId}-${start}`,
            start,
            end,
            title: title ? decodeEntities(title[1]).trim() || 'Sem título' : 'Sem título',
            description: desc ? decodeEntities(desc[1]).trim() : '',
            channel_id: channelId,
        }
        if (cat) program.category = decodeEntities(cat[1]).trim()

        const list = index.byChannel.get(channelId)
        if (list) list.push(program)
        else index.byChannel.set(channelId, [program])
    }
    return index
}

/** Índice vazio, pronto pra receber documentos. */
export function emptyIndex(): XmltvIndex {
    return { byChannel: new Map(), nameToId: new Map(), total: 0 }
}

/**
 * Índice de um GRUPO de documentos (os N arquivos de um país, ou o único do
 * usuário). Ordena e remove duplicata por (início, título) — o mesmo programa
 * costuma aparecer em mais de um arquivo do grupo.
 */
export function buildXmltvIndex(xml: string | string[], nowMs: number = Date.now()): XmltvIndex {
    const index = emptyIndex()
    for (const doc of Array.isArray(xml) ? xml : [xml]) addDocumentToIndex(index, doc, nowMs)
    return finalizeIndex(index)
}

/** Ordena e tira duplicata por (início, título) — rode depois de acumular. */
export function finalizeIndex(index: XmltvIndex): XmltvIndex {
    for (const [id, list] of index.byChannel) {
        list.sort((a, b) => a.start.localeCompare(b.start))
        const vistos = new Set<string>()
        const unicos = list.filter(prog => {
            const chave = `${prog.start}|${prog.title}`
            if (vistos.has(chave)) return false
            vistos.add(chave)
            return true
        })
        if (unicos.length !== list.length) index.byChannel.set(id, unicos)
    }
    return index
}

/**
 * Programas de um canal, procurando por id e caindo pro nome — a mesma ordem
 * que o renderer usava, agora sem varrer o documento.
 */
export function lookupChannel(
    index: XmltvIndex,
    opts: { epgChannelId?: string; channelName?: string },
): XmltvProgram[] {
    const direto = opts.epgChannelId ? index.byChannel.get(opts.epgChannelId) : undefined
    const achados = direto?.length
        ? direto
        : opts.channelName
            ? index.byChannel.get(index.nameToId.get(nameKey(opts.channelName)) ?? '') ?? []
            : []
    if (!achados.length) return []
    // O caminho antigo devolvia o NOME pedido em `channel_id`, não o id do
    // XMLTV. Manter o contrato: mudar formato de saída num conserto de
    // desempenho é como o consumidor descobre a mudança do jeito ruim.
    return opts.channelName
        ? achados.map(prog => ({ ...prog, channel_id: opts.channelName as string }))
        : achados
}
