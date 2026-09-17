import { describe, expect, it, beforeEach, vi } from 'vitest';
import { CATALOG_REFRESH_EVENT } from './catalogRefreshService';
import { getCatalogTitleIndex, resetCatalogTitleIndex } from './catalogTitleIndex';

/**
 * 🔗 O índice título→id do catálogo é buscado UMA vez por sessão.
 *
 * Ele existe só pra ficha saber quais "Parecidos" e quais títulos da
 * filmografia existem no app. Morava no estado do `ContentDetailModal`, que é
 * remontado a cada abertura — então cada ficha com seção TMDB arrastava as
 * duas listas inteiras do main pro renderer de novo.
 */
const invoke = vi.fn();

function catalogo(vod: { stream_id: number; name: string }[], series: { series_id: number; name: string }[]) {
    invoke.mockImplementation((canal: string) => {
        if (canal === 'streams:get-vod') return Promise.resolve({ success: true, data: vod });
        if (canal === 'streams:get-series') return Promise.resolve({ success: true, data: series });
        return Promise.resolve(null);
    });
}

beforeEach(() => {
    invoke.mockReset();
    resetCatalogTitleIndex();
    (window as unknown as { ipcRenderer: { invoke: typeof invoke } }).ipcRenderer = { invoke };
});

describe('getCatalogTitleIndex', () => {
    it('indexa por título normalizado, e o primeiro id vence na duplicata', async () => {
        catalogo(
            [{ stream_id: 1, name: 'Matrix' }, { stream_id: 2, name: 'MATRIX [DUB]' }],
            [{ series_id: 9, name: 'Dark' }],
        );
        const index = await getCatalogTitleIndex();
        expect(index.vod.get('matrix')).toBe('1');
        expect(index.series.get('dark')).toBe('9');
    });

    it('abrir a ficha de novo NÃO relê o catálogo', async () => {
        catalogo([{ stream_id: 1, name: 'Matrix' }], []);
        const primeira = await getCatalogTitleIndex();
        const segunda = await getCatalogTitleIndex();
        // 2 = um get-vod + um get-series, a busca única da sessão.
        expect(invoke).toHaveBeenCalledTimes(2);
        expect(segunda).toBe(primeira);
    });

    it('duas fichas ao mesmo tempo dividem a mesma busca', async () => {
        catalogo([{ stream_id: 1, name: 'Matrix' }], []);
        const [a, b] = await Promise.all([getCatalogTitleIndex(), getCatalogTitleIndex()]);
        expect(invoke).toHaveBeenCalledTimes(2);
        expect(a).toBe(b);
    });

    it('o refresh do catálogo invalida o índice', async () => {
        catalogo([{ stream_id: 1, name: 'Matrix' }], []);
        await getCatalogTitleIndex();
        window.dispatchEvent(new Event(CATALOG_REFRESH_EVENT));
        catalogo([{ stream_id: 1, name: 'Matrix' }, { stream_id: 3, name: 'Duna' }], []);
        const depois = await getCatalogTitleIndex();
        expect(invoke).toHaveBeenCalledTimes(4);
        expect(depois.vod.get('duna')).toBe('3');
    });

    it('catálogo vazio (provedor fora do ar) não envenena a sessão', async () => {
        // Sem esta guarda, um hiccup de rede tirava "Parecidos" do resto da
        // sessão — regressão que o próprio cache teria introduzido.
        invoke.mockResolvedValue({ success: false });
        const vazio = await getCatalogTitleIndex();
        expect(vazio.vod.size).toBe(0);

        catalogo([{ stream_id: 1, name: 'Matrix' }], []);
        const depois = await getCatalogTitleIndex();
        expect(depois.vod.get('matrix')).toBe('1');
    });
});
