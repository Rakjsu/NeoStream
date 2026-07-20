import { describe, expect, it } from 'vitest';
import { moveInList, type QueuedItem } from './queueService';

const item = (id: string): QueuedItem => ({ id, name: `Filme ${id}`, addedAt: 1 });

describe('moveInList (item 30 — fila manual)', () => {
    const list = [item('a'), item('b'), item('c')];

    it('sobe e desce trocando de posição', () => {
        expect(moveInList(list, 'b', -1).map(i => i.id)).toEqual(['b', 'a', 'c']);
        expect(moveInList(list, 'b', 1).map(i => i.id)).toEqual(['a', 'c', 'b']);
    });

    it('bordas não se movem', () => {
        expect(moveInList(list, 'a', -1)).toBe(list);
        expect(moveInList(list, 'c', 1)).toBe(list);
    });

    it('id desconhecido não muda nada', () => {
        expect(moveInList(list, 'x', 1)).toBe(list);
    });
});
