/**
 * ❤️ Copiar favoritos de uma playlist para a ativa.
 *
 * Trocar de provedor é um beco sem saída hoje: os favoritos são guardados por
 * (perfil, playlist) — e têm que ser, porque `stream_id` não significa nada
 * fora do provedor que o emitiu; o mesmo número é um filme aqui e um desenho
 * ali (ver o cabeçalho de `activePlaylistService.ts`). O efeito é que quem
 * cadastra uma lista nova abre os Favoritos e encontra o vazio, com os antigos
 * intactos e inalcançáveis atrás da lista velha.
 *
 * Como o id não atravessa, o que atravessa é o NOME. Este módulo casa os
 * favoritos da lista de origem contra o catálogo da lista ativa por título
 * normalizado e devolve os mesmos itens com o id do provedor novo.
 *
 * ## Por que igualdade e não `fuzzyIncludes`
 *
 * O `fuzzyIncludes` do `catalogFilter.ts` existe para BUSCA, onde trazer
 * demais é bom: quem digita "matrix" quer ver "Matrix Reloaded" na lista e
 * escolhe com os olhos. Aqui não há olhos no meio — o casamento vira um
 * favorito gravado. `fuzzyIncludes('Matrix Reloaded', 'Matrix')` é `true`, e
 * usá-lo copiaria o filme errado sem ninguém perceber.
 *
 * Então a regra é igualdade do título normalizado, com o `normalizeSearchText`
 * do mesmo módulo — que já resolve o que precisa ser resolvido de verdade
 * entre provedores: caixa, acento e pontuação/separadores ("O Senhor dos
 * Anéis" ≡ "O SENHOR DOS ANEIS" ≡ "o-senhor-dos-aneis").
 *
 * O preço é não casar o que o outro provedor renomeou ("Matrix" vs "The
 * Matrix", nome com selo "[4K]" grudado). Esses saem na lista de não-casados,
 * que a tela mostra — um favorito de menos o usuário refaz em dois cliques; um
 * favorito ERRADO ele nem descobre.
 */

import { normalizeSearchText } from '../utils/catalogFilter';
import type { FavoriteItem, FavoriteType } from './favoritesService';

/** O mínimo que um item do catálogo destino precisa expor para ser casado. */
export interface AlvoDoCatalogo {
    id: string;
    name: string;
    poster?: string;
}

export interface ResultadoDaCopia {
    /** Prontos para gravar, já com o id do provedor NOVO. */
    copiar: FavoriteItem[];
    /** Não existem no catálogo ativo (ou existem com outro nome). */
    semPar: FavoriteItem[];
    /** Já estavam favoritados aqui — casaram, mas não há o que fazer. */
    jaEstavam: FavoriteItem[];
}

/**
 * Título normalizado → item. Em empate, o PRIMEIRO fica: provedor repete o
 * mesmo filme em qualidades diferentes ("Duna", "Duna" 4K), e como os dois
 * levam ao mesmo conteúdo, qualquer um serve — o que não pode é o resultado
 * mudar conforme a ordem em que o catálogo chegou, por isso a regra é escrita
 * e não acidental.
 */
export function indicePorTitulo(alvos: AlvoDoCatalogo[]): Map<string, AlvoDoCatalogo> {
    const indice = new Map<string, AlvoDoCatalogo>();
    for (const alvo of alvos) {
        const chave = normalizeSearchText(alvo.name ?? '');
        if (!chave) continue;
        if (!indice.has(chave)) indice.set(chave, alvo);
    }
    return indice;
}

export type IndicesDoCatalogo = Partial<Record<FavoriteType, Map<string, AlvoDoCatalogo>>>;

/**
 * @param origem favoritos da playlist antiga (lidos crus do localStorage)
 * @param indices um índice por tipo; tipo sem índice não casa nada
 * @param jaFavorito o `has` da playlist ativa
 */
export function casarFavoritos(
    origem: FavoriteItem[],
    indices: IndicesDoCatalogo,
    jaFavorito: (id: string, type: FavoriteType) => boolean,
): ResultadoDaCopia {
    const copiar: FavoriteItem[] = [];
    const semPar: FavoriteItem[] = [];
    const jaEstavam: FavoriteItem[] = [];
    // Dois favoritos da origem podem ter títulos que normalizam igual (o
    // provedor antigo também repetia o filme). Sem isto, os dois casariam com
    // o mesmo alvo e o segundo entraria como duplicata do primeiro.
    const jaCasados = new Set<string>();

    for (const favorito of origem) {
        const indice = indices[favorito.type];
        const chave = normalizeSearchText(favorito.title ?? '');
        const alvo = indice && chave ? indice.get(chave) : undefined;
        if (!alvo) {
            semPar.push(favorito);
            continue;
        }
        const identidade = `${favorito.type}:${alvo.id}`;
        if (jaFavorito(alvo.id, favorito.type) || jaCasados.has(identidade)) {
            jaEstavam.push(favorito);
            continue;
        }
        jaCasados.add(identidade);
        copiar.push({
            ...favorito,
            id: alvo.id,
            // Pôster do provedor NOVO: o do antigo costuma ser uma URL do
            // domínio dele, que some junto com a assinatura.
            poster: alvo.poster || favorito.poster,
            ...(favorito.type === 'series'
                ? { seriesId: Number(alvo.id) || undefined, streamId: undefined }
                : { streamId: Number(alvo.id) || undefined, seriesId: undefined }),
        });
    }

    return { copiar, semPar, jaEstavam };
}
