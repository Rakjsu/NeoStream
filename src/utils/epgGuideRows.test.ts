import { describe, it, expect } from 'vitest';
import { computeGuideRowWindow, mergeGuideGenres } from './epgGuide';

const guide = { viewportHeight: 700, rowHeight: 64, overscanRows: 6 };

describe('computeGuideRowWindow', () => {
    it('o número de linhas montadas NÃO cresce com o tamanho da categoria', () => {
        const small = computeGuideRowWindow({ ...guide, scrollRow: 10, rowCount: 60 });
        const huge = computeGuideRowWindow({ ...guide, scrollRow: 10, rowCount: 5000 });
        expect(huge.end - huge.start).toBe(small.end - small.start);
        // Teto: viewport (12 linhas) + 2×overscan + 1.
        expect(huge.end - huge.start).toBeLessThanOrEqual(
            Math.ceil(guide.viewportHeight / guide.rowHeight) + 1 + 2 * guide.overscanRows + 1
        );
    });

    it('rolar até o fim de 600 canais continua montando poucas linhas', () => {
        const lastRow = Math.floor((600 * guide.rowHeight - guide.viewportHeight) / guide.rowHeight);
        const w = computeGuideRowWindow({ ...guide, scrollRow: lastRow, rowCount: 600 });
        expect(w.end).toBe(600);
        expect(w.end - w.start).toBeLessThan(30);
        expect(w.bottomSpacer).toBe(0);
    });

    it('os spacers mantêm a altura total da categoria', () => {
        const rowCount = 600;
        const w = computeGuideRowWindow({ ...guide, scrollRow: 200, rowCount });
        const mounted = (w.end - w.start) * guide.rowHeight;
        expect(w.topSpacer + mounted + w.bottomSpacer).toBe(rowCount * guide.rowHeight);
    });

    it('a fatia cobre o viewport inteiro a partir da linha do topo', () => {
        const scrollRow = 50;
        const w = computeGuideRowWindow({ ...guide, scrollRow, rowCount: 600 });
        const lastRowOnScreen = scrollRow + Math.ceil(guide.viewportHeight / guide.rowHeight);
        expect(w.start).toBeLessThanOrEqual(scrollRow);
        expect(w.end).toBeGreaterThan(lastRowOnScreen);
    });

    it('categoria vazia devolve janela vazia', () => {
        expect(computeGuideRowWindow({ ...guide, scrollRow: 0, rowCount: 0 }))
            .toEqual({ start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 });
    });
});

describe('mergeGuideGenres', () => {
    const programs = (...categories: (string | undefined)[]) => categories.map(category => ({ category }));

    it('acumula os gêneros ordenados conforme os canais resolvem', () => {
        const scanned = new Set<string>();
        const byChannel: Record<string, { category?: string }[] | undefined> = {
            'Canal A': programs('Filme', 'Notícias')
        };
        let genres = mergeGuideGenres([], byChannel, scanned);
        expect(genres).toEqual(['Filme', 'Notícias']);

        byChannel['Canal B'] = programs('Esporte', 'Filme');
        genres = mergeGuideGenres(genres, byChannel, scanned);
        expect(genres).toEqual(['Esporte', 'Filme', 'Notícias']);
    });

    it('sem gênero novo devolve a MESMA referência (setState sai sem re-render)', () => {
        const scanned = new Set<string>();
        const byChannel: Record<string, { category?: string }[] | undefined> = {
            'Canal A': programs('Filme')
        };
        const genres = mergeGuideGenres([], byChannel, scanned);

        byChannel['Canal B'] = programs('Filme', undefined);
        expect(mergeGuideGenres(genres, byChannel, scanned)).toBe(genres);
    });

    it('só varre o canal que ainda não foi contabilizado', () => {
        const scanned = new Set<string>();
        let visited = 0;
        const spy = (categories: string[]) => new Proxy(categories.map(category => ({ category })), {
            get(target, prop, receiver) {
                if (prop === Symbol.iterator) visited++;
                return Reflect.get(target, prop, receiver);
            }
        });

        const byChannel: Record<string, { category?: string }[] | undefined> = {
            'Canal A': spy(['Filme']),
            'Canal B': spy(['Esporte'])
        };
        mergeGuideGenres([], byChannel, scanned);
        expect(visited).toBe(2);

        // Terceiro canal chega: os dois primeiros NÃO podem ser varridos de novo.
        byChannel['Canal C'] = spy(['Infantil']);
        mergeGuideGenres(['Esporte', 'Filme'], byChannel, scanned);
        expect(visited).toBe(3);
    });

    it('canal ainda sem EPG (undefined) não entra no conjunto de varridos', () => {
        const scanned = new Set<string>();
        const byChannel: Record<string, { category?: string }[] | undefined> = { 'Canal A': undefined };
        expect(mergeGuideGenres([], byChannel, scanned)).toEqual([]);
        expect(scanned.has('Canal A')).toBe(false);

        byChannel['Canal A'] = programs('Show');
        expect(mergeGuideGenres([], byChannel, scanned)).toEqual(['Show']);
    });
});
