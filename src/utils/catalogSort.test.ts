import { describe, it, expect, vi, afterEach } from 'vitest';
import { compareCatalogItems } from '../utils/catalogSort';

const item = (name: string, added?: number, rating?: string, num?: number) => ({ name, added, rating, num });

describe('compareCatalogItems', () => {
    it('name: alfabético, insensível a caixa e com números naturais', () => {
        const list = [item('zebra'), item('Canal 10'), item('canal 2'), item('Alfa')];
        list.sort((a, b) => compareCatalogItems('name', a, b));
        expect(list.map(i => i.name)).toEqual(['Alfa', 'canal 2', 'Canal 10', 'zebra']);
    });

    it('rating: desc, lixo vira 0', () => {
        const list = [item('B', 0, '7.5'), item('C', 0, 'abc'), item('A', 0, '9')];
        list.sort((a, b) => compareCatalogItems('rating', a, b));
        expect(list.map(i => i.name)).toEqual(['A', 'B', 'C']);
    });

    it('recent: added desc, empata em num asc (ordem do provedor)', () => {
        const list = [item('velho', 100, undefined, 3), item('novo', 300), item('sem-data', undefined, undefined, 1)];
        list.sort((a, b) => compareCatalogItems('recent', a, b));
        expect(list.map(i => i.name)).toEqual(['novo', 'velho', 'sem-data']);
    });

    // 🚀 Regressão (auditoria R5): `localeCompare(x, undefined, {...})` monta um
    // Collator NOVO por comparação. Ordenar 45 mil filmes = ~700 mil dessas —
    // 2.200 ms de renderer travado contra 82 ms com o Collator de módulo.
    // Se alguém voltar ao localeCompare, este teste cai.
    describe('name usa um Intl.Collator reusado', () => {
        afterEach(() => vi.restoreAllMocks());

        it('ordena sem localeCompare e sem construir Collator por comparação', () => {
            const localeCompareSpy = vi.spyOn(String.prototype, 'localeCompare');
            const collatorSpy = vi.spyOn(Intl, 'Collator');
            const list = [item('zebra'), item('Canal 10'), item('canal 2'), item('Alfa')];
            list.sort((a, b) => compareCatalogItems('name', a, b));
            expect(list.map(i => i.name)).toEqual(['Alfa', 'canal 2', 'Canal 10', 'zebra']);
            expect(localeCompareSpy).not.toHaveBeenCalled();
            expect(collatorSpy).not.toHaveBeenCalled();
        });
    });
});
