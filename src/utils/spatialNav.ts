/**
 * Spatial navigation geometry (TV mode phase 2) — pure, unit-tested.
 * Given the focused element's rect and candidate rects, pick the best
 * candidate in an arrow direction: smallest primary-axis distance with an
 * orthogonal-offset penalty (favors staying in the same row/column).
 */

export interface NavRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export type NavDirection = 'up' | 'down' | 'left' | 'right';

const center = (rect: NavRect) => ({
    x: (rect.left + rect.right) / 2,
    y: (rect.top + rect.bottom) / 2
});

/**
 * Index of the best candidate in `direction` from `current`, or -1.
 * Candidates whose center is not strictly in the direction are ignored.
 */
export function pickSpatialTarget(current: NavRect, candidates: NavRect[], direction: NavDirection): number {
    const from = center(current);
    let best = -1;
    let bestScore = Infinity;

    for (let i = 0; i < candidates.length; i++) {
        const to = center(candidates[i]);
        const dx = to.x - from.x;
        const dy = to.y - from.y;

        let primary: number;
        let orthogonal: number;
        switch (direction) {
            case 'up': primary = -dy; orthogonal = Math.abs(dx); break;
            case 'down': primary = dy; orthogonal = Math.abs(dx); break;
            case 'left': primary = -dx; orthogonal = Math.abs(dy); break;
            case 'right': primary = dx; orthogonal = Math.abs(dy); break;
        }

        if (primary <= 1) continue; // not in that direction (1px tolerance)

        const score = primary + orthogonal * 2.5;
        if (score < bestScore) {
            bestScore = score;
            best = i;
        }
    }

    return best;
}
