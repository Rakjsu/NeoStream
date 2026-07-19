import { describe, it, expect } from 'vitest';
import { clampBoost, cycleAbState, abLoopTarget, previewBucket, previewSeekTarget } from './playerExtras';

describe('playerExtras — volume boost', () => {
    it('clampBoost limita a 100%–300% e sanitiza lixo', () => {
        expect(clampBoost(1)).toBe(1);
        expect(clampBoost(2.5)).toBe(2.5);
        expect(clampBoost(0.2)).toBe(1);
        expect(clampBoost(9)).toBe(3);
        expect(clampBoost(NaN)).toBe(1);
    });
});

describe('playerExtras — repetição A-B', () => {
    it('cicla vazio → A → A-B → limpo', () => {
        const empty = { a: null, b: null };
        const withA = cycleAbState(empty, 10);
        expect(withA).toEqual({ a: 10, b: null });
        const withB = cycleAbState(withA, 25);
        expect(withB).toEqual({ a: 10, b: 25 });
        expect(cycleAbState(withB, 99)).toEqual(empty);
    });

    it('marcar B antes de A apenas re-marca A', () => {
        const withA = cycleAbState({ a: null, b: null }, 30);
        expect(cycleAbState(withA, 12)).toEqual({ a: 12, b: null });
    });

    it('abLoopTarget só pula com A e B marcados e tempo além de B', () => {
        expect(abLoopTarget(50, { a: null, b: null })).toBeNull();
        expect(abLoopTarget(50, { a: 10, b: null })).toBeNull();
        expect(abLoopTarget(20, { a: 10, b: 25 })).toBeNull();
        expect(abLoopTarget(25, { a: 10, b: 25 })).toBe(10);
        expect(abLoopTarget(999, { a: 10, b: 25 })).toBe(10);
    });
});

describe('preview da barra (item 31)', () => {
    it('agrupa o hover em janelas de 10s', () => {
        expect(previewBucket(0)).toBe(0);
        expect(previewBucket(59.9)).toBe(5);
        expect(previewBucket(60)).toBe(6);
    });

    it('tempo inválido ou negativo vira -1', () => {
        expect(previewBucket(-3)).toBe(-1);
        expect(previewBucket(NaN)).toBe(-1);
    });

    it('o seek mira o meio da janela', () => {
        expect(previewSeekTarget(0)).toBe(5);
        expect(previewSeekTarget(6)).toBe(65);
    });
});
