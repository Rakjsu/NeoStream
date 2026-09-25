import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fonteDaHome from '../pages/Home.tsx?raw';

/**
 * D059 — a chave de nome que decide o que o perfil Infantil pode ver tem UM
 * dono: `normalizeContentName` (services/contentGate). O store de ocultos e
 * de classificação (indexedDBCache) e a Home (clique barrado e card que some)
 * tinham cada um a sua cópia do mesmo corpo; se uma delas mudasse, `hideItem`
 * gravaria uma chave e o portão procuraria outra — o título escondido
 * voltaria a aparecer para a criança.
 *
 * O mock abaixo troca a regra do dono por uma marcada. Quem normaliza por
 * conta própria não enxerga a troca e reprova o teste.
 */
vi.mock('./contentGate', async (importOriginal) => {
    const real = await importOriginal<typeof import('./contentGate')>();
    return {
        ...real,
        normalizeContentName: (name: string) => `dono:${real.normalizeContentName(name)}`,
    };
});

import { indexedDBCache } from './indexedDBCache';

/** Fontes de produção do src/ como texto — `?raw` do próprio Vite. */
const fontes = import.meta.glob(
    ['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../**/*.test.tsx'],
    { query: '?raw', import: 'default', eager: true }
) as Record<string, string>;

/** O Vite pode chavear o próprio diretório como './x.ts' ou '../services/x.ts'. */
const ehArquivo = (nome: string) => (caminho: string) => new RegExp(`(^|/)${nome}\\.tsx?$`).test(caminho);
const ehODono = ehArquivo('contentGate');
const ehOStore = ehArquivo('indexedDBCache');

/** Importa o store de ocultos/classificação ou o portão: participa da chave. */
const IMPORTA_O_PORTAO = /from\s+['"][./]*(?:services\/)?(?:indexedDBCache|contentGate)['"]/;

/** Corpo da regra, sem o nome da função: pega cópia com qualquer nome. */
const CORPO = ".toLowerCase().trim().replace(/[^a-z0-9\\s]/gi, '').replace(/\\s+/g, ' ')";

describe('chave de nome do portão infantil tem dono único (contentGate)', () => {
    beforeEach(async () => {
        await indexedDBCache.clearAll();
        await indexedDBCache.clearHiddenItems();
    });

    it('hideItem/isItemHidden/unhideItem/getHiddenItems usam a regra do contentGate', async () => {
        await indexedDBCache.hideItem('movie', 'Filme: Adulto!');

        expect(await indexedDBCache.getHiddenItems('movie')).toEqual(['dono:filme adulto']);
        expect(await indexedDBCache.isItemHidden('movie', 'FILME ADULTO')).toBe(true);
        expect(await indexedDBCache.isItemHidden('series', 'FILME ADULTO')).toBe(false);

        await indexedDBCache.unhideItem('movie', 'filme   adulto');
        expect(await indexedDBCache.getHiddenItems('movie')).toEqual([]);
    });

    it('o cache de classificação de filme usa a mesma chave que o portão consulta', async () => {
        await indexedDBCache.setCacheMovie('Filme: Tal!', '18', []);

        const mapa = await indexedDBCache.getAllCachedMovies();
        expect([...mapa.keys()]).toEqual(['dono:filme tal']);
        expect((await indexedDBCache.getCachedMovie('FILME TAL'))?.certification).toBe('18');
    });

    it('o cache de classificação de série usa a mesma chave que o portão consulta', async () => {
        await indexedDBCache.setCacheSeries('Série Tal', '16', []);

        const mapa = await indexedDBCache.getAllCachedSeries();
        expect([...mapa.keys()]).toEqual(['dono:srie tal']);
        expect((await indexedDBCache.getCachedSeries('série tal'))?.certification).toBe('16');
    });

    it('quem participa do portão não reescreve nem sombreia a normalização', () => {
        const participantes = Object.entries(fontes)
            .filter(([caminho, fonte]) => !ehODono(caminho) && (ehOStore(caminho) || IMPORTA_O_PORTAO.test(fonte)));

        // Store, Home e os hooks/telas que filtram pelo portão: a lista não
        // pode esvaziar por um glob ou uma regex de import que parou de casar.
        const nomes = participantes.map(([caminho]) => caminho);
        expect(nomes.some(ehOStore)).toBe(true);
        expect(nomes.some(ehArquivo('Home'))).toBe(true);
        expect(nomes.some(ehArquivo('useContentFiltering'))).toBe(true);

        const copias = participantes
            .filter(([, fonte]) => {
                const codigo = fonte.replace(/\r\n/g, '\n');
                return codigo.includes(CORPO) || /(?:const|let|var|function)\s+normalizeContentName\b/.test(codigo);
            })
            .map(([caminho]) => caminho);

        expect(copias).toEqual([]);

        // E o próprio dono escreve a regra UMA vez: o portão
        // (`isItemVisibleUnderGate`) chama `normalizeContentName`, não uma
        // cópia inline dela.
        const dono = Object.entries(fontes).filter(([caminho]) => ehODono(caminho));
        expect(dono).toHaveLength(1);
        expect(dono[0][1].replace(/\r\n/g, '\n').split(CORPO).length - 1).toBe(1);
    });

    it('a Home monta a chave do clique e do card escondido com o dono', () => {
        const home = fonteDaHome.replace(/\r\n/g, '\n');
        expect(home.includes("import { normalizeContentName } from '../services/contentGate';")).toBe(true);
        expect(home.includes('const itemKey = `${contentType}_${normalizeContentName(name)}`;')).toBe(true);
        expect(home.includes('hiddenItems.has(`${alvo.kind}_${normalizeContentName(alvo.name)}`)')).toBe(true);
    });
});
