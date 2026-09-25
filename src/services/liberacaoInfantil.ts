import { isKidsFriendly } from './tmdb';
import { indexedDBCache } from './indexedDBCache';

/**
 * O perfil infantil pode abrir este título? (D115)
 *
 * Pode quando a classificação é infantil OU quando o responsável liberou o
 * título no Controle Parental. A liberação existe porque a TMDB é consultada
 * por NOME: quando casa o título errado, a classificação do outro fica 30 dias
 * no cache e esconderia o título de novo a cada clique.
 *
 * É a regra ÚNICA dos dois portões de clique (grades de Filmes/Séries e Home).
 * Falha ao ler a liberação = não liberado: o portão infantil fecha no erro.
 */
export async function infantilPodeAbrir(
    type: 'movie' | 'series',
    name: string,
    certification: string | null | undefined
): Promise<boolean> {
    if (isKidsFriendly(certification)) return true;
    try {
        return await indexedDBCache.isItemLiberado(type, name);
    } catch {
        return false;
    }
}
