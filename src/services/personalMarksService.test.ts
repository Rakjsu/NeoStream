import { describe, it, expect, beforeEach } from 'vitest';
import { allTags, getMark, idsComTag, setRating, toggleTag, ratingSignals } from './personalMarksService';

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

    it('ratingSignals separa amados (4-5, melhores primeiro) de rejeitados (1-2)', () => {
        setRating('movie', 'm4', 4);
        setRating('movie', 'm5', 5);
        setRating('series', 's1', 1);
        setRating('movie', 'm3', 3);
        const { loved, disliked } = ratingSignals();
        expect(loved).toEqual([
            { type: 'movie', id: 'm5', rating: 5 },
            { type: 'movie', id: 'm4', rating: 4 },
        ]);
        expect(disliked).toEqual([{ type: 'series', id: 's1' }]);
    });
});

describe('idsComTag (o filtro da grade)', () => {
    beforeEach(() => localStorage.clear());

    // As tags eram só de escrita: dava pra marcar "Cult" na ficha e não havia
    // lugar nenhum que filtrasse por isso.
    it('devolve as chaves type:id de quem tem a tag', () => {
        toggleTag('movie', '1', 'Cult');
        toggleTag('movie', '2', 'Ação');
        toggleTag('series', '9', 'Cult');
        expect([...idsComTag('Cult')].sort()).toEqual(['movie:1', 'series:9']);
    });

    // Mesma regra do toggleTag: quem escreveu "Cult" e "cult" marcou a mesma
    // coisa, e o select mostra só uma das duas grafias.
    it('não diferencia maiúsculas nem espaços em volta', () => {
        toggleTag('movie', '3', 'Cult');
        expect([...idsComTag('  cULt  ')]).toEqual(['movie:3']);
    });

    it('tag desconhecida e tag vazia devolvem conjunto vazio', () => {
        toggleTag('movie', '4', 'Cult');
        expect(idsComTag('nada disso').size).toBe(0);
        expect(idsComTag('').size).toBe(0);
        expect(idsComTag('   ').size).toBe(0);
    });

    it('item que perdeu a tag sai do conjunto', () => {
        toggleTag('movie', '5', 'Cult');
        expect(idsComTag('Cult').has('movie:5')).toBe(true);
        toggleTag('movie', '5', 'Cult'); // toggle: tira
        expect(idsComTag('Cult').has('movie:5')).toBe(false);
    });

    it('storage vazio não quebra', () => {
        localStorage.clear();
        expect(idsComTag('Cult').size).toBe(0);
    });
});
