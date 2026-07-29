import { describe, it, expect } from 'vitest';
import { computeRowWindow, rowIndexAt } from './windowedGridMath';

const grid = {
    viewportHeight: 900,
    rowHeight: 300,
    rowGap: 20,
    itemCount: 45000,
    columns: 6,
    overscanRows: 3
};

describe('windowedGridMath', () => {
    it('todo offset dentro da MESMA linha dá o mesmo índice de linha', () => {
        expect(rowIndexAt(0, 300)).toBe(0);
        expect(rowIndexAt(299, 300)).toBe(0);
        expect(rowIndexAt(300, 300)).toBe(1);
        expect(rowIndexAt(-40, 300)).toBe(0);
        expect(rowIndexAt(1000, 0)).toBe(0);
    });

    it('a janela depende só da linha — é isso que evita o render por frame', () => {
        // 8 quadros de rolagem dentro da linha 10 (3.000..3.299 px).
        const windows = new Set<string>();
        for (let px = 3000; px < 3300; px += 37) {
            const w = computeRowWindow({ ...grid, scrollRow: rowIndexAt(px, grid.rowHeight) });
            windows.add(`${w.start}|${w.end}|${w.topSpacer}|${w.bottomSpacer}`);
        }
        expect(windows.size).toBe(1);
    });

    it('a fatia cobre tudo que está visível, com o overscan pedido', () => {
        const scrollRow = 10;
        const w = computeRowWindow({ ...grid, scrollRow });
        // Topo: 3 linhas de overscan antes da linha 10.
        expect(w.start).toBe((scrollRow - grid.overscanRows) * grid.columns);
        // Última linha visível = 10 + ceil(900/300) = 13; +3 de overscan = 16.
        const firstItemBelowFold = (scrollRow + Math.ceil(grid.viewportHeight / grid.rowHeight)) * grid.columns;
        expect(w.end).toBeGreaterThan(firstItemBelowFold);
    });

    it('os spacers repõem exatamente as linhas não montadas', () => {
        const w = computeRowWindow({ ...grid, scrollRow: 100 });
        const totalRows = Math.ceil(grid.itemCount / grid.columns);
        const mountedRows = (w.end - w.start) / grid.columns;
        const skippedRows = totalRows - mountedRows;
        const spacerPx = w.topSpacer + w.bottomSpacer;
        // Cada spacer é uma linha da grade, então perde um gap para o vizinho.
        expect(spacerPx).toBe(skippedRows * grid.rowHeight - 2 * grid.rowGap);
    });

    it('no fim da lista a janela é grampeada e o spacer de baixo zera', () => {
        const w = computeRowWindow({ ...grid, scrollRow: 999999 });
        expect(w.end).toBe(grid.itemCount);
        expect(w.bottomSpacer).toBe(0);
    });

    it('lista vazia ou geometria ausente não estoura', () => {
        expect(computeRowWindow({ ...grid, scrollRow: 0, itemCount: 0 }))
            .toEqual({ start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 });
        expect(computeRowWindow({ ...grid, scrollRow: 0, columns: 0 }).end).toBe(grid.itemCount);
    });
});
