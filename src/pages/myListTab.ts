/**
 * Qual aba de "Minha Lista" abrir.
 *
 * A página tem três abas (Favoritos · Ver depois · Fila) e duas fontes
 * disputando a escolha:
 *
 * - a URL (`?tab=`), usada pelos atalhos da Home e pelas rotas legadas
 *   `/dashboard/watch-later` e `/dashboard/favorites`, que existem desde antes
 *   das abas e apontavam para páginas separadas;
 * - o `localStorage`, que guarda a última aba aberta à mão.
 *
 * A URL vence sempre. Sem isso, quem clica em "Ver depois" na Home cai na aba
 * que ele deixou aberta da última vez — foi o que acontecia: os dois atalhos da
 * Home levavam ao mesmo lugar, e nenhum dos dois abria o que anunciava.
 */

export const MY_LIST_TABS = ['favorites', 'watchLater', 'queue'] as const

export type MyListTab = (typeof MY_LIST_TABS)[number]

export const MY_LIST_TAB_KEY = 'neostream_mylist_tab'

const ehAba = (valor: string | null | undefined): valor is MyListTab =>
    valor != null && (MY_LIST_TABS as readonly string[]).includes(valor)

/**
 * @param daUrl valor de `?tab=` (ou null quando a URL não pede nada)
 * @param salva última aba escolhida à mão, do localStorage
 */
export function resolveMyListTab(daUrl: string | null | undefined, salva: string | null | undefined): MyListTab {
    if (ehAba(daUrl)) return daUrl
    if (ehAba(salva)) return salva
    return 'favorites'
}
