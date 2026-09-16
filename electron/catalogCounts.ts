/**
 * 🔢 Quantos canais, filmes e séries a lista tem.
 *
 * O `content:get-counts` era o ÚNICO handler de catálogo que não passava pelo
 * `catalogListHandler`: ele lia o espelho `auth` e falava direto com o
 * `XtreamClient`, com um `.catch(() => [])` em cada chamada. Duas consequências,
 * e as duas mudas:
 *
 * 1. **Mentira em M3U e Stalker.** Numa lista M3U o espelho guarda username
 *    `'m3u'`, senha `'m3u'` e — em lista de arquivo — um caminho de disco no
 *    lugar da URL. O XtreamClient falha, o catch devolve `[]`, e o handler
 *    responde `success: true` com `0 / 0 / 0`. A Home grava isso como verdade e
 *    mostra "0 canais, 0 filmes, 0 séries" numa tela cujos catálogos, buscados
 *    pelos OUTROS handlers, acabaram de carregar milhares de itens.
 * 2. **Catálogo baixado duas vezes.** Como não passava pelo `cachedCatalogFetch`,
 *    a contagem do cadastro baixava o catálogo inteiro fora do cache — e o app
 *    baixava tudo de novo logo depois, no boot do dashboard.
 *
 * O conserto é rotear pelos mesmos três `catalogListHandler`, e este módulo é a
 * parte que decide o que fazer com as três respostas. Fica separado para poder
 * ser testado sem Electron.
 */

/** O formato que o `catalogListHandler` devolve, nos dois desfechos. */
export interface RespostaDeCatalogo {
    success: boolean
    data?: unknown
    error?: string
}

export type ContagemDoCatalogo =
    | { success: true; counts: { live: number; vod: number; series: number } }
    | { success: false; error: string }

function quantos(resposta: RespostaDeCatalogo): number {
    return Array.isArray(resposta.data) ? resposta.data.length : 0
}

/**
 * Três respostas → uma contagem.
 *
 * Qualquer uma falhar derruba a resposta inteira, de propósito: zero com
 * `success: true` é gravado pela tela como se fosse a verdade, e foi assim que
 * a Home passou a mostrar um catálogo vazio que ela mesma tinha acabado de
 * carregar. Lista vazia de verdade continua sendo zero com sucesso — é o caso
 * legítimo do M3U, que na fase 1 só traz canais.
 */
export function contagensDoCatalogo(
    live: RespostaDeCatalogo,
    vod: RespostaDeCatalogo,
    series: RespostaDeCatalogo
): ContagemDoCatalogo {
    const falha = [live, vod, series].find(r => !r.success)
    if (falha) return { success: false, error: falha.error || 'Não foi possível contar o catálogo' }
    return {
        success: true,
        counts: { live: quantos(live), vod: quantos(vod), series: quantos(series) }
    }
}
