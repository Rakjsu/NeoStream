import { describe, it, expect, beforeEach } from 'vitest';
import { bookmarkService } from './bookmarkService';

describe('bookmarkService', () => {
    beforeEach(() => localStorage.clear());

    it('adiciona, ordena e deduplica por janela de 2s', () => {
        bookmarkService.add('m1', 120);
        bookmarkService.add('m1', 30);
        bookmarkService.add('m1', 121); // < 2s do 120 → dedupe
        const list = bookmarkService.list('m1');
        expect(list.map(b => b.time)).toEqual([30, 120]);
    });

    it('remove pelo tempo exato e isola por conteúdo', () => {
        bookmarkService.add('m1', 10);
        bookmarkService.add('m2', 99);
        bookmarkService.remove('m1', 10);
        expect(bookmarkService.list('m1')).toEqual([]);
        expect(bookmarkService.list('m2').map(b => b.time)).toEqual([99]);
    });

    it('ignora entradas inválidas', () => {
        bookmarkService.add('', 10);
        bookmarkService.add('m1', NaN);
        bookmarkService.add('m1', -5);
        expect(bookmarkService.list('m1')).toEqual([]);
    });
});
