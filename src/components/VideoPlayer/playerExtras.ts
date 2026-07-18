// Pure helpers for the D62 player extras (volume boost, A-B loop, frame
// step) — kept free of DOM/React so vitest covers the tricky edges.

/** Volume boost options shown in the gear menu (1 = normal 100%). */
export const BOOST_OPTIONS = [1, 1.5, 2, 3] as const;

/** Clamps a WebAudio gain multiplier to the supported 100%–300% range. */
export function clampBoost(mult: number): number {
    if (!Number.isFinite(mult)) return 1;
    return Math.min(3, Math.max(1, mult));
}

export interface AbLoopState {
    a: number | null;
    b: number | null;
}

/**
 * One key cycles the A-B loop: 1st press marks A, 2nd press marks B (a press
 * before A just re-marks A), 3rd press clears the loop.
 */
export function cycleAbState(state: AbLoopState, currentTime: number): AbLoopState {
    const t = Math.max(0, currentTime);
    if (state.a === null) return { a: t, b: null };
    if (state.b === null) {
        return t > state.a ? { a: state.a, b: t } : { a: t, b: null };
    }
    return { a: null, b: null };
}

/** Where to seek to enforce the loop, or null when no jump is needed. */
export function abLoopTarget(currentTime: number, state: AbLoopState): number | null {
    if (state.a === null || state.b === null) return null;
    return currentTime >= state.b ? state.a : null;
}

/** Seconds one frame step moves — assumes ~30fps (no fps metadata exposed). */
export const FRAME_STEP_SEC = 1 / 30;
