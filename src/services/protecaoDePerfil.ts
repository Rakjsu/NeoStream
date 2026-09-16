/**
 * 🛡️ Quem pode apagar ou mexer num perfil — as regras, num lugar só.
 *
 * O app tinha DUAS telas de gerenciar perfil com réguas diferentes. O
 * `ProfileManager` (dentro do app, atrás do perfil já escolhido) recusa apagar
 * o perfil ativo, o último e o infantil, e exige o PIN quando o perfil tem um.
 * O `ProfileSelector` — a tela de boot, justamente a que a criança vê — tinha o
 * seu próprio "Gerenciar" com um único teste: `profiles.length <= 1`.
 *
 * Na prática: perfil do pai com PIN, a criança entra no Kids, volta para a tela
 * de perfis, toca em ⚙️ e 🗑️, e o perfil do pai vai embora com favoritos e
 * progresso. Renomear e trocar o avatar/cor também passavam direto.
 *
 * As regras moram aqui para as duas telas lerem as MESMAS, e para não voltarem
 * a divergir na próxima mudança. São puras: recebem o perfil e o contexto,
 * devolvem o veredito.
 */

export interface PerfilProtegido {
    id: string
    isKids?: boolean
    pin?: string
}

export type BloqueioParaApagar =
    /** É o perfil em uso agora. */
    | 'ativo'
    /** É o único que sobrou — o app precisa de pelo menos um. */
    | 'ultimo'
    /** O perfil infantil não se apaga (não há como recriá-lo hoje). */
    | 'kids'

export interface ContextoDeExclusao {
    perfil: PerfilProtegido
    /** Id do perfil ativo, quando há um. */
    ativoId?: string | null
    /** Quantos perfis existem (sem contar o convidado). */
    total: number
}

/**
 * Por que este perfil NÃO pode ser apagado — ou `null` quando pode.
 *
 * A ordem importa para a mensagem: "é o que você está usando" explica melhor
 * que "é o último", e é o caso mais comum de quem clica no lixo sem pensar.
 */
export function bloqueioParaApagar(ctx: ContextoDeExclusao): BloqueioParaApagar | null {
    if (ctx.ativoId && ctx.perfil.id === ctx.ativoId) return 'ativo'
    if (ctx.total <= 1) return 'ultimo'
    if (ctx.perfil.isKids) return 'kids'
    return null
}

/** Chave da mensagem (seção `profile`) para cada bloqueio. */
export function chaveDoBloqueio(bloqueio: BloqueioParaApagar): string {
    switch (bloqueio) {
        case 'ativo': return 'cannotDeleteActive'
        case 'ultimo': return 'cannotDeleteLast'
        default: return 'cannotDeleteKids'
    }
}

/**
 * Este perfil exige o PIN antes de ser apagado ou editado?
 *
 * É a mesma pergunta para as duas ações de propósito: trocar o nome e o avatar
 * de um perfil protegido é mexer no perfil de outra pessoa do mesmo jeito que
 * apagá-lo — só que sem aviso nenhum depois.
 */
export function exigePinParaMexer(perfil: PerfilProtegido): boolean {
    return !!perfil.pin
}
