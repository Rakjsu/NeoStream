/**
 * 🚪 O que "sair da conta" pode apagar — e o que ele nunca deve tocar.
 *
 * O botão da sidebar chamava `localStorage.clear()`. O processo principal é
 * cuidadoso (`auth:logout` só desativa a playlist: *"saved playlists are
 * kept"*), mas o renderer já tinha zerado tudo o que vive no localStorage:
 * perfis, favoritos, Minha Lista, progresso de filmes e episódios
 * (`neostream_profile_<perfil>__pl_<playlist>`), histórico, tags pessoais,
 * marcadores, o mapa de teclas e as preferências de aparência — de todos os
 * perfis e de todas as listas. Sem confirmação e sem volta: quem clicava
 * achando que ia só trocar de conta voltava com o app zerado e a lista ainda
 * cadastrada.
 *
 * Sair da conta significa **soltar a sessão**, não esquecer o usuário. As
 * únicas chaves que precisam sair são o espelho de qual lista está ativa e os
 * caches derivados do provedor — tudo o mais é dado da pessoa.
 *
 * A lista é explícita de propósito: uma regra por prefixo ("apague tudo que
 * começa com X") volta a apagar demais no dia em que alguém criar uma chave
 * nova sem pensar nisto aqui.
 */

/** Espelho de qual playlist está ativa (activePlaylistService). */
const ESPELHO_DA_PLAYLIST = 'neostream_active_playlist_id'

/**
 * Caches derivados do provedor: sem eles a próxima conta buscaria tudo de
 * novo de qualquer jeito, e mantê-los mostraria dado da conta anterior.
 * São os mesmos que o `playlistService.clearProviderCaches` já solta ao
 * trocar de lista.
 */
const CACHES_DO_PROVEDOR = [
    'contentLastFetch',
    'epg_test_results',
    'neostream_catalog_last_refresh',
]

export const CHAVES_LIMPAS_NO_LOGOUT: readonly string[] = [
    ESPELHO_DA_PLAYLIST,
    ...CACHES_DO_PROVEDOR,
]

/**
 * Esta chave sobrevive ao logout?
 *
 * Existe para o teste poder afirmar, nome por nome, que o dado da pessoa fica
 * — foi justamente o `clear()` cego que levou tudo embora.
 */
export function sobreviveAoLogout(chave: string): boolean {
    return !CHAVES_LIMPAS_NO_LOGOUT.includes(chave)
}

/**
 * Apaga só a sessão. Recebe o storage para o teste não depender do global.
 */
export function limparSessao(storage: Pick<Storage, 'removeItem'>): void {
    for (const chave of CHAVES_LIMPAS_NO_LOGOUT) {
        try {
            storage.removeItem(chave)
        } catch {
            // localStorage indisponível: sair da conta continua valendo.
        }
    }
}
