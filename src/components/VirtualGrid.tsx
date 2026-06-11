import { useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

interface VirtualGridProps<T> {
    /** Ref to the existing scroll container element */
    scrollRef: React.RefObject<HTMLElement | HTMLDivElement | null>;
    items: T[];
    columns: number;
    estimateRowHeight: number;
    /** Gap between rows and columns, in px */
    gap: number;
    renderItem: (item: T, index: number) => React.ReactNode;
}

/**
 * Generic row-virtualization wrapper. Items are chunked into rows of
 * `columns` items; only the visible rows (plus overscan) are mounted.
 */
export function VirtualGrid<T>({
    scrollRef,
    items,
    columns,
    estimateRowHeight,
    gap,
    renderItem
}: VirtualGridProps<T>) {
    const safeColumns = Math.max(1, columns);
    const rowCount = Math.ceil(items.length / safeColumns);

    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => estimateRowHeight,
        overscan: 3,
        gap
    });

    // Re-measure rows when the column count changes (row heights change too)
    useEffect(() => {
        virtualizer.measure();
    }, [columns, virtualizer]);

    return (
        <div
            style={{
                height: virtualizer.getTotalSize(),
                position: 'relative',
                width: '100%'
            }}
        >
            {virtualizer.getVirtualItems().map(virtualRow => {
                const startIndex = virtualRow.index * safeColumns;
                const rowItems = items.slice(startIndex, startIndex + safeColumns);

                return (
                    <div
                        key={virtualRow.key}
                        data-index={virtualRow.index}
                        ref={virtualizer.measureElement}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${virtualRow.start}px)`,
                            display: 'grid',
                            gridTemplateColumns: `repeat(${safeColumns}, 1fr)`,
                            gap
                        }}
                    >
                        {rowItems.map((item, i) => renderItem(item, startIndex + i))}
                    </div>
                );
            })}
        </div>
    );
}
