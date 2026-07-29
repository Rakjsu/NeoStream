import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readJson, resetStorageJsonCache } from './storageJsonCache';

const KEY = 'bloco_de_teste';

function countParses<T>(run: () => T): { result: T; parses: number } {
    const spy = vi.spyOn(JSON, 'parse');
    try {
        const result = run();
        return { result, parses: spy.mock.calls.length };
    } finally {
        spy.mockRestore();
    }
}

describe('storageJsonCache', () => {
    beforeEach(() => {
        localStorage.clear();
        resetStorageJsonCache();
    });
    afterEach(() => vi.restoreAllMocks());

    it('parseia UMA vez por texto, mesmo com dezenas de leituras', () => {
        localStorage.setItem(KEY, JSON.stringify([{ id: 'a' }, { id: 'b' }]));

        const { parses } = countParses(() => {
            for (let i = 0; i < 60; i++) readJson<unknown[]>(KEY, []);
        });

        expect(parses).toBe(1);
    });

    it('devolve a MESMA referência enquanto o texto não muda (deps de useMemo)', () => {
        localStorage.setItem(KEY, JSON.stringify([1, 2, 3]));
        const first = readJson<number[]>(KEY, []);
        expect(readJson<number[]>(KEY, [])).toBe(first);
    });

    it('escrita de fora (sync/restauração) invalida sozinha — sem chamar nada', () => {
        localStorage.setItem(KEY, JSON.stringify([1]));
        const first = readJson<number[]>(KEY, []);

        localStorage.setItem(KEY, JSON.stringify([1, 2]));
        const second = readJson<number[]>(KEY, []);

        expect(second).not.toBe(first);
        expect(second).toEqual([1, 2]);
    });

    it('chave ausente devolve o fallback recebido (novo a cada chamada)', () => {
        const fallbackA: number[] = [];
        const fallbackB: number[] = [];
        expect(readJson(KEY, fallbackA)).toBe(fallbackA);
        expect(readJson(KEY, fallbackB)).toBe(fallbackB);
    });

    it('JSON inválido devolve o fallback e não fica cacheado', () => {
        localStorage.setItem(KEY, '{quebrado');
        expect(readJson<number[]>(KEY, [])).toEqual([]);

        localStorage.setItem(KEY, JSON.stringify([7]));
        expect(readJson<number[]>(KEY, [])).toEqual([7]);
    });
});
