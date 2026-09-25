import { useEffect, useRef, type RefObject } from 'react';

interface UseResetOnFilterChangeOptions {
    /** Texto da busca da grade. */
    searchQuery: string;
    /** Categoria escolhida (VOD usa '' pra "todas", Séries usa null). */
    selectedCategory: string | null;
    /** Tamanho da "página" da grade, recalculado pelo tamanho da janela. */
    itemsPerPage: number;
    setVisibleCount: (count: number) => void;
    /** Fecha a ficha aberta (o setter do estado da seleção). */
    setSelection: (value: null) => void;
    scrollRef: RefObject<HTMLElement | null>;
}

/**
 * 🧹 Reset da grade quando o FILTRO muda — e só quando o filtro muda.
 *
 * VOD e Séries tinham um efeito "Reset on filter change" com deps
 * `[searchQuery, selectedCategory, itemsPerPage]` que fechava a ficha e
 * voltava o scroll ao topo. Só que `itemsPerPage` não é filtro: vem do
 * `calculateGrid()`, que roda na montagem, DE NOVO 200 ms depois e a cada
 * `resize` da janela. Resultado: maximizar/redimensionar a janela com a ficha
 * aberta a fechava — e o recálculo dos 200 ms também, quando a grade assenta
 * com outro tamanho logo depois de a pessoa abrir uma ficha.
 *
 * Aqui o recálculo da grade só reajusta o `visibleCount`; a seleção e o scroll
 * só caem quando a busca ou a categoria mudam DE VERDADE em relação à última
 * vez que o efeito viu — o que também deixa a MONTAGEM (e a dupla execução do
 * StrictMode) sem reset nenhum, pra não engolir uma ficha pedida de fora
 * (busca global / "Parecidos").
 *
 * Ordem importa: a página chama este hook ANTES do efeito que abre a ficha
 * pendente (`pendingOpenId`). A busca global grava termo + ficha juntos; com o
 * reset declarado depois, o microtask dele (`setSelection(null)`) rodava
 * depois do que abria a ficha e a fechava.
 */
export function useResetOnFilterChange({
    searchQuery,
    selectedCategory,
    itemsPerPage,
    setVisibleCount,
    setSelection,
    scrollRef,
}: UseResetOnFilterChangeOptions): void {
    const lastFilter = useRef({ searchQuery, selectedCategory });

    useEffect(() => {
        const prev = lastFilter.current;
        const filterChanged = prev.searchQuery !== searchQuery
            || prev.selectedCategory !== selectedCategory;
        lastFilter.current = { searchQuery, selectedCategory };

        // Deferred setState (mesmo desenho do efeito antigo).
        queueMicrotask(() => {
            setVisibleCount(itemsPerPage);
            if (filterChanged) setSelection(null);
        });
        // De volta ao topo pra janela da grade recomeçar da linha 0.
        if (filterChanged && scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [searchQuery, selectedCategory, itemsPerPage, setVisibleCount, setSelection, scrollRef]);
}
