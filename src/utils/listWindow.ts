/**
 * Janela de renderização para listas verticais de altura FIXA (o overlay de
 * zapping do player). Diferente do useWindowedGrid — que mede a grade real —
 * aqui a altura da linha é constante por construção, então a conta é exata e
 * pode ser testada sem DOM.
 *
 * Regra de ouro: na dúvida, renderizar TUDO. Enquanto a geometria não for
 * confiável (altura de linha ou do viewport ainda não medidas) a função
 * devolve a lista inteira — canal sumindo da lista é bug pior que lentidão.
 */

export interface ListWindowOptions {
    /** Total de itens da lista já filtrada. */
    itemCount: number;
    /** Passo vertical de uma linha em px (altura + margem). */
    rowHeight: number;
    /** scrollTop atual do container. */
    scrollTop: number;
    /** Altura visível do container (clientHeight). */
    viewportHeight: number;
    /** Linhas extras renderizadas acima e abaixo da janela visível. */
    overscan?: number;
}

export interface ListWindowResult {
    /** Montar só os itens em [start, end). */
    start: number;
    end: number;
    /** Alturas dos espaçadores que substituem as linhas não montadas. */
    topSpacer: number;
    bottomSpacer: number;
}

export function computeListWindow({
    itemCount,
    rowHeight,
    scrollTop,
    viewportHeight,
    overscan = 6
}: ListWindowOptions): ListWindowResult {
    if (itemCount <= 0) return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 };

    // Geometria ainda não medida: lista inteira (comportamento antigo).
    if (!(rowHeight > 0) || !(viewportHeight > 0)) {
        return { start: 0, end: itemCount, topSpacer: 0, bottomSpacer: 0 };
    }

    const safeScrollTop = Math.max(0, scrollTop);
    const firstVisible = Math.floor(safeScrollTop / rowHeight);
    const lastVisible = Math.ceil((safeScrollTop + viewportHeight) / rowHeight) - 1;

    const start = Math.max(0, Math.min(itemCount - 1, firstVisible - overscan));
    const end = Math.min(itemCount, Math.max(start + 1, lastVisible + 1 + overscan));

    return {
        start,
        end,
        topSpacer: start * rowHeight,
        bottomSpacer: (itemCount - end) * rowHeight
    };
}

export interface ScrollIntoViewOptions {
    /** Índice do item que precisa ficar visível. */
    index: number;
    rowHeight: number;
    scrollTop: number;
    viewportHeight: number;
}

/**
 * Novo scrollTop pra deixar o item visível com o MENOR movimento possível
 * (mesma semântica do scrollIntoView block:'nearest'). Substitui o
 * `querySelector` + scrollIntoView do overlay, que não funciona quando a
 * linha alvo não está montada por causa da janela.
 */
export function scrollTopForIndex({ index, rowHeight, scrollTop, viewportHeight }: ScrollIntoViewOptions): number {
    if (index < 0 || !(rowHeight > 0) || !(viewportHeight > 0)) return scrollTop;
    const top = index * rowHeight;
    const bottom = top + rowHeight;
    if (top < scrollTop) return top;
    if (bottom > scrollTop + viewportHeight) return Math.max(0, bottom - viewportHeight);
    return scrollTop;
}

/** scrollTop que centraliza o item (usado ao ABRIR a lista no canal atual). */
export function scrollTopToCenter({ index, rowHeight, viewportHeight }: Omit<ScrollIntoViewOptions, 'scrollTop'>): number {
    if (index < 0 || !(rowHeight > 0) || !(viewportHeight > 0)) return 0;
    return Math.max(0, index * rowHeight - Math.max(0, (viewportHeight - rowHeight) / 2));
}
