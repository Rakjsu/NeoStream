import { describe, it, expect } from 'vitest';
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
});
