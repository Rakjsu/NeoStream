import { useEffect, useState } from 'react';

/**
 * Computes the column count for a CSS-style `repeat(auto-fill, minmax(minItemWidth, 1fr))`
 * grid living inside the element referenced by `ref`. `horizontalPadding` is the total
 * left+right padding (container + grid) to subtract from the container clientWidth.
 */
export function useGridColumns(
    ref: React.RefObject<HTMLElement | HTMLDivElement | null>,
    minItemWidth: number,
    gap: number,
    horizontalPadding: number = 0
): number {
    const [columns, setColumns] = useState(1);

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        const compute = () => {
            const available = element.clientWidth - horizontalPadding;
            if (available <= 0) return;
            setColumns(Math.max(1, Math.floor((available + gap) / (minItemWidth + gap))));
        };

        const observer = new ResizeObserver(compute);
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref, minItemWidth, gap, horizontalPadding]);

    return columns;
}
