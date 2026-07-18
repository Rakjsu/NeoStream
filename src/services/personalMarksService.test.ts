import { describe, it, expect, beforeEach } from 'vitest';
import { allTags, getMark, setRating, toggleTag } from './personalMarksService';

describe('personalMarksService (nota + tags pessoais)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('nota 1–5 persiste; 0 limpa; fora da faixa também limpa', () => {
        setRating('movie', '10', 4);
        expect(getMark('movie', '10').rating).toBe(4);
        setRating('movie', '10', 0);
        expect(getMark('movie', '10').rating).toBeUndefined();
        setRating('movie', '10', 9);
        expect(getMark('movie', '10').rating).toBeUndefined();
    });

    it('toggleTag adiciona, remove (case-insensitive) e apara o texto', () => {
        expect(toggleTag('series', '7', '  Maratona  ')).toEqual(['Maratona']);
        expect(getMark('series', '7').tags).toEqual(['Maratona']);
        expect(toggleTag('series', '7', 'maratona')).toEqual([]);
        expect(getMark('series', '7').tags).toBeUndefined();
        expect(toggleTag('series', '7', '   ')).toEqual([]);
    });

    it('entrada some do storage quando fica sem nota e sem tags', () => {
        setRating('movie', '1', 5);
        toggleTag('movie', '1', 'top');
        setRating('movie', '1', 0);
        expect(getMark('movie', '1').tags).toEqual(['top']);
        toggleTag('movie', '1', 'top');
        expect(localStorage.getItem('neostream_personal_marks')).toBe('{}');
    });

    it('marcas de filme e série com o mesmo id não se misturam', () => {
        setRating('movie', '42', 2);
        setRating('series', '42', 5);
        expect(getMark('movie', '42').rating).toBe(2);
        expect(getMark('series', '42').rating).toBe(5);
    });

    it('allTags junta tudo sem duplicar (case-insensitive) em ordem alfabética', () => {
        toggleTag('movie', '1', 'Zumbi');
        toggleTag('series', '2', 'ação');
        toggleTag('movie', '3', 'ZUMBI');
        expect(allTags()).toEqual(['ação', 'Zumbi']);
    });
});
