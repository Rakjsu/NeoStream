import { useCallback, useEffect, useMemo, useState } from 'react';
import { indexedDBCache } from '../services/indexedDBCache';
import { parentalService } from '../services/parentalService';
import { asList } from '../utils/catalogPayload';
import {
    isCategoryNameBlocked,
    isContentGateOff,
    isItemVisibleUnderGate,
    shouldBlockAdultCategories,
    toCategoryIds,
    type ContentGateState,
} from '../services/contentGate';

/**
 * 🔒 O portão parental/infantil da Home.
 *
 * As grades de Filmes e Séries filtram por `useContentFiltering`; a TV ao vivo
 * por `isLiveChannelVisible`. A Home — que é a PRIMEIRA tela do app — era a
 * única sem portão nenhum: as fileiras saíam do catálogo cru, então um filme
 * de categoria adulta aparecia na Home do perfil infantil com pôster e tudo.
 *
 * Este hook monta o que o `contentGate` (puro e já testado) pede e devolve UM
 * predicado, para as cinco fileiras e a roleta usarem o MESMO julgamento.
 */
export type TipoDoItem = 'movie' | 'series';

/** O que o portão precisa saber sobre um item para julgá-lo. */
export interface ItemDaHome {
    name: string;
    categoryIds: string[];
    kind: TipoDoItem;
}

/** Fileiras da Home, como `renderContentSection` as recebe. */
export type FileiraDaHome = 'continue' | 'series' | 'movie' | 'recommendations';

/** Item de catálogo como a Home o tem em mãos, nas três formas que existem. */
export interface ItemBrutoDaHome {
    name?: unknown;
    /** Só o "continuar assistindo" carrega o tipo DENTRO do item. */
    type?: unknown;
    category_id?: unknown;
    series_id?: unknown;
}

/**
 * Traduz o item de UMA fileira para o que o portão sabe julgar.
 *
 * Mora aqui, e não dentro do `renderContentSection`, porque é este pedaço que
 * decide se o portão recebe a categoria e o tipo CERTOS — e um guarda que só
 * confere se a Home "chama o portão" continua verde com `categoryIds: []`,
 * que é o portão sem portão. Fora da Home ele tem teste de unidade de verdade.
 */
export function descreverItemDaHome(item: ItemBrutoDaHome, fileira: FileiraDaHome): ItemDaHome {
    const kind: TipoDoItem = fileira === 'continue'
        ? (item.type === 'series' ? 'series' : 'movie')
        : (fileira === 'series' || (fileira === 'recommendations' && 'series_id' in item) ? 'series' : 'movie');
    return {
        name: typeof item.name === 'string' ? item.name : String(item.name ?? ''),
        // `undefined` = o item não carrega categoria. Lista vazia faz o portão
        // julgar só por nome (ocultos/classificação) — nunca liberar por engano.
        categoryIds: item.category_id === undefined ? [] : toCategoryIds(item.category_id),
        kind,
    };
}

const CANAL_DE_CATEGORIAS: Record<TipoDoItem, string> = {
    movie: 'categories:get-vod',
    series: 'categories:get-series',
};

interface PortaoCarregado {
    blocked: Record<TipoDoItem, Set<string>>;
    hidden: Record<TipoDoItem, Set<string>>;
    ratings: Record<TipoDoItem, Map<string, string | null>>;
}

/**
 * Categorias adultas de um tipo. LANÇA quando o provedor não responde direito:
 * quem chama transforma isso em portão fechado, porque devolver conjunto vazio
 * aqui liberaria a categoria inteira em silêncio — que é exatamente o furo que
 * a TV ao vivo tem hoje.
 */
async function categoriasBloqueadas(tipo: TipoDoItem): Promise<Set<string>> {
    const resultado = await window.ipcRenderer.invoke(CANAL_DE_CATEGORIAS[tipo]) as {
        success?: boolean;
        data?: unknown;
    };
    if (!resultado?.success) throw new Error(`${CANAL_DE_CATEGORIAS[tipo]} falhou`);
    const bloqueadas = new Set<string>();
    asList<{ category_id: string; category_name: string }>(resultado.data).forEach(cat => {
        if (isCategoryNameBlocked(cat.category_name)) bloqueadas.add(String(cat.category_id));
    });
    return bloqueadas;
}

export function useHomeContentGate(isKidsProfile: boolean): (item: ItemDaHome) => boolean {
    const state = useMemo<ContentGateState>(() => {
        const config = parentalService.getConfig();
        return {
            isKidsProfile,
            parentalEnabled: config.enabled,
            blockAdultCategories: config.blockAdultCategories,
            sessionUnlocked: parentalService.isSessionUnlocked(),
        };
    }, [isKidsProfile]);

    const desligado = isContentGateOff(state);
    const [portao, setPortao] = useState<PortaoCarregado | null>(null);

    useEffect(() => {
        // Portão desligado (sem perfil infantil e sem parental valendo) é o
        // caso da maioria dos aparelhos: nenhum IPC, nenhuma varredura de
        // IndexedDB, a Home não paga nada.
        if (desligado) return;

        let cancelado = false;
        void (async () => {
            try {
                // Categorias primeiro e SEM rede de segurança: se falharem, o
                // `catch` lá embaixo deixa `portao` nulo e nada aparece.
                const [blockedMovie, blockedSeries] = shouldBlockAdultCategories(state)
                    ? await Promise.all([categoriasBloqueadas('movie'), categoriasBloqueadas('series')])
                    : [new Set<string>(), new Set<string>()];

                // Ocultos e notas em cache são refinamentos: a falta deles não
                // libera uma categoria inteira, então caem pro vazio.
                const semErro = <T,>(p: Promise<T>, vazio: T) => p.catch(() => vazio);
                const [hiddenMovie, hiddenSeries, ratingsMovie, ratingsSeries] = await Promise.all([
                    state.isKidsProfile ? semErro(indexedDBCache.getHiddenItems('movie'), [] as string[]) : Promise.resolve([] as string[]),
                    state.isKidsProfile ? semErro(indexedDBCache.getHiddenItems('series'), [] as string[]) : Promise.resolve([] as string[]),
                    semErro(indexedDBCache.getAllCachedMovies(), new Map<string, string | null>()),
                    semErro(indexedDBCache.getAllCachedSeries(), new Map<string, string | null>()),
                ]);

                if (cancelado) return;
                setPortao({
                    blocked: { movie: blockedMovie, series: blockedSeries },
                    hidden: { movie: new Set(hiddenMovie), series: new Set(hiddenSeries) },
                    ratings: { movie: ratingsMovie, series: ratingsSeries },
                });
            } catch {
                // Falha FECHADA: sem as categorias não dá pra dizer o que é
                // adulto, e a Home é a primeira tela que a criança vê.
                if (!cancelado) setPortao(null);
            }
        })();

        return () => { cancelado = true; };
    }, [desligado, state]);

    // Um `useCallback` só, com as saídas por dentro: devolver closures
    // diferentes por ramo derruba a compilação do React Compiler
    // (react-hooks/preserve-manual-memoization).
    return useCallback((item: ItemDaHome) => {
        if (desligado) return true;
        if (!portao) return false;
        return isItemVisibleUnderGate({
            name: item.name,
            categoryIds: item.categoryIds,
            blockedCategoryIds: portao.blocked[item.kind],
            hiddenNames: portao.hidden[item.kind],
            cachedRatings: portao.ratings[item.kind],
            isRatingBlocked: rating => parentalService.isContentBlocked(rating),
            state,
        });
    }, [desligado, portao, state]);
}
