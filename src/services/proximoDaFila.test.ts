import { describe, it, expect } from 'vitest';
import { proximoDaFila } from './proximoDaFila';

interface Filme { id: string; nome: string; bloqueado?: boolean }

const catalogo: Filme[] = [
    { id: '1', nome: 'Desenho' },
    { id: '2', nome: 'Terror', bloqueado: true },
    { id: '3', nome: 'Comédia' },
];
const achar = (id: string) => catalogo.find(f => f.id === id);
const visivel = (f: Filme) => !f.bloqueado;
const tudoVisivel = () => true;

describe('proximoDaFila', () => {
    it('a fila manual vem antes do "Ver depois"', () => {
        const r = proximoDaFila('9', { id: '3' }, [{ id: '1', type: 'movie' }], achar, tudoVisivel);
        expect(r?.nome).toBe('Comédia');
    });

    it('filme bloqueado na fila MANUAL não é oferecido — era o furo', () => {
        // A fila manual pode ser abastecida pela ficha ou pelo celular, sem
        // PIN nenhum: entrar na fila não podia ser um passe livre pelo gate.
        const r = proximoDaFila('9', { id: '2' }, [], achar, visivel);
        expect(r).toBeNull();
    });

    it('bloqueado na fila manual cai para o próximo visível do "Ver depois"', () => {
        const r = proximoDaFila('9', { id: '2' }, [{ id: '1', type: 'movie' }], achar, visivel);
        expect(r?.nome).toBe('Desenho');
    });

    it('filme bloqueado no "Ver depois" continua fora (comportamento que já existia)', () => {
        const r = proximoDaFila('9', null, [{ id: '2', type: 'movie' }, { id: '3', type: 'movie' }], achar, visivel);
        expect(r?.nome).toBe('Comédia');
    });

    it('o filme que acabou de tocar não se repete', () => {
        const r = proximoDaFila('1', null, [{ id: '1', type: 'movie' }], achar, visivel);
        expect(r).toBeNull();
    });

    it('série na lista do "Ver depois" não entra na fila de filmes', () => {
        const r = proximoDaFila('9', null, [{ id: '1', type: 'series' }], achar, visivel);
        expect(r).toBeNull();
    });

    it('item da fila que não está no catálogo carregado é pulado', () => {
        const r = proximoDaFila('9', { id: '404' }, [{ id: '3', type: 'movie' }], achar, visivel);
        expect(r?.nome).toBe('Comédia');
    });

    it('fila vazia devolve null', () => {
        expect(proximoDaFila('9', null, [], achar, visivel)).toBeNull();
    });
});
