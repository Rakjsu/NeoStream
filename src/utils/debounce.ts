/**
 * Debounce: delays invoking fn until `delayMs` has elapsed since the last
 * call. The returned function carries a .cancel() to drop a pending call
 * (use it on unmount).
 */
export function debounce<Args extends unknown[]>(
    fn: (...args: Args) => void,
    delayMs: number
): ((...args: Args) => void) & { cancel: () => void } {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const debounced = (...args: Args) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, delayMs);
    };

    debounced.cancel = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    return debounced;
}
