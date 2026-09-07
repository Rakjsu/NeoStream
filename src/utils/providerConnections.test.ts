import { describe, it, expect } from 'vitest';
import { lerMaxConexoes, limiteEfetivoDeDownloads } from './providerConnections';

describe('lerMaxConexoes', () => {
    it('lê o formato que os painéis Xtream mandam de verdade: string', () => {
        expect(lerMaxConexoes({ max_connections: '1' })).toBe(1);
        expect(lerMaxConexoes({ max_connections: '3' })).toBe(3);
    });

    it('lê também quando vem como número', () => {
        expect(lerMaxConexoes({ max_connections: 2 })).toBe(2);
    });

    it('"sem limite" vira null, não zero', () => {
        // Painel que não impõe limite manda "0" ou "unlimited". Zero como TETO
        // travaria a fila inteira; null quer dizer "não sei" e deixa a escolha
        // do usuário valer.
        expect(lerMaxConexoes({ max_connections: '0' })).toBeNull();
        expect(lerMaxConexoes({ max_connections: 'unlimited' })).toBeNull();
        expect(lerMaxConexoes({ max_connections: '-2' })).toBeNull();
    });

    it('campo ausente ou payload estranho vira null', () => {
        expect(lerMaxConexoes({})).toBeNull();
        expect(lerMaxConexoes(null)).toBeNull();
        expect(lerMaxConexoes(undefined)).toBeNull();
        expect(lerMaxConexoes('user_info')).toBeNull();
        expect(lerMaxConexoes({ max_connections: null })).toBeNull();
        expect(lerMaxConexoes({ max_connections: {} })).toBeNull();
    });

    it('fracionário desce para o inteiro', () => {
        expect(lerMaxConexoes({ max_connections: '2.9' })).toBe(2);
    });
});

describe('limiteEfetivoDeDownloads', () => {
    it('o provedor manda quando é mais apertado', () => {
        expect(limiteEfetivoDeDownloads(4, 1)).toBe(1);
        expect(limiteEfetivoDeDownloads(3, 2)).toBe(2);
    });

    it('a escolha do usuário manda quando é mais apertada', () => {
        expect(limiteEfetivoDeDownloads(1, 4)).toBe(1);
        expect(limiteEfetivoDeDownloads(2, 10)).toBe(2);
    });

    it('provedor desconhecido não limita nada', () => {
        expect(limiteEfetivoDeDownloads(4, null)).toBe(4);
    });

    it('nunca desce abaixo de 1 — fila parada não é limite, é bug', () => {
        expect(limiteEfetivoDeDownloads(0, 2)).toBe(1);
        expect(limiteEfetivoDeDownloads(Number.NaN, null)).toBe(1);
        expect(limiteEfetivoDeDownloads(-5, null)).toBe(1);
    });
});
