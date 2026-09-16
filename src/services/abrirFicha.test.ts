import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pedirAberturaDeFicha, rotaDaFicha } from './abrirFicha';
import { GLOBAL_SEARCH_OPEN_KEY, GLOBAL_SEARCH_EVENT } from '../components/GlobalSearch';

describe('rotaDaFicha', () => {
    it('cada tipo tem a sua grade', () => {
        expect(rotaDaFicha('series')).toBe('/dashboard/series');
        expect(rotaDaFicha('vod')).toBe('/dashboard/vod');
    });
});

describe('pedirAberturaDeFicha', () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    it('deixa o pedido no canal que a página de destino consome', () => {
        // O aviso de nova temporada navegava para "?id=123", e a página de
        // Séries não lê a query — a série avisada nunca abria.
        const rota = pedirAberturaDeFicha('series', 123);
        expect(rota).toBe('/dashboard/series');
        expect(JSON.parse(sessionStorage.getItem(GLOBAL_SEARCH_OPEN_KEY)!)).toEqual({ kind: 'series', id: '123' });
    });

    it('id numérico vira string — a página compara com String(open.id)', () => {
        pedirAberturaDeFicha('vod', 66);
        expect(JSON.parse(sessionStorage.getItem(GLOBAL_SEARCH_OPEN_KEY)!).id).toBe('66');
    });

    it('avisa quem já está na página (senão o pedido fica esperando a próxima visita)', () => {
        const ouvinte = vi.fn();
        window.addEventListener(GLOBAL_SEARCH_EVENT, ouvinte);
        pedirAberturaDeFicha('series', 7);
        expect(ouvinte).toHaveBeenCalledTimes(1);
        window.removeEventListener(GLOBAL_SEARCH_EVENT, ouvinte);
    });

    it('sem sessionStorage a navegação ainda acontece', () => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = () => { throw new Error('janela anônima'); };
        try {
            expect(pedirAberturaDeFicha('series', 1)).toBe('/dashboard/series');
        } finally {
            Storage.prototype.setItem = original;
        }
    });
});
