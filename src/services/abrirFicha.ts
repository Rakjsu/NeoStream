/**
 * 🎬 Abrir a ficha de um título de outra tela.
 *
 * O app tem UM canal para isso: a página de destino consome uma chave de
 * `sessionStorage` (na montagem e no evento) e abre a ficha. A busca global e
 * os "Parecidos" do modal usam esse canal; o aviso de **🎉 Nova Temporada** /
 * **📺 Novos Episódios** não usava — ele navegava para
 * `/dashboard/series?id=${seriesId}`, e a página de Séries **não lê
 * `?id=`** (não há um `useSearchParams` nem um `location.search` no arquivo
 * inteiro). Resultado: o aviso se marcava como lido, o painel fechava, a
 * página abria na grade genérica e a série avisada nunca aparecia — sendo que
 * abrir a série é a única ação que o aviso oferece.
 *
 * A rotina fica aqui, e não repetida em cada chamador, porque eram justamente
 * duas cópias divergentes que causaram o defeito.
 */

import { GLOBAL_SEARCH_OPEN_KEY, GLOBAL_SEARCH_EVENT } from '../components/GlobalSearch'

export type TipoDeFicha = 'vod' | 'series'

/** Rota da grade que consome o pedido de abertura. */
export function rotaDaFicha(kind: TipoDeFicha): string {
    return kind === 'vod' ? '/dashboard/vod' : '/dashboard/series'
}

/**
 * Deixa o pedido pronto para a página de destino e avisa quem já está nela.
 *
 * O evento importa para o caso "já estou em Séries": sem ele a navegação não
 * remonta a página, e o pedido ficaria no storage até a próxima visita.
 *
 * @returns a rota para onde navegar
 */
export function pedirAberturaDeFicha(kind: TipoDeFicha, id: string | number): string {
    try {
        sessionStorage.setItem(GLOBAL_SEARCH_OPEN_KEY, JSON.stringify({ kind, id: String(id) }))
    } catch {
        // Sem sessionStorage (janela anônima), a navegação ainda leva à grade.
    }
    const rota = rotaDaFicha(kind)
    window.dispatchEvent(new Event(GLOBAL_SEARCH_EVENT))
    return rota
}

/**
 * 🔒 O outro lado do canal: qual item do catálogo esse id abre — se o gate
 * deixar.
 *
 * A grade só desenha o que passa por `isItemVisible`, e por muito tempo bastou
 * confiar nela. Só que a grade NÃO é o único emissor de id: a busca global, os
 * "Parecidos"/filmografia da ficha e o aviso de novos episódios gravam um id
 * aqui, e a página de destino resolvia esse id na lista CRUA do fetch
 * (`streams.find(...)` / `series.find(...)`) e chamava o setter da ficha
 * direto. Esse caminho não via filtro nenhum: um clique num "Parecido" abria a
 * ficha inteira — sinopse, elenco, botão de Reproduzir — de um título que a
 * grade esconde por categoria adulta, por classificação vetada em cache ou por
 * ocultação do perfil infantil.
 *
 * Mesmo desenho do `proximoDaFila`: função PURA com o gate injetado. A regra
 * fica visível e testada, e vale para todo emissor de id — os de hoje e os que
 * ainda vão existir, porque todos desembocam aqui.
 *
 * @param idPedido id que veio no pedido de abertura
 * @param catalogo a lista CRUA que a página carregou
 * @param idDoItem como ler o id do item (`stream_id` / `series_id`)
 * @param visivel o gate de parental/infantil da tela (`isItemVisible`)
 */
export function fichaLiberada<T>(
    idPedido: string,
    catalogo: readonly T[],
    idDoItem: (item: T) => string | number,
    visivel: (item: T) => boolean
): T | null {
    // O id do Xtream chega número no catálogo e string no pedido.
    const achado = catalogo.find(item => String(idDoItem(item)) === idPedido)
    if (!achado) return null
    return visivel(achado) ? achado : null
}
