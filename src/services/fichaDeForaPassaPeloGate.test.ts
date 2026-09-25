import { describe, it, expect } from 'vitest';
import { fichaLiberada } from './abrirFicha';
import { isItemVisibleUnderGate, type ContentGateState } from './contentGate';
import fonteVOD from '../pages/VOD.tsx?raw';
import fonteSeries from '../pages/Series.tsx?raw';

/**
 * 🔒 D160 — a ficha aberta "de fora" ignorava o controle parental.
 *
 * A grade de VOD/Séries só desenha o que passa por `isItemVisible`, mas ela NÃO
 * é o único emissor de id: a busca global (Ctrl+K), os "Parecidos" e a
 * filmografia do ator dentro da própria ficha, e o aviso de novos episódios
 * gravam um id em `GLOBAL_SEARCH_OPEN_KEY` e navegam. A página de destino
 * resolvia esse id na lista CRUA (`streams.find` / `series.find`) e chamava
 * `setSelectedMovie`/`setSelectedSeries` direto — sem gate nenhum. Clicar num
 * "Parecido" abria a ficha completa (sinopse, elenco, botão de Reproduzir) de
 * um título que a grade esconde.
 *
 * O invariante tem duas pontas e este arquivo prende as duas:
 *
 *  1. COMPORTAMENTAL — `fichaLiberada` recusa o id quando o gate REAL
 *     (`isItemVisibleUnderGate`, o mesmo que a grade usa) esconde o título, e
 *     devolve o item quando não esconde. Sem dublê de regra: a regra é a de
 *     verdade.
 *  2. ESTRUTURAL — as duas páginas resolvem o pedido POR ESSA função, passando
 *     o `isItemVisible` da grade, em vez de fazer `.find` na lista crua. Sem
 *     esta ponta a correção some no dia em que alguém "simplificar" o efeito.
 */

interface Filme { stream_id: number; name: string; category_id: string }

const DESENHO: Filme = { stream_id: 1, name: 'Desenho do Pintinho', category_id: '1' };
const ADULTO: Filme = { stream_id: 2, name: 'Filme Proibido', category_id: '99' };
const DEZOITO: Filme = { stream_id: 3, name: 'Filme Dezoito', category_id: '1' };
const CATALOGO: Filme[] = [DESENHO, ADULTO, DEZOITO];

const idDoFilme = (f: Filme) => f.stream_id;

const PARENTAL_TRAVADO: ContentGateState = {
    isKidsProfile: false,
    parentalEnabled: true,
    blockAdultCategories: true,
    sessionUnlocked: false,
};

const INFANTIL: ContentGateState = {
    isKidsProfile: true,
    parentalEnabled: false,
    blockAdultCategories: false,
    sessionUnlocked: false,
};

/**
 * O gate REAL da grade, montado como a página monta: a categoria '99' é a
 * adulta, "filme dezoito" está classificado 18 no cache do TMDB e o parental
 * veta 18.
 */
function gateDaGrade(state: ContentGateState, opcoes: {
    categoriasBloqueadas?: string[];
    ocultos?: string[];
} = {}) {
    return (f: Filme) => isItemVisibleUnderGate({
        categoryIds: [f.category_id],
        name: f.name,
        blockedCategoryIds: new Set(opcoes.categoriasBloqueadas ?? ['99']),
        hiddenNames: new Set(opcoes.ocultos ?? []),
        cachedRatings: new Map([['filme dezoito', '18']]),
        isRatingBlocked: rating => rating === '18',
        state,
    });
}

describe('D160: o id vindo de fora da grade passa pelo gate da grade', () => {
    it('categoria adulta: a grade esconde, então o "Parecido" NÃO abre a ficha', () => {
        const gate = gateDaGrade(PARENTAL_TRAVADO);

        // Ponta de fato: é um título que a grade esconde.
        expect(gate(ADULTO)).toBe(false);

        expect(fichaLiberada('2', CATALOGO, idDoFilme, gate)).toBeNull();
    });

    it('classificação vetada em cache: nem com a TMDB fora do ar a ficha abre', () => {
        const gate = gateDaGrade(PARENTAL_TRAVADO);

        expect(gate(DEZOITO)).toBe(false);

        expect(fichaLiberada('3', CATALOGO, idDoFilme, gate)).toBeNull();
    });

    it('título oculto no perfil infantil também não abre de fora', () => {
        const gate = gateDaGrade(INFANTIL, { ocultos: ['filme proibido'] });

        expect(fichaLiberada('2', CATALOGO, idDoFilme, gate)).toBeNull();
    });

    it('o título que a grade MOSTRA continua abrindo (não é bloqueio geral)', () => {
        const gate = gateDaGrade(PARENTAL_TRAVADO);

        expect(fichaLiberada('1', CATALOGO, idDoFilme, gate)).toBe(DESENHO);
    });

    it('com o PIN da sessão destravado o mesmo id volta a abrir', () => {
        // Destravado, a página monta o conjunto de categorias bloqueadas VAZIO.
        const gate = gateDaGrade(
            { ...PARENTAL_TRAVADO, sessionUnlocked: true },
            { categoriasBloqueadas: [] }
        );

        expect(fichaLiberada('2', CATALOGO, idDoFilme, gate)).toBe(ADULTO);
    });

    it('id que não está no catálogo carregado continua não abrindo nada', () => {
        expect(fichaLiberada('404', CATALOGO, idDoFilme, () => true)).toBeNull();
    });

    it('o id do Xtream chega número no catálogo e string no pedido', () => {
        // Sem a normalização, 2 === '2' é falso e NENHUMA ficha abriria —
        // inclusive as legítimas.
        expect(fichaLiberada('2', CATALOGO, idDoFilme, () => true)).toBe(ADULTO);
    });
});

/**
 * Corpo do efeito que consome o pedido de abertura vindo de outra tela, SEM os
 * comentários. O comentário ao lado do gate cita `isItemVisible` pelo nome —
 * deixá-lo dentro fazia a asserção passar com um `() => true` no lugar do gate.
 */
function efeitoDaFichaPendente(fonte: string, dep: string): string {
    const texto = fonte.replace(/\r\n/g, '\n');
    const inicio = texto.indexOf('if (!pendingOpenId');
    expect(inicio).toBeGreaterThan(-1);
    const fim = texto.indexOf(`}, [pendingOpenId, ${dep}]);`, inicio);
    expect(fim).toBeGreaterThan(inicio);
    return texto.slice(inicio, fim)
        .split('\n')
        .filter(linha => !linha.trim().startsWith('//'))
        .join('\n');
}

describe('D160: as páginas resolvem a ficha pendente pelo gate, não na lista crua', () => {
    it('VOD.tsx passa o isItemVisible da grade para fichaLiberada', () => {
        const efeito = efeitoDaFichaPendente(fonteVOD, 'streams');
        expect(efeito.includes('fichaLiberada(')).toBe(true);
        // O gate TEM que ser o da grade; um `() => true` no lugar seria um
        // portão pintado na parede.
        expect(efeito.includes('isItemVisible')).toBe(true);
        // E o caminho cru não pode voltar por baixo.
        expect(efeito.includes('streams.find(')).toBe(false);
    });

    it('Series.tsx passa o isItemVisible da grade para fichaLiberada', () => {
        const efeito = efeitoDaFichaPendente(fonteSeries, 'series');
        expect(efeito.includes('fichaLiberada(')).toBe(true);
        expect(efeito.includes('isItemVisible')).toBe(true);
        expect(efeito.includes('series.find(')).toBe(false);
    });
});
