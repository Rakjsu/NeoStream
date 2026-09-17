/**
 * Índice título→id do catálogo (filmes e séries), em cache de módulo.
 *
 * A ficha usa esse índice só pra saber quais "Parecidos" e quais títulos da
 * filmografia EXISTEM no app. O índice morava em estado do ContentDetailModal,
 * e o modal é montado/desmontado a cada abertura (VOD, Séries, Home, Favoritos
 * e Ver depois montam `<ContentDetailModal>` dentro de um `{selecionado && …}`),
 * então cada ficha com seções TMDB refazia os dois invokes: as duas listas
 * inteiras (dezenas de milhares de itens num provedor real) reserializadas do
 * main pro renderer, só pra montar dois Maps iguais aos da ficha anterior.
 *
 * Mesmo desenho do `sessionCache` do GlobalSearch: uma busca por sessão,
 * invalidada no CATALOG_REFRESH_EVENT. Trocar de playlist não precisa de
 * invalidação — `playlistService.reloadIntoDashboard` recarrega o renderer
 * inteiro, e o módulo morre junto.
 */
import { normalizeTitle } from './personSearchHelpers';
import { CATALOG_REFRESH_EVENT } from './catalogRefreshService';

export interface CatalogTitleIndex { vod: Map<string, string>; series: Map<string, string>; }

let sessionCache: CatalogTitleIndex | null = null;
let sessionCachePromise: Promise<CatalogTitleIndex> | null = null;

// Refresh periódico do catálogo (catalogRefreshService): larga o cache pra
// próxima ficha remontar o índice.
if (typeof window !== 'undefined') {
    window.addEventListener(CATALOG_REFRESH_EVENT, () => { sessionCache = null; sessionCachePromise = null; });
}

/** Só pros testes: zera o cache de módulo entre casos. */
export function resetCatalogTitleIndex(): void { sessionCache = null; sessionCachePromise = null; }

interface LinhaDoCatalogo { stream_id?: number | string; series_id?: number | string; name?: string; }

function montarIndice(linhas: LinhaDoCatalogo[] | undefined, campo: 'stream_id' | 'series_id'): Map<string, string> {
    const index = new Map<string, string>();
    for (const linha of linhas ?? []) {
        const id = linha[campo];
        if (id === undefined || !linha.name) continue;
        const chave = normalizeTitle(linha.name);
        // Provedor repete o mesmo filme com sufixos ([DUB], 4K…): o primeiro id
        // vence, que é o que a ficha já fazia.
        if (chave && !index.has(chave)) index.set(chave, String(id));
    }
    return index;
}

/** Índice da sessão; busca o catálogo no máximo uma vez. */
export function getCatalogTitleIndex(): Promise<CatalogTitleIndex> {
    if (sessionCache) return Promise.resolve(sessionCache);
    if (!sessionCachePromise) {
        sessionCachePromise = (async () => {
            const [vodRes, seriesRes] = await Promise.all([
                window.ipcRenderer.invoke('streams:get-vod').catch(() => null),
                window.ipcRenderer.invoke('streams:get-series').catch(() => null),
            ]) as [{ data?: LinhaDoCatalogo[] } | null, { data?: LinhaDoCatalogo[] } | null];
            const index: CatalogTitleIndex = {
                vod: montarIndice(vodRes?.data, 'stream_id'),
                series: montarIndice(seriesRes?.data, 'series_id'),
            };
            // Só vira cache de sessão o que veio com conteúdo: provedor fora do
            // ar devolve `success:false` sem `data`, e cachear esse vazio tirava
            // "Parecidos" do resto da sessão — antes cada ficha tentava de novo.
            if (index.vod.size > 0 || index.series.size > 0) sessionCache = index;
            else sessionCachePromise = null;
            return index;
        })().catch(err => {
            // Deixa a próxima ficha tentar em vez de cachear a falha.
            sessionCachePromise = null;
            throw err;
        });
    }
    return sessionCachePromise;
}
