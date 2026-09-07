import { describe, it, expect } from 'vitest';
import { indicePorTitulo, casarFavoritos, type AlvoDoCatalogo } from './favoritesTransfer';
import type { FavoriteItem } from './favoritesService';

const favorito = (over: Partial<FavoriteItem> & Pick<FavoriteItem, 'id' | 'type' | 'title'>): FavoriteItem => ({
    poster: 'http://antigo.tv/capa.jpg',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...over,
});

const alvo = (id: string, name: string, poster?: string): AlvoDoCatalogo => ({ id, name, poster });

describe('indicePorTitulo', () => {
    it('normaliza caixa, acento e pontuação', () => {
        const indice = indicePorTitulo([alvo('7', 'O Senhor dos Anéis')]);
        expect(indice.get('o senhor dos aneis')?.id).toBe('7');
    });

    it('em título repetido, o primeiro fica', () => {
        // Provedor lista o mesmo filme em duas qualidades. Os dois levam ao
        // mesmo conteúdo; o que não pode é o resultado depender da ordem.
        const indice = indicePorTitulo([alvo('10', 'Duna'), alvo('11', 'DUNA')]);
        expect(indice.get('duna')?.id).toBe('10');
    });

    it('nome vazio não entra', () => {
        expect(indicePorTitulo([alvo('1', ''), alvo('2', '   ')]).size).toBe(0);
    });
});

describe('casarFavoritos', () => {
    const catalogoDeFilmes = indicePorTitulo([
        alvo('900', 'Matrix', 'http://novo.tv/matrix.jpg'),
        alvo('901', 'Matrix Reloaded'),
        alvo('902', 'O Senhor dos Aneis'),
    ]);
    const catalogoDeSeries = indicePorTitulo([alvo('500', 'Chernobyl')]);
    const indices = { movie: catalogoDeFilmes, series: catalogoDeSeries };
    const nada = () => false;

    it('leva o favorito para o id do provedor novo', () => {
        const { copiar } = casarFavoritos(
            [favorito({ id: '123', type: 'movie', title: 'matrix' })],
            indices,
            nada,
        );
        expect(copiar).toHaveLength(1);
        expect(copiar[0].id).toBe('900');
        expect(copiar[0].streamId).toBe(900);
        // O pôster antigo apontava para o domínio do provedor que o usuário
        // acabou de trocar — some junto com a assinatura.
        expect(copiar[0].poster).toBe('http://novo.tv/matrix.jpg');
    });

    it('NÃO casa "Matrix" com "Matrix Reloaded"', () => {
        // O caso que proíbe usar fuzzyIncludes aqui: ele diria que sim, e o
        // usuário ganharia um favorito que nunca escolheu.
        const { copiar } = casarFavoritos(
            [favorito({ id: '1', type: 'movie', title: 'Matrix' })],
            { movie: indicePorTitulo([alvo('901', 'Matrix Reloaded')]) },
            nada,
        );
        expect(copiar).toHaveLength(0);
    });

    it('acento e caixa não separam o mesmo título', () => {
        const { copiar } = casarFavoritos(
            [favorito({ id: '1', type: 'movie', title: 'O SENHOR DOS ANÉIS' })],
            indices,
            nada,
        );
        expect(copiar[0]?.id).toBe('902');
    });

    it('série casa pelo índice de séries e ganha seriesId', () => {
        const { copiar } = casarFavoritos(
            [favorito({ id: '9', type: 'series', title: 'Chernobyl', seriesId: 9 })],
            indices,
            nada,
        );
        expect(copiar[0].id).toBe('500');
        expect(copiar[0].seriesId).toBe(500);
        expect(copiar[0].streamId).toBeUndefined();
    });

    it('o que o provedor novo não tem sai como sem par', () => {
        const { copiar, semPar } = casarFavoritos(
            [favorito({ id: '1', type: 'movie', title: 'Filme Que Só Existe Lá' })],
            indices,
            nada,
        );
        expect(copiar).toHaveLength(0);
        expect(semPar.map(f => f.title)).toEqual(['Filme Que Só Existe Lá']);
    });

    it('tipo sem catálogo não casa — não vira sucesso silencioso', () => {
        // Favorito de CANAL com o índice de canais ausente (a tela pode não ter
        // conseguido buscar os canais). O certo é sair como não-casado.
        const { copiar, semPar } = casarFavoritos(
            [favorito({ id: '1', type: 'channel', title: 'Matrix' })],
            indices,
            nada,
        );
        expect(copiar).toHaveLength(0);
        expect(semPar).toHaveLength(1);
    });

    it('o que já está favoritado aqui não duplica', () => {
        const { copiar, jaEstavam } = casarFavoritos(
            [favorito({ id: '123', type: 'movie', title: 'Matrix' })],
            indices,
            (id, type) => id === '900' && type === 'movie',
        );
        expect(copiar).toHaveLength(0);
        expect(jaEstavam).toHaveLength(1);
    });

    it('dois favoritos da origem que apontam para o mesmo alvo entram uma vez só', () => {
        // A lista velha também repetia o filme ("Matrix" e "MATRIX"): sem
        // trava, os dois casariam com o id 900 e o segundo entraria duplicado.
        const { copiar, jaEstavam } = casarFavoritos(
            [
                favorito({ id: '1', type: 'movie', title: 'Matrix' }),
                favorito({ id: '2', type: 'movie', title: 'MATRIX' }),
            ],
            indices,
            nada,
        );
        expect(copiar).toHaveLength(1);
        expect(jaEstavam).toHaveLength(1);
    });

    it('preserva o resto do favorito (inclusive quando foi salvo)', () => {
        const { copiar } = casarFavoritos(
            [favorito({ id: '1', type: 'movie', title: 'Matrix', rating: '8.7', year: '1999' })],
            indices,
            nada,
        );
        expect(copiar[0]).toMatchObject({ rating: '8.7', year: '1999', addedAt: '2026-01-01T00:00:00.000Z' });
    });

    it('origem vazia devolve tudo vazio', () => {
        expect(casarFavoritos([], indices, nada)).toEqual({ copiar: [], semPar: [], jaEstavam: [] });
    });
});
