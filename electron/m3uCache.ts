/**
 * 🚀 R5 — cache do DOCUMENTO M3U no processo principal.
 *
 * A M3U não tem endpoints por item: qualquer pergunta ("quais episódios tem
 * esta série?", "qual a URL deste filme?") só é respondível baixando e
 * parseando a lista INTEIRA. Os handlers faziam exatamente isso, direto, em
 * todo clique — abrir uma ficha de série baixava até 50 MB do provedor e
 * reparseava tudo, TODA vez, e um ciclo dos seis kinds do catálogo baixava a
 * mesma lista seis vezes.
 *
 * Aqui o documento vira o que já é: um recurso caro, compartilhado, com o
 * mesmo TTL do catálogo. Uma URL residente (trocar de playlist devolve a
 * anterior) e dedupe de download em voo.
 *
 * Preço: o dado servido pode ficar ~2× o TTL velho no pior encadeamento (uma
 * entrada de catálogo gravada a partir de um documento já com 15 min serve por
 * mais 15). Em troca, as três respostas que dependem de ÍNDICE POSICIONAL do
 * documento (`stream_id = 100000+i`, `series_id = 300000+i`, episódio
 * `400000+i`) passam a sair todas do MESMO documento — antes a lista vinha do
 * cache e o `series:get-info` de um download novo, então uma linha a mais no
 * arquivo do provedor deslocava os índices e abria a série errada.
 *
 * Sem imports do electron — o chamador passa a função de download (testável).
 */

import { classifyM3uChannels, type M3uChannel } from './m3uProtocol'

/** Mesmo TTL do catálogo: os dois vêm do mesmo documento. */
export const M3U_DOC_TTL_MS = 15 * 60 * 1000

/**
 * Um `forceRefresh` aceita um documento baixado há menos que isto. O refresh do
 * catálogo pede os kinds em SEQUÊNCIA (Home: séries e depois filmes), e sem esta
 * janela cada um baixaria a mesma M3U de novo — é a mesma atualização.
 */
export const M3U_FORCE_REFRESH_WINDOW_MS = 5 * 1000

export interface M3uDocument {
    channels: M3uChannel[]
    /** Split live/vod/series calculado uma vez por documento (é O(n)). */
    classified: ReturnType<typeof classifyM3uChannels>
}

interface Resident {
    url: string
    fetchedAt: number
    doc: M3uDocument
}

let resident: Resident | null = null
let inFlight: { url: string; promise: Promise<M3uDocument> } | null = null

/** Descarta o documento residente (troca/remoção de playlist, logout). */
export function resetM3uDocumentCache(): void {
    resident = null
    inFlight = null
}

/** Estado do documento residente (exportado para os testes). */
export function m3uDocumentCacheState(): { url: string | null; channels: number; fetchedAt: number | null } {
    return {
        url: resident?.url ?? null,
        channels: resident?.doc.channels.length ?? 0,
        fetchedAt: resident?.fetchedAt ?? null,
    }
}

/**
 * Devolve o documento parseado + classificado de `url`, reusando o residente
 * enquanto estiver dentro do TTL.
 *
 * `download` é chamado no máximo uma vez por janela, mesmo com N chamadas
 * concorrentes (o Ctrl+K dispara seis kinds em paralelo). `forceRefresh`
 * ignora o TTL mas ainda entra na carona de um download já em voo — repetir
 * uma ida ao provedor que está acontecendo agora não traria dado mais novo, e
 * provedor com limite de conexões simultâneas recusa a segunda.
 */
export async function cachedM3uDocument(
    url: string,
    download: () => Promise<M3uChannel[]>,
    options: { forceRefresh?: boolean; now?: number } = {}
): Promise<M3uDocument> {
    const now = options.now ?? Date.now()
    const maxAge = options.forceRefresh ? M3U_FORCE_REFRESH_WINDOW_MS : M3U_DOC_TTL_MS

    if (resident && resident.url === url && now - resident.fetchedAt < maxAge) {
        return resident.doc
    }

    if (inFlight && inFlight.url === url) return inFlight.promise

    const promise = (async (): Promise<M3uDocument> => {
        const channels = await download()
        const doc: M3uDocument = { channels, classified: classifyM3uChannels(channels) }
        // Uma URL residente: trocar de playlist devolve a lista anterior em vez
        // de acumular uma cópia por conta usada na sessão.
        resident = { url, fetchedAt: options.now ?? Date.now(), doc }
        return doc
    })()

    const entry = { url, promise }
    inFlight = entry
    try {
        return await promise
    } finally {
        if (inFlight === entry) inFlight = null
    }
}
