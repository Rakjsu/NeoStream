/**
 * Aritmética pura da janela das grades (VOD/Séries) — separada do hook para
 * poder ser testada e, principalmente, para deixar explícito que a janela
 * depende só do ÍNDICE DA LINHA do topo, não do scrollTop em pixels.
 *
 * É isso que corta os re-renders: o hook antigo guardava `scrollTop` cru num
 * useState dentro de um rAF, então a página inteira re-renderizava a até 60 fps
 * enquanto a roda do mouse girava, mesmo quando a fatia montada não mudava.
 * Guardando a linha, o re-render só acontece quando uma linha nova entra na
 * janela.
 */

export interface RowWindowInput {
    /** Primeira linha ENCOSTADA no topo do viewport (floor(scrollTop/rowHeight)). */
    scrollRow: number;
    /** Altura visível do scroller, em px. */
    viewportHeight: number;
    /** Altura de uma linha (card + gap), em px. */
    rowHeight: number;
    /** Gap entre linhas, em px (o spacer ocupa uma linha da grade e ganha um gap extra). */
    rowGap: number;
    /** Total de itens da lista filtrada. */
    itemCount: number;
    /** Colunas reais da grade (lidas do CSS). */
    columns: number;
    /** Linhas extras montadas de cada lado do viewport. */
    overscanRows: number;
}

export interface RowWindow {
    start: number;
    end: number;
    topSpacer: number;
    bottomSpacer: number;
}

/**
 * Converte scrollTop em índice de linha. Fora do hook para o teste poder
 * checar que offsets dentro da MESMA linha dão o mesmo índice.
 */
export function rowIndexAt(scrollTop: number, rowHeight: number): number {
    if (!(rowHeight > 0)) return 0;
    return Math.max(0, Math.floor(scrollTop / rowHeight));
}

/**
 * Fatia montada + alturas dos spacers.
 *
 * A borda de baixo é derivada de `scrollRow` (e não do scrollTop exato) somando
 * as linhas que cabem no viewport mais uma: como o topo pode estar a até
 * `rowHeight - 1` px dentro da linha, essa conta é um superconjunto do que a
 * versão em pixels montava — no máximo uma linha a mais, nunca uma a menos.
 */
export function computeRowWindow({
    scrollRow,
    viewportHeight,
    rowHeight,
    rowGap,
    itemCount,
    columns,
    overscanRows
}: RowWindowInput): RowWindow {
    if (columns <= 0 || rowHeight <= 0 || itemCount <= 0) {
        return { start: 0, end: itemCount, topSpacer: 0, bottomSpacer: 0 };
    }

    const totalRows = Math.ceil(itemCount / columns);
    const rowsInViewport = Math.ceil(viewportHeight / rowHeight) + 1;

    const firstVisibleRow = Math.max(0, Math.min(scrollRow, totalRows - 1) - overscanRows);
    const lastVisibleRow = Math.min(totalRows - 1, scrollRow + rowsInViewport + overscanRows);

    // N linhas puladas ocupam N*rowHeight (card + gap cada). O spacer substitui
    // essas linhas mas, sendo ele próprio uma linha da grade, o CSS ainda põe
    // um gap entre ele e a linha vizinha — daí o desconto.
    const spacerFor = (skippedRows: number) =>
        skippedRows > 0 ? Math.max(0, skippedRows * rowHeight - rowGap) : 0;

    return {
        start: firstVisibleRow * columns,
        end: Math.min(itemCount, (lastVisibleRow + 1) * columns),
        topSpacer: spacerFor(firstVisibleRow),
        bottomSpacer: spacerFor(totalRows - 1 - lastVisibleRow)
    };
}
