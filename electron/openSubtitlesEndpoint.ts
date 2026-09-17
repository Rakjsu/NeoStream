/**
 * Para onde o `opensubtitles:request` pode apontar — puro, sem I/O.
 *
 * O handler montava o destino assim:
 *
 * ```ts
 * const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`
 * ```
 *
 * Ou seja: o renderer escolhia o HOST, e o main fazia o fetch com os
 * cabeçalhos do usuário — `Api-Key: <chave dele>` e, quando o corpo trazia
 * `authToken`, um `Authorization: Bearer`. É a mesma primitiva de "fetch
 * arbitrário com credencial do provedor" que o #405 apagou, e o ramo nunca
 * teve um chamador: os três caminhos reais são relativos.
 *
 * Fechar só o host não basta — com o caminho livre, quem chegasse ao canal
 * ainda gastaria a chave do usuário em qualquer rota da API. Daí a lista
 * fechada, o mesmo padrão de allowlist que o `preload.ts` aplica aos canais.
 */
export const OPENSUBTITLES_BASE_URL = 'https://api.opensubtitles.com/api/v1'

/**
 * Os caminhos que o renderer realmente pede (`src/services/subtitleService.ts`
 * e `src/pages/settings/ApiKeysSection.tsx`). Quem acrescentar um quarto tem
 * que passar por aqui — `destinoDoOpenSubtitles.test.ts` cobra isso lendo o
 * renderer, senão a legenda pararia em silêncio.
 */
export const OPENSUBTITLES_ENDPOINTS = ['/login', '/subtitles', '/download'] as const

export function resolverUrlOpenSubtitles(endpoint: unknown): string | null {
    if (typeof endpoint !== 'string') return null
    // Só o CAMINHO entra na conferência: a busca manda `/subtitles?query=…`,
    // e o que vem depois do `?` é parâmetro da API, não escolha de destino.
    const caminho = endpoint.split('?')[0]
    // Igualdade, não prefixo: com `startsWith`, `/login/../../qualquer-coisa`
    // passaria e voltaríamos a deixar o renderer escolher o caminho.
    if (!(OPENSUBTITLES_ENDPOINTS as readonly string[]).includes(caminho)) return null
    return `${OPENSUBTITLES_BASE_URL}${endpoint}`
}
