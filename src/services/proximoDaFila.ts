/**
 * ⏭️ Qual filme a contagem regressiva de "A seguir" vai tocar.
 *
 * Quando um filme acaba, o player oferece o próximo da fila com a mesma
 * contagem das séries. A escolha tinha dois caminhos — a fila MANUAL primeiro,
 * o "Ver depois" como reserva — e a guarda do controle parental existia só no
 * segundo:
 *
 *     if (manual) { const found = …; if (found) return found }          // sem guarda
 *     for (const queued of watchLater) { if (found && isItemVisible(found)) … }  // com guarda
 *
 * Num perfil infantil, ou com o parental ligado e a sessão travada, a contagem
 * regressiva tocava um título que a própria grade esconde — e a fila manual
 * pode ser abastecida pela ficha ou pelo celular, sem passar por PIN nenhum.
 *
 * A escolha vira uma função pura para a regra ficar visível e testada: o
 * filtro de visibilidade é o MESMO nos dois caminhos, e o "pode tocar" não
 * depende de por qual porta o título entrou na fila.
 */

export interface ItemDaFila {
    id: string
    type?: string
}

/**
 * @param filaManual o que `queueService.next(atual)` devolveu (ou null)
 * @param verDepois a lista do "Ver depois", na ordem
 * @param achar procura o item no catálogo carregado
 * @param visivel o gate de parental/infantil da tela (isItemVisible)
 */
export function proximoDaFila<T>(
    atualId: string,
    filaManual: ItemDaFila | null | undefined,
    verDepois: readonly ItemDaFila[],
    achar: (id: string) => T | undefined,
    visivel: (item: T) => boolean
): T | null {
    if (filaManual) {
        const achado = achar(filaManual.id)
        // A guarda que faltava: entrar na fila não dá passe livre pelo gate.
        if (achado && visivel(achado)) return achado
    }
    for (const naLista of verDepois) {
        if (naLista.type !== 'movie' || naLista.id === atualId) continue
        const achado = achar(naLista.id)
        if (achado && visivel(achado)) return achado
    }
    return null
}
