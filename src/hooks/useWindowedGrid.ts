import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Windowed rendering for the content grids (VOD/Series/LiveTV) — v2.
 *
 * Lessons from the failed v1 (per-row absolute grids via a virtualizer):
 * unstable column counts between renders gave each row a different card
 * width (masonry chaos), and measured-height drift made rows overlap.
 *
 * v2 keeps the page's ORIGINAL single grid element (original className,
 * CSS gap/padding intact) and only narrows WHICH items are mounted:
 * top/bottom spacer rows (grid items spanning all columns) replace the
 * off-screen rows, so the scrollbar geometry stays correct while the DOM
 * holds ~3 screens of cards instead of everything scrolled past.
 *
 * Until the first row height is measured the page should render its plain
 * slice (`ready` false) — no layout flash, no 1-column bug.
 */

/** Single switch to disable windowing app-wide if an edge case appears. */
export const ENABLE_WINDOWED_GRIDS = true;

interface WindowedGridOptions {
    /** The scrollable container (the page already has this ref). */
    scrollRef: React.RefObject<HTMLElement | HTMLDivElement | null>;
    /** The grid element itself (to measure row height + read columns). */
    gridRef: React.RefObject<HTMLElement | HTMLDivElement | null>;
    /** Total number of items in the filtered list. */
    itemCount: number;
    /** Rows rendered beyond the viewport on each side. */
    overscanRows?: number;
}

interface WindowedGridResult {
    /** False until geometry is measured — render the full/plain slice then. */
    ready: boolean;
    /** Mount only items in [start, end). */
    start: number;
    end: number;
    /** Pixel heights for the spacer rows (0 when nothing is skipped). */
    topSpacer: number;
    bottomSpacer: number;
    /** Columns detected from the real grid layout (CSS truth, not math). */
    columns: number;
}

export function useWindowedGrid({
    scrollRef,
    gridRef,
    itemCount,
    overscanRows = 3
}: WindowedGridOptions): WindowedGridResult {
    const [geometry, setGeometry] = useState<{ columns: number; rowHeight: number; rowGap: number } | null>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const rafRef = useRef<number | null>(null);

    // Measure geometry from the REAL rendered grid: column count comes from
    // the computed grid-template-columns (CSS truth — no parallel math to
    // drift), row height from the first card's bounding box + row gap.
    const measure = useCallback(() => {
        const grid = gridRef.current;
        const scroller = scrollRef.current;
        if (!grid || !scroller || grid.children.length === 0) return;

        const style = window.getComputedStyle(grid);
        const columnCount = style.gridTemplateColumns.split(' ').filter(Boolean).length;
        const rowGap = parseFloat(style.rowGap) || 0;
        // Skip spacer rows (marked data-spacer) — measuring one as a card
        // would corrupt rowHeight with the height of N skipped rows.
        const firstCard = Array.from(grid.children)
            .find(child => !(child as HTMLElement).dataset.spacer) as HTMLElement | undefined;
        if (!firstCard) return;
        const cardHeight = firstCard.getBoundingClientRect().height;

        if (columnCount > 0 && cardHeight > 0) {
            setGeometry({ columns: columnCount, rowHeight: cardHeight + rowGap, rowGap });
            setViewportHeight(scroller.clientHeight);
        }
    }, [gridRef, scrollRef]);

    // (Re)measure when the grid appears or resizes. The grid only exists
    // after loading finishes, so observe via a no-deps effect guarded by
    // identity — same fix that the v1 column hook needed.
    const observedGrid = useRef<HTMLElement | null>(null);
    const observerRef = useRef<ResizeObserver | null>(null);
    useEffect(() => {
        const grid = gridRef.current;
        if (grid === observedGrid.current) return;
        observerRef.current?.disconnect();
        observedGrid.current = grid;
        if (!grid) return;
        const observer = new ResizeObserver(() => measure());
        observer.observe(grid);
        observerRef.current = observer;
    });
    useEffect(() => () => observerRef.current?.disconnect(), []);

    // Track scroll position (rAF-throttled).
    useEffect(() => {
        const scroller = scrollRef.current;
        if (!scroller) return;

        const onScroll = () => {
            if (rafRef.current !== null) return;
            rafRef.current = requestAnimationFrame(() => {
                rafRef.current = null;
                setScrollTop(scroller.scrollTop);
            });
        };

        scroller.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            scroller.removeEventListener('scroll', onScroll);
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        };
        // scrollRef identity is stable for the page's lifetime.
    }, [scrollRef, geometry !== null]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!ENABLE_WINDOWED_GRIDS || !geometry || itemCount === 0) {
        return { ready: false, start: 0, end: itemCount, topSpacer: 0, bottomSpacer: 0, columns: geometry?.columns ?? 0 };
    }

    const { columns, rowHeight, rowGap } = geometry;
    const totalRows = Math.ceil(itemCount / columns);

    const firstVisibleRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
    const lastVisibleRow = Math.min(
        totalRows - 1,
        Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscanRows
    );

    const start = firstVisibleRow * columns;
    const end = Math.min(itemCount, (lastVisibleRow + 1) * columns);

    // N skipped rows normally occupy N*rowHeight (card + gap each). The
    // spacer replaces those rows but, being a grid row itself, the grid adds
    // one extra gap between it and the adjacent card row — subtract it.
    const spacerFor = (skippedRows: number) =>
        skippedRows > 0 ? Math.max(0, skippedRows * rowHeight - rowGap) : 0;

    return {
        ready: true,
        start,
        end,
        topSpacer: spacerFor(firstVisibleRow),
        bottomSpacer: spacerFor(totalRows - 1 - lastVisibleRow),
        columns
    };
}
